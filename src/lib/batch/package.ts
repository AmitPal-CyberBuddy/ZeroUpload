/**
 * Packaging batch results into one download.
 *
 * The only copy that happens is fflate's, inside `createZip`: each result `Blob`
 * is read once and compressed. No base64, no re-encode, and no second copy of a
 * result is made here — the blobs handed over are the same objects the queue
 * holds, which is why nothing is duplicated when a user packages instead of
 * downloading files one by one.
 *
 * Packaging does not release anything by itself: the caller decides, because
 * downloading the ZIP and losing the individual files may not be what the user
 * wants.
 */
import { ToolError } from '../files/errors';
import { createZip } from '../zip/zip';
import type { BatchItem } from './types';

export interface PackageResult {
  blob: Blob;
  name: string;
  count: number;
  /** Bytes of the packaged inputs before compression. */
  inputBytes: number;
}

export interface PackageOptions {
  /** Filename for the archive. */
  name?: string;
  onProgress?: (ratio: number) => void;
}

export async function packageResults(
  items: readonly BatchItem[],
  options: PackageOptions = {},
): Promise<PackageResult> {
  const packaged = items
    .filter((item): item is BatchItem & { blob: Blob } => item.state === 'completed' && !!item.blob)
    .map((item) => ({
      name: item.result?.name ?? item.name,
      blob: item.blob,
      bytes: item.blob.size,
    }));

  if (packaged.length === 0) {
    throw new ToolError(
      'empty-input',
      'There are no completed results to package.',
      'Finish at least one file, or release the ones you have already downloaded.',
    );
  }

  const inputBytes = packaged.reduce((sum, entry) => sum + entry.bytes, 0);

  // `createZip` re-checks its own cumulative budget against these blobs, so a
  // batch that fits its output budget still cannot build an absurd archive.
  const blob = await createZip(
    packaged.map((entry) => ({ name: entry.name, blob: entry.blob })),
    options.onProgress,
  );

  return {
    blob,
    name: options.name ?? 'zeroupload-batch.zip',
    count: packaged.length,
    inputBytes,
  };
}
