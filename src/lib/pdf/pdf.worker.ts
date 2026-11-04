/// <reference lib="webworker" />
/**
 * PDF worker. pdf-lib's parse and serialise steps are synchronous and can block
 * for hundreds of milliseconds on large documents, so they run here and the UI
 * thread stays free to paint progress.
 *
 * Protocol (see `protocol.ts`):
 *   in:  { type: 'run', id, operation } | { type: 'cancel', id }
 *   out: { type: 'progress', id, ratio } | { type: 'done', id, outcome } | { type: 'error', … }
 *
 * Cancellation is cooperative: the flag is polled between documents, because a
 * single `PDFDocument.save()` cannot be interrupted from the outside. Reporting
 * that honestly beats pretending a hard cancel exists.
 */
import { ToolError } from '../files/errors';
import { encodePdfOutcome, type PdfWorkerRequest, type PdfWorkerResponse } from './protocol';
import { runOperation } from './ops';

const scope = self as unknown as Worker;
const post = (message: PdfWorkerResponse, transfer?: Transferable[]) =>
  scope.postMessage(message, transfer ?? []);

/** Jobs asked to stop; cleared when they finish or fail. */
const cancelled = new Set<number>();

async function execute(id: number, request: Extract<PdfWorkerRequest, { type: 'run' }>) {
  try {
    const outcome = await runOperation(request.operation, {
      onProgress: (ratio) => post({ type: 'progress', id, ratio }),
      isCancelled: () => cancelled.has(id),
    });
    const { wire, transfer } = encodePdfOutcome(outcome);
    // Result buffers are transferred, not copied: the worker gives up ownership
    // instead of keeping a duplicate alive next to the main thread's copy.
    post({ type: 'done', id, outcome: wire }, transfer);
  } catch (error) {
    const toolError =
      error instanceof ToolError
        ? error
        : new ToolError(
            'worker-failed',
            error instanceof Error && error.message
              ? error.message
              : 'The document could not be processed.',
          );
    post({ type: 'error', id, code: toolError.code, message: toolError.message, hint: toolError.hint });
  } finally {
    cancelled.delete(id);
  }
}

scope.addEventListener('message', (event: MessageEvent<PdfWorkerRequest>) => {
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
