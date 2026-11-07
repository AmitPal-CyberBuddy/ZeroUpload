/**
 * The archive builder itself.
 *
 * This is the **only** implementation of ZIP creation. It runs in the worker
 * (`zip.worker.ts`) and, when a worker cannot be created, on the main thread
 * through `client.ts`. Keeping one copy is the point: every guard below —
 * cumulative budget from metadata, entry-name sanitising, duplicate renaming,
 * the post-read size re-check, cancellation — applies identically on both
 * paths, and there is no second place for a future fix to be forgotten.
 *
 * Safety model (see also `zip.ts`, which owns extraction):
 *
 *  - The cumulative input budget is decided from `Blob.size` **before** a single
 *    byte is read. A rejected request costs no allocation.
 *  - Sizes are re-checked as each entry is read, because a derived blob could in
 *    principle disagree with its metadata.
 *  - Entry names are sanitised and duplicates renamed, so an archive built here
 *    can never contain a traversal path or two entries with the same name.
 */
import { ToolError } from '../files/errors';
import { OPERATION_BUDGETS, assertCumulativeBudget, type OperationBudget } from '../files/budget';
import type { ZipCompression, ZipEncryptionRequest, ZipProgress, ZipSource } from './protocol';
import { sanitizeEntryName, uniqueEntryName } from './names';

export interface ZipCreateContext {
  onProgress?: (progress: ZipProgress) => void;
  /** Cooperative cancellation, polled between entries and before finalising. */
  isCancelled?: () => boolean;
  /**
   * Set inside the worker: we are already off the main thread, so DEFLATE can run
   * synchronously instead of spawning fflate's own nested worker (which would
   * copy the whole archive across yet another boundary).
   */
  syncDeflate?: boolean;
  /**
   * Overrides the cumulative budget. Production never passes this — it exists so
   * tests can exercise the post-read re-check without allocating half a gigabyte.
   */
  budget?: OperationBudget;
  /**
   * When set, the archive is encrypted. The engine changes (fflate cannot
   * encrypt) but the budget, naming and cancellation rules do not: they all run
   * above this branch, so an encrypted archive is exactly as guarded as a plain
   * one, and only the final packaging step differs.
   */
  encryption?: ZipEncryptionRequest;
  /**
   * `store` writes every entry uncompressed (`level: 0`). Defaults to DEFLATE,
   * which is what most files want and what every previous archive used.
   */
  compression?: ZipCompression;
}

export interface ArchiveResult {
  archive: Uint8Array;
  entryCount: number;
  inputBytes: number;
}

export const ZIP_CREATE_BUDGET = OPERATION_BUDGETS.zipCreate;
export const ZIP_CREATE_ENCRYPTED_BUDGET = OPERATION_BUDGETS.zipCreateEncrypted;

/** Hands control back to the host so a queued cancel message can be delivered. */
const yieldToHost = () => new Promise((resolve) => setTimeout(resolve, 0));

function assertActive(context: ZipCreateContext): void {
  if (context.isCancelled?.()) {
    throw new ToolError(
      'cancelled',
      'Building the archive was cancelled.',
      'The partial archive was discarded; no file was downloaded.',
    );
  }
}

export async function createArchive(
  entries: readonly ZipSource[],
  context: ZipCreateContext = {},
): Promise<ArchiveResult> {
  if (entries.length === 0) {
    throw new ToolError('empty-input', 'Add at least one file to build an archive.');
  }

  const budget = context.budget ?? (context.encryption ? ZIP_CREATE_ENCRYPTED_BUDGET : ZIP_CREATE_BUDGET);

  // Metadata only. Nothing has been read or allocated at this point.
  assertCumulativeBudget(
    entries.map((entry) => ({ name: entry.name, size: entry.blob.size })),
    budget,
  );

  const total = entries.length;
  const report = (progress: ZipProgress) => context.onProgress?.(progress);

  const collected: { name: string; bytes: Uint8Array }[] = [];
  const used = new Map<string, number>();
  let inputBytes = 0;

  for (let index = 0; index < entries.length; index += 1) {
    assertActive(context);

    const entry = entries[index];
    const bytes = new Uint8Array(await entry.blob.arrayBuffer());
    inputBytes += bytes.byteLength;
    if (inputBytes > budget.maxBytes) {
      // Cannot happen with honest `Blob.size`, so reaching this means the inputs
      // changed under us. Refuse instead of finishing the allocation.
      throw new ToolError(
        'limit-exceeded',
        'These files are larger than their reported sizes.',
        budget.hint,
      );
    }

    const base = sanitizeEntryName(entry.name) || `file-${index + 1}`;
    collected.push({ name: uniqueEntryName(base, used), bytes });

    report({ completed: index + 1, total, inputBytes, phase: 'compressing' });
    // Cheap on the main thread, necessary in the worker: without yielding, a
    // cancel message sits in the queue until the whole archive is built.
    if (index % 8 === 7) await yieldToHost();
  }

  assertActive(context);
  report({ completed: total, total, inputBytes, phase: 'finalising' });

  if (context.encryption) {
    const { buildEncryptedArchive } = await import('./encrypted');
    const archive = await buildEncryptedArchive(collected, context.encryption, {
      isCancelled: context.isCancelled,
      compression: context.compression,
    });
    // A cancel that arrived during encryption still wins.
    assertActive(context);
    return { archive, entryCount: total, inputBytes };
  }

  /*
   * fflate's `level: 0` is a stored entry: the bytes go in as they are. That is a
   * real choice rather than a hidden setting — packing photos, video or other
   * archives with DEFLATE costs seconds of CPU to save nothing, and the result is
   * sometimes larger than the input.
   */
  const level = context.compression === 'store' ? 0 : 6;
  const input: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  for (const entry of collected) input[entry.name] = [entry.bytes, { level }];

  const { zip, zipSync } = await import('fflate');
  let archive: Uint8Array;
  try {
    archive = context.syncDeflate
      ? zipSync(input, { level })
      : await new Promise<Uint8Array>((resolve, reject) => {
          zip(input, { level }, (error, data) => {
            if (error) reject(error);
            else resolve(data);
          });
        });
  } catch {
    throw new ToolError(
      'unknown',
      'The browser could not build this archive.',
      'Try fewer or smaller files.',
    );
  }

  // A cancel that arrived during DEFLATE still wins: better to discard finished
  // bytes than to hand back an archive the user asked to stop.
  assertActive(context);

  return { archive, entryCount: total, inputBytes };
}
