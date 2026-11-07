/**
 * Worker client for Office encryption and decryption.
 *
 * Identical contract to the PDF and ZIP clients: one lazy singleton worker, a
 * main-thread fallback that runs the *same* module when a worker cannot be
 * created, and a hard failure (`worker-failed`) if the worker dies mid-job.
 */
import { ToolError } from '../files/errors';
import {
  decodeOfficeOutcome,
  type OfficeOperation,
  type OfficeOutcome,
  type OfficeWorkerRequest,
  type OfficeWorkerResponse,
} from './protocol';

export interface OfficeRunOptions {
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
}

interface Pending {
  resolve: (outcome: OfficeOutcome) => void;
  reject: (error: unknown) => void;
  onProgress?: (ratio: number) => void;
  lastEmit: number;
}

const PROGRESS_INTERVAL_MS = 120;

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
    const created = new Worker(new URL('./office.worker.ts', import.meta.url), {
      type: 'module',
      name: 'zeroupload-office',
    });
    created.addEventListener('message', (event: MessageEvent<OfficeWorkerResponse>) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      const entry = pending.get(data.id);
      if (!entry) return;

      if (data.type === 'progress') {
        if (data.ratio >= 1) {
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
        entry.onProgress?.(1);
        entry.resolve(decodeOfficeOutcome(data.outcome));
      } else {
        entry.reject(new ToolError(data.code, data.message, data.hint));
      }
    });
    created.addEventListener('error', (event) => {
      workerBroken = true;
      failAll(event.message || 'The Office worker stopped unexpectedly.');
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

async function runOnMainThread(operation: OfficeOperation, options: OfficeRunOptions): Promise<OfficeOutcome> {
  // Dynamic: office-crypto must stay out of the entry chunk on this path too.
  const { decryptOffice, encryptOffice } = await import('./office');
  const context = {
    onProgress: options.onProgress,
    isCancelled: () => options.signal?.aborted === true,
  };
  const outcome =
    operation.kind === 'encrypt'
      ? await encryptOffice(operation.source, operation.password, context)
      : await decryptOffice(operation.source, operation.password, context);
  options.onProgress?.(1);
  return outcome;
}

export async function runOfficeOperation(operation: OfficeOperation, options: OfficeRunOptions = {}): Promise<OfficeOutcome> {
  if (options.signal?.aborted) {
    throw new ToolError('cancelled', 'The operation was cancelled.', 'Nothing was downloaded.');
  }

  const activeWorker = getWorker();
  if (!activeWorker) return runOnMainThread(operation, options);

  const id = nextId();

  return new Promise<OfficeOutcome>((resolve, reject) => {
    const onAbort = () => {
      if (!pending.has(id)) return;
      pending.delete(id);
      try {
        activeWorker.postMessage({ type: 'cancel', id } satisfies OfficeWorkerRequest);
      } catch {
        /* worker already gone */
      }
      reject(new ToolError('cancelled', 'Decryption was cancelled.', 'Nothing was downloaded.'));
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
      activeWorker.postMessage({ type: 'run', id, operation } satisfies OfficeWorkerRequest);
    } catch (error) {
      pending.delete(id);
      options.signal?.removeEventListener('abort', onAbort);
      reject(
        new ToolError(
          'worker-failed',
          error instanceof Error && error.message ? error.message : 'The Office worker rejected this job.',
        ),
      );
    }
  });
}
