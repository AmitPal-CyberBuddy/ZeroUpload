/**
 * Worker client for ZIP creation.
 *
 * `createZip()` in `zip.ts` is identical whether the archive is built in the
 * worker or on the main thread; only this module knows the difference. The
 * worker is a lazy singleton — one module instance, one fflate copy, reused by
 * every archive and every batch packaging run.
 *
 * Failure model (same as the PDF client, so there is one mental model in the
 * codebase):
 *   - Worker cannot be constructed (no module workers, a CSP that forbids them,
 *     a bundling bug) → the operation runs on the main thread immediately. Same
 *     code (`create.ts`), same guards, same errors.
 *   - Worker dies mid-operation → that operation is rejected as `worker-failed`
 *     and the worker is discarded; **later** operations use the main thread. No
 *     automatic retry: a crash usually means the same input crashes again, and
 *     retrying silently hides the problem while doubling the work.
 *   - The user cancels → rejected immediately with `cancelled`, and the worker is
 *     told to stop between entries. Late messages for that id are ignored.
 */
import { ToolError } from '../files/errors';
import {
  decodeZipOutcome,
  zipProgressRatio,
  type ZipOperation,
  type ZipOutcome,
  type ZipWorkerRequest,
  type ZipWorkerResponse,
} from './protocol';

export interface ZipRunOptions {
  /** 0–1, already derived from "files packaged" rather than from bytes. */
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
}

interface Pending {
  resolve: (outcome: ZipOutcome) => void;
  reject: (error: unknown) => void;
  onProgress?: (ratio: number) => void;
  /** Last time a progress ratio was forwarded, for coalescing. */
  lastEmit: number;
}

/** Same window as the PDF client: at most one progress render per 60 ms. */
const PROGRESS_INTERVAL_MS = 60;

let worker: Worker | null = null;
let workerBroken = false;
let sequence = 0;
const pending = new Map<number, Pending>();

const nextId = () => (sequence = (sequence + 1) % 1_000_000);

function failAll(message: string) {
  for (const [, entry] of pending) entry.reject(new ToolError('worker-failed', message));
  pending.clear();
}

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;

  try {
    const created = new Worker(new URL('./zip.worker.ts', import.meta.url), {
      type: 'module',
      name: 'zeroupload-zip',
    });

    created.addEventListener('message', (event: MessageEvent<ZipWorkerResponse>) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      const entry = pending.get(data.id);
      if (!entry) return;

      if (data.type === 'progress') {
        const ratio = zipProgressRatio(data.progress);
        // Phase changes are worth showing even inside the coalescing window.
        const now = Date.now();
        if (data.progress.phase === 'compressing' && now - entry.lastEmit < PROGRESS_INTERVAL_MS) return;
        entry.lastEmit = now;
        entry.onProgress?.(ratio);
        return;
      }

      pending.delete(data.id);
      if (data.type === 'done') {
        // Guarantee the bar reaches 100 %, even if the last tick was coalesced.
        entry.onProgress?.(1);
        entry.resolve(decodeZipOutcome(data.outcome));
      } else {
        entry.reject(new ToolError(data.code, data.message, data.hint));
      }
    });

    created.addEventListener('error', (event) => {
      workerBroken = true;
      failAll(event.message || 'The ZIP worker stopped unexpectedly.');
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

async function runOnMainThread(operation: ZipOperation, options: ZipRunOptions): Promise<ZipOutcome> {
  // Dynamic: fflate must stay out of the entry chunk on this path too.
  const { createArchive } = await import('./create');
  const result = await createArchive(operation.entries, {
    onProgress: (progress) => options.onProgress?.(zipProgressRatio(progress)),
    isCancelled: () => options.signal?.aborted === true,
    encryption: operation.encryption,
  });
  options.onProgress?.(1);
  return result;
}

export async function runZipOperation(operation: ZipOperation, options: ZipRunOptions = {}): Promise<ZipOutcome> {
  if (options.signal?.aborted) {
    throw new ToolError('cancelled', 'Building the archive was cancelled.', 'Nothing was downloaded.');
  }

  const activeWorker = getWorker();
  if (!activeWorker) return runOnMainThread(operation, options);

  const id = nextId();

  return new Promise<ZipOutcome>((resolve, reject) => {
    const onAbort = () => {
      if (!pending.has(id)) return;
      pending.delete(id);
      try {
        activeWorker.postMessage({ type: 'cancel', id } satisfies ZipWorkerRequest);
      } catch {
        /* worker already gone */
      }
      reject(new ToolError('cancelled', 'Building the archive was cancelled.', 'Nothing was downloaded.'));
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
      activeWorker.postMessage({ type: 'run', id, operation } satisfies ZipWorkerRequest);
    } catch (error) {
      pending.delete(id);
      options.signal?.removeEventListener('abort', onAbort);
      reject(
        new ToolError(
          'worker-failed',
          error instanceof Error && error.message ? error.message : 'The ZIP worker rejected this job.',
        ),
      );
    }
  });
}
