/**
 * Worker client for PDF operations.
 *
 * The public `pdf.ts` API is identical whether the work happens in the worker
 * or on the main thread; only this module knows the difference. The worker is a
 * lazy singleton: one module instance, one pdf-lib copy, reused across tools.
 *
 * Failure model:
 *   - Worker cannot be constructed (old browser, CSP, bundling bug) → every job
 *     runs on the main thread. Same behaviour, blocking parse.
 *   - Worker dies mid-job → that job is rejected (`worker-failed`); the worker is
 *     discarded and later jobs use the main thread. No retry: a crash usually
 *     means the same input would crash again, and silently doubling the work
 *     hides the problem. The `File` is still readable, so "try again" is cheap.
 */
import { ToolError } from '../files/errors';
import {
  decodePdfOutcome,
  type PdfOperation,
  type PdfOutcome,
  type PdfWorkerRequest,
  type PdfWorkerResponse,
} from './protocol';

export interface RunOptions {
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
}

interface Pending {
  resolve: (outcome: PdfOutcome) => void;
  reject: (error: unknown) => void;
  onProgress?: (ratio: number) => void;
  /** Last progress forward time, for throttling. */
  lastEmit: number;
}

/**
 * A 300-file split emits 300 messages. Each one is its own task, so without
 * coalescing the tool re-renders 300 times in under a second for a bar that
 * cannot visibly move more often than the display refreshes.
 */
const PROGRESS_INTERVAL_MS = 60;

let worker: Worker | null = null;
let workerBroken = false;
let sequence = 0;
const pending = new Map<number, Pending>();

function nextId(): number {
  sequence = (sequence + 1) % 1_000_000;
  return sequence;
}

function failAll(message: string) {
  for (const [, entry] of pending) entry.reject(new ToolError('worker-failed', message));
  pending.clear();
}

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;

  try {
    const created = new Worker(new URL('./pdf.worker.ts', import.meta.url), { type: 'module', name: 'zeroupload-pdf' });
    created.addEventListener('message', (event: MessageEvent<PdfWorkerResponse>) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      const entry = pending.get(data.id);
      if (!entry) return;

      if (data.type === 'progress') {
        if (data.ratio >= 1) {
          entry.lastEmit = 0;
          entry.onProgress?.(1);
          return;
        }
        const now = Date.now();
        if (now - entry.lastEmit < PROGRESS_INTERVAL_MS) return;
        entry.lastEmit = now;
        entry.onProgress?.(data.ratio);
        return;
      }

      pending.delete(data.id);
      if (data.type === 'done') {
        // Guarantee the bar finishes at 100 % even if the last event was dropped.
        if (entry.onProgress) {
          entry.onProgress(1);
          entry.onProgress = undefined;
        }
        entry.resolve(decodePdfOutcome(data.outcome));
      } else {
        entry.reject(new ToolError(data.code, data.message, data.hint));
      }
    });
    created.addEventListener('error', (event) => {
      workerBroken = true;
      failAll(event.message || 'The PDF worker stopped unexpectedly.');
      created.terminate();
      worker = null;
    });
    worker = created;
  } catch {
    workerBroken = true;
    worker = null;
  }

  return worker;
}

/** True when the last attempt to create a worker failed — used by the harness/docs. */
export function pdfWorkerUnavailable(): boolean {
  return workerBroken;
}

async function runOnMainThread(operation: PdfOperation, options: RunOptions): Promise<PdfOutcome> {
  // Dynamic: pdf-lib must stay out of the entry chunk on this path too.
  const { runOperation } = await import('./ops');
  return runOperation(operation, {
    onProgress: options.onProgress,
    isCancelled: () => options.signal?.aborted === true,
  });
}

/**
 * Runs one operation and resolves with its outcome.
 *
 * Inputs are `Blob`s: crossing the worker boundary clones a handle, not the
 * bytes, so the same `File` can be used again by another operation afterwards.
 */
export async function runPdfOperation(operation: PdfOperation, options: RunOptions = {}): Promise<PdfOutcome> {
  if (options.signal?.aborted) {
    throw new ToolError('cancelled', 'Processing was cancelled.', 'Nothing was downloaded.');
  }

  const activeWorker = getWorker();
  if (!activeWorker) return runOnMainThread(operation, options);

  const id = nextId();

  return new Promise<PdfOutcome>((resolve, reject) => {
    const onAbort = () => {
      if (!pending.has(id)) return;
      pending.delete(id);
      // Ask the worker to stop between documents; late messages for this id are
      // ignored because the entry is already gone.
      try {
        activeWorker.postMessage({ type: 'cancel', id } satisfies PdfWorkerRequest);
      } catch {
        /* worker already gone */
      }
      reject(new ToolError('cancelled', 'Processing was cancelled.', 'Nothing was downloaded.'));
    };

    pending.set(id, {
      resolve: (outcome) => {
        options.signal?.removeEventListener('abort', onAbort);
        resolve(outcome);
      },
      reject: (error) => {
        options.signal?.removeEventListener('abort', onAbort);
        reject(error);
      },
      onProgress: options.onProgress,
      lastEmit: 0,
    });
    options.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      activeWorker.postMessage({ type: 'run', id, operation } satisfies PdfWorkerRequest);
    } catch (error) {
      pending.delete(id);
      options.signal?.removeEventListener('abort', onAbort);
      reject(
        new ToolError(
          'worker-failed',
          error instanceof Error && error.message ? error.message : 'The PDF worker rejected this job.',
        ),
      );
    }
  });
}

/** Terminates the worker. Only used by tests/reset paths; normal jobs reuse it. */
export function disposePdfWorker(): void {
  failAll('The PDF worker was shut down.');
  worker?.terminate();
  worker = null;
  workerBroken = false;
}
