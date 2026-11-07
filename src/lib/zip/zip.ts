/**
 * ZIP — the public API.
 *
 * `createZip` and `readZip` are the only two things the React layer imports.
 * Everything below them moved out so this module stays a surface rather than a
 * fourth implementation:
 *
 *   `limits.ts`     the extraction budget constants
 *   `inspect.ts`    central-directory parsing (is this encrypted, how many entries)
 *   `read.ts`       guarded extraction — no workers, no React
 *   `create.ts`     archive creation — same file for the worker and the fallback
 *   `encrypted.ts`  the zip.js engine, loaded only when a password is involved
 *   `client.ts`     which thread the work runs on
 *
 * Both operations run in a worker when one can be constructed and on the main
 * thread when it cannot. That is not a nicety: a 400 MB archive expands to 400 MB
 * of memory in one synchronous call, and on the main thread that is a frozen tab
 * with no way to stop it. In the worker the same code runs, the interface keeps
 * painting, and Cancel can be honoured at the next entry boundary.
 *
 * The guards, budgets and error codes are identical on both paths — the worker is
 * a transport, never a second implementation.
 */
import { ToolError } from '../files/errors';
import { OPERATION_BUDGETS } from '../files/budget';
import { DEFAULT_LIMITS, type ZipLimits } from './limits';
import type { OpenedArchive } from './read';

export type { ZipLimits } from './limits';
export { DEFAULT_LIMITS } from './limits';
export type { OpenedArchive, ZipEntryMeta } from './read';
export { inspectZip } from './read';

/**
 * Creating an archive holds every input in memory at once, so the total is
 * capped too. The numbers live with the other multi-input budgets so the PDF
 * tools and the archive tool speak the same vocabulary.
 */
export const CREATE_BUDGET = OPERATION_BUDGETS.zipCreate;

/**
 * Re-exported for callers and tests. The implementation lives in `names.ts`
 * because archive creation needs it inside the worker too, and two copies of a
 * sanitiser is exactly how a traversal bug gets reintroduced.
 */
export { sanitizeEntryName } from './names';
export { ZIP_ENCRYPTION_LABEL, MIN_AES_PASSWORD_LENGTH } from './inspect';
export { inspectZipEncryption } from './inspect';
export type { ZipEncryptionKind, ZipEncryptionInfo } from './inspect';

/**
 * Reads an archive: lists its entries and unpacks them, enforcing the budget from
 * the central directory before a byte is inflated.
 *
 * Cancellation is a real option here rather than a decorative button. The work
 * runs in the ZIP worker, so an abort is delivered to a thread that is not busy,
 * and `read.ts` checks it between the two phases and between entries.
 */
export async function readZip(
  file: Blob,
  limits: ZipLimits = DEFAULT_LIMITS,
  onProgress?: (ratio: number) => void,
  password?: string,
  signal?: AbortSignal,
): Promise<OpenedArchive> {
  if (signal?.aborted) {
    throw new ToolError('cancelled', 'Reading this archive was cancelled.', 'Nothing was extracted.');
  }

  const { runZipJob } = await import('./client');
  const result = await runZipJob({ kind: 'read', file, limits, password }, { onProgress, signal });
  if (result.kind !== 'read') throw new ToolError('unknown', 'The ZIP worker returned an unexpected result.');
  return result.outcome;
}

/**
 * Creates a ZIP, enforcing a cumulative input budget **before reading a byte**.
 *
 * The budget is computed from `Blob.size`, which is metadata: no `arrayBuffer()`
 * call, no `Uint8Array`, no assembly happens until the decision is made. Sizes
 * are re-checked while streaming in (a `Blob` cannot lie about `.size`, but a
 * derived blob or a future `ReadableStream` input might).
 */
export async function createZip(
  files: readonly { name: string; blob: Blob }[],
  options: {
    onProgress?: (ratio: number) => void;
    signal?: AbortSignal;
    /** Omit for a plain archive. Setting it switches engine and budget. */
    password?: string;
    /** Defaults to AES-256; ZipCrypto must be asked for explicitly. */
    encryption?: import('./inspect').ZipEncryptionKind;
  } = {},
): Promise<Blob> {
  if (options.signal?.aborted) {
    throw new ToolError('cancelled', 'Building the archive was cancelled.', 'Nothing was downloaded.');
  }

  // Loaded lazily so the client (and its worker URL) is only fetched on use.
  const { runZipOperation } = await import('./client');
  const outcome = await runZipOperation(
    {
      kind: 'create',
      entries: files.map((file) => ({ name: file.name, blob: file.blob })),
      ...(options.password
        ? { encryption: { kind: options.encryption ?? 'aes-256', password: options.password } }
        : {}),
    },
    { onProgress: options.onProgress, signal: options.signal },
  );
  // `Blob` copies the view's bytes, so no defensive array copy is needed here.
  return new Blob([outcome.archive as BlobPart], { type: 'application/zip' });
}
