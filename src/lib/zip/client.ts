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
  decodeZipReadOutcome,
  zipProgressRatio,
  type ZipOperation,
  type ZipReadOutcome,
  type ZipWorkerRequest,
  type ZipWorkerResponse,
} from './protocol';

/** What a job produces. The caller narrows on `kind`. */
export type ZipResult =
  | { kind: 'create'; outcome: { archive: Uint8Array; entryCount: number; inputBytes: number } }
  | { kind: 'read'; outcome: ZipReadOutcome };

export interface ZipRunOptions {
  /** 0–1, already derived from "files packaged" rather than from bytes. */
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
}

interface Pending {
  resolve: (result: ZipResult) => void;
  reject: (error: unknown) => void;
  onProgress?: (ratio: number) => void;
  /** Last time a progress ratio was forwarded, for coalescing. */
  lastEmit: number;
  /** Highest ratio the caller has seen, so "finish at 1" is sent exactly once. */
  lastRatio: number;
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

      /*
       * Extractions report a plain ratio; creations report structured progress
       * that has to be turned into one. Both are coalesced on the same clock, so
       * a 5,000-entry archive cannot schedule 5,000 renders.
       */
      if (data.type === 'ratio') {
        const now = Date.now();
        if (data.ratio < 1 && now - entry.lastEmit < PROGRESS_INTERVAL_MS) return;
        entry.lastEmit = now;
        entry.lastRatio = data.ratio;
        entry.onProgress?.(data.ratio);
        return;
      }

      if (data.type === 'progress') {
        const ratio = zipProgressRatio(data.progress);
        // Phase changes are worth showing even inside the coalescing window.
        const now = Date.now();
        if (data.progress.phase === 'compressing' && now - entry.lastEmit < PROGRESS_INTERVAL_MS) return;
        entry.lastEmit = now;
        entry.lastRatio = ratio;
        entry.onProgress?.(ratio);
        return;
      }

      pending.delete(data.id);
      if (data.type === 'done') {
        // Guarantee the bar reaches 100 %, even if the last tick was coalesced —
        // and only once: `read` already reports 1 for its final entry.
        if (entry.lastRatio < 1) entry.onProgress?.(1);
        entry.resolve(
          data.result.kind === 'create'
            ? { kind: 'create', outcome: decodeZipOutcome(data.result.outcome) }
            : { kind: 'read', outcome: decodeZipReadOutcome(data.result.outcome) },
        );
      } else if (data.type === 'error') {
        entry.reject(new ToolError(data.code, data.message, data.hint));
      }
    });

    created.addEventListener('error', () => {
      workerBroken = true;
      failAll('Packaging stopped unexpectedly. Reload the page and try again.');
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

/**
 * The fallback. Same modules as the worker, run on this thread.
 *
 * Cancellation here is weaker and the code says so instead of pretending: on the
 * main thread a cancel cannot interrupt a synchronous decode, so it takes effect
 * at the next checkpoint rather than immediately. That is the honest cost of a
 * browser without module workers.
 */
async function runOnMainThread(operation: ZipOperation, options: ZipRunOptions): Promise<ZipResult> {
  const isCancelled = () => options.signal?.aborted === true;

  if (operation.kind === 'create') {
    // Dynamic: fflate must stay out of the entry chunk on this path too.
    const { createArchive } = await import('./create');
    const outcome = await createArchive(operation.entries, {
      onProgress: (progress) => options.onProgress?.(zipProgressRatio(progress)),
      isCancelled,
      encryption: operation.encryption,
      compression: operation.compression,
    });
    options.onProgress?.(1);
    return { kind: 'create', outcome };
  }

  const { readArchive } = await import('./read');
  const outcome = await readArchive(operation.file, {
    limits: operation.limits,
    password: operation.password,
    onProgress: options.onProgress,
    isCancelled,
  });
  // No forced final tick: `readArchive` reports 1 after the last entry.
  return { kind: 'read', outcome };
}

export async function runZipJob(operation: ZipOperation, options: ZipRunOptions = {}): Promise<ZipResult> {
  if (options.signal?.aborted) {
    throw new ToolError(
      'cancelled',
      operation.kind === 'create' ? 'Building the archive was cancelled.' : 'Reading this archive was cancelled.',
      'Nothing was kept.',
    );
  }

  const activeWorker = getWorker();
  if (!activeWorker) return runOnMainThread(operation, options);

  const id = nextId();

  return new Promise<ZipResult>((resolve, reject) => {
    const onAbort = () => {
      if (!pending.has(id)) return;
      pending.delete(id);
      try {
        activeWorker.postMessage({ type: 'cancel', id } satisfies ZipWorkerRequest);
      } catch {
        /* worker already gone */
      }
      reject(
        new ToolError(
          'cancelled',
          operation.kind === 'create' ? 'Building the archive was cancelled.' : 'Reading this archive was cancelled.',
          'Nothing was kept.',
        ),
      );
    };

    pending.set(id, {
      resolve: (result) => {
        options.signal?.removeEventListener('abort', onAbort);
        resolve(result);
      },
      reject: (error) => {
        options.signal?.removeEventListener('abort', onAbort);
        reject(error);
      },
      onProgress: options.onProgress,
      lastEmit: 0,
      lastRatio: 0,
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

/**
 * Creating an archive, narrowed to its own result shape.
 *
 * `runZipJob` is the general entry point; this is the one `createZip` and the
 * tests want, and it keeps the union from leaking into every caller that only
 * ever builds archives.
 */
export async function runZipOperation(
  operation: Extract<ZipOperation, { kind: 'create' }>,
  options: ZipRunOptions = {},
): Promise<{ archive: Uint8Array; entryCount: number; inputBytes: number }> {
  const result = await runZipJob(operation, options);
  if (result.kind !== 'create') throw new ToolError('unknown', 'The ZIP worker returned an unexpected result.');
  return result.outcome;
}
