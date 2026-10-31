/// <reference lib="webworker" />
/**
 * ZIP worker. DEFLATE over a multi-hundred-megabyte batch is the last operation
 * in this app that can freeze the interface for a noticeable time, so archive
 * creation runs here and the main thread stays free to paint progress.
 *
 * Protocol (see `protocol.ts`):
 *   in:  { type: 'run', id, operation } | { type: 'cancel', id }
 *   out: { type: 'progress', id, progress } | { type: 'done', id, outcome } | { type: 'error', … }
 *
 * Every guard lives in `createArchive`, shared with the main-thread fallback: the
 * worker is a transport, not a second implementation.
 */
import { ToolError } from '../files/errors';
import { encodeZipOutcome, type ZipWorkerRequest, type ZipWorkerResponse } from './protocol';
import { createArchive } from './create';

const scope = self as unknown as Worker;
const post = (message: ZipWorkerResponse, transfer?: Transferable[]) => scope.postMessage(message, transfer ?? []);

/** Jobs asked to stop; cleared when they finish or fail. */
const cancelled = new Set<number>();

async function execute(id: number, request: Extract<ZipWorkerRequest, { type: 'run' }>) {
  try {
    const result = await createArchive(request.operation.entries, {
      // Already off the main thread: no second worker, no second copy.
      syncDeflate: true,
      onProgress: (progress) => post({ type: 'progress', id, progress }),
      isCancelled: () => cancelled.has(id),
    });
    const { wire, transfer } = encodeZipOutcome({
      archive: result.archive,
      entryCount: result.entryCount,
      inputBytes: result.inputBytes,
    });
    // The archive's buffer is transferred: the worker gives up ownership instead
    // of keeping a duplicate alive next to the main thread's copy.
    post({ type: 'done', id, outcome: wire }, transfer);
  } catch (error) {
    const toolError =
      error instanceof ToolError
        ? error
        : new ToolError(
            'worker-failed',
            error instanceof Error && error.message ? error.message : 'The archive could not be built in the worker.',
          );
    post({ type: 'error', id, code: toolError.code, message: toolError.message, hint: toolError.hint });
  } finally {
    cancelled.delete(id);
  }
}

scope.addEventListener('message', (event: MessageEvent<ZipWorkerRequest>) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'cancel') {
    cancelled.add(data.id);
    return;
  }

  if (data.type === 'run') {
    void execute(data.id, data);
  }
});
