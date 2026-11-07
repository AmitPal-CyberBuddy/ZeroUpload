/// <reference lib="webworker" />
/**
 * Office worker.
 *
 * The expensive part of decryption is not the AES: it is 100 000 rounds of
 * SHA-512 to derive the key, which is deliberately slow and, in JavaScript,
 * synchronous. On the main thread that is a visible stall of about half a second
 * per document; here it blocks nothing the user can see.
 *
 * Protocol matches the PDF and ZIP workers (see `protocol.ts`), including
 * cooperative cancellation between the derivation and the payload pass.
 */
import { ToolError } from '../files/errors';
import { encodeOfficeOutcome, type OfficeWorkerRequest, type OfficeWorkerResponse } from './protocol';
import { decryptOffice, encryptOffice } from './office';

const scope = self as unknown as Worker;
const post = (message: OfficeWorkerResponse, transfer?: Transferable[]) => scope.postMessage(message, transfer ?? []);

const cancelled = new Set<number>();

async function execute(id: number, request: Extract<OfficeWorkerRequest, { type: 'run' }>) {
  try {
    const context = {
      onProgress: (ratio: number) => post({ type: 'progress', id, ratio }),
      isCancelled: () => cancelled.has(id),
    };
    const outcome =
      request.operation.kind === 'encrypt'
        ? await encryptOffice(request.operation.source, request.operation.password, context)
        : await decryptOffice(request.operation.source, request.operation.password, context);
    const { wire, transfer } = encodeOfficeOutcome(outcome);
    post({ type: 'done', id, outcome: wire }, transfer);
  } catch (error) {
    const toolError =
      error instanceof ToolError
        ? error
        : new ToolError(
            'worker-failed',
            error instanceof Error && error.message ? error.message : 'The Office worker failed on this document.',
          );
    post({ type: 'error', id, code: toolError.code, message: toolError.message, hint: toolError.hint });
  } finally {
    cancelled.delete(id);
  }
}

scope.addEventListener('message', (event: MessageEvent<OfficeWorkerRequest>) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'cancel') {
    cancelled.add(data.id);
    return;
  }
  if (data.type === 'run') void execute(data.id, data);
});
