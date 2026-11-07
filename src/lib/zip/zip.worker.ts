/// <reference lib="webworker" />
/**
 * ZIP worker — archive creation *and* extraction.
 *
 * DEFLATE over a multi-hundred-megabyte batch is one of the two operations in
 * this app that can freeze the interface, and unpacking is the other. Both run
 * here so the main thread stays free to paint progress — and, more importantly,
 * so Cancel can be delivered to a thread that is not blocked in a synchronous
 * decode.
 *
 * Protocol (see `protocol.ts`):
 *   in:  { type: 'run', id, operation } | { type: 'cancel', id }
 *   out: { type: 'progress' | 'ratio', id, … } | { type: 'done', id, result } | { type: 'error', … }
 *
 * Every guard lives in `create.ts` / `read.ts`, shared with the main-thread
 * fallback: the worker is a transport, not a second implementation.
 */
import { ToolError } from '../files/errors';
import {
  encodeZipOutcome,
  encodeZipReadOutcome,
  type ZipWireResult,
  type ZipWorkerRequest,
  type ZipWorkerResponse,
} from './protocol';
import { createArchive } from './create';
import { readArchive } from './read';

const scope = self as unknown as Worker;
const post = (message: ZipWorkerResponse, transfer?: Transferable[]) => scope.postMessage(message, transfer ?? []);

/** Jobs asked to stop; cleared when they finish or fail. */
const cancelled = new Set<number>();

async function execute(id: number, request: Extract<ZipWorkerRequest, { type: 'run' }>) {
  try {
    const { operation } = request;
    let result: ZipWireResult;
    let transfer: ArrayBuffer[] = [];

    if (operation.kind === 'create') {
      const created = await createArchive(operation.entries, {
        // Already off the main thread: no second worker, no second copy.
        syncDeflate: true,
        onProgress: (progress) => post({ type: 'progress', id, progress }),
        isCancelled: () => cancelled.has(id),
        encryption: operation.encryption,
      });
      const encoded = encodeZipOutcome({
        archive: created.archive,
        entryCount: created.entryCount,
        inputBytes: created.inputBytes,
      });
      result = { kind: 'create', outcome: encoded.wire };
      transfer = encoded.transfer;
    } else {
      const opened = await readArchive(operation.file, {
        limits: operation.limits,
        password: operation.password,
        // Throttled by the client, which owns the render cadence.
        onProgress: (ratio) => post({ type: 'ratio', id, ratio }),
        isCancelled: () => cancelled.has(id),
      });
      const encoded = encodeZipReadOutcome(opened);
      result = { kind: 'read', outcome: encoded.wire };
      transfer = encoded.transfer;
    }

    // Ownership of the buffers is transferred: the worker gives up its copy
    // instead of keeping a duplicate alive next to the main thread's.
    post({ type: 'done', id, result }, transfer);
  } catch (error) {
    const toolError =
      error instanceof ToolError
        ? error
        : new ToolError(
            'worker-failed',
            error instanceof Error && error.message ? error.message : 'The ZIP worker could not finish this job.',
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
