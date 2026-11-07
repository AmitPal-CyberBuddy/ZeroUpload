import { processImage } from './processor';
import type { ImageJob, ImageJobResult } from './types';

/**
 * "Make this file smaller than X."
 *
 * The quality slider asks the user to guess at a number that has no fixed meaning:
 * quality 70 on a 4000px photograph and on a 300px icon produce wildly different
 * file sizes, and neither is predictable without encoding it. The job people
 * actually have — "this has to be under 500 KB to upload to a portal" — is a
 * *size*, not a quality.
 *
 * So this searches. Quality is monotonic in output size for a given encoder and
 * image, which makes a binary search both correct and cheap: ten probes cover
 * 20–95 to a single point of quality, and each probe is a real encode of the real
 * job, not a model of one.
 *
 * What it will not do is promise the number. A target can be unreachable — a
 * 12-megapixel image cannot be squeezed into 40 KB at a usable quality — so the
 * result reports the closest it got and whether it was met, rather than silently
 * returning something too big.
 */

export interface TargetSearchResult {
  result: ImageJobResult;
  quality: number;
  /** True when the output really is at or below the requested size. */
  met: boolean;
  /** Number of encodes it took; surfaced so the UI can say "8 passes". */
  probes: number;
}

export interface TargetSearchOptions {
  /** Bytes the output must not exceed. */
  targetBytes: number;
  /** 0–1 bounds for the search. */
  minQuality?: number;
  maxQuality?: number;
  /** Passed through from the tool so a cancelled run stops between probes. */
  shouldAbort?: () => boolean;
  onProbe?: (quality: number, bytes: number) => void;
}

/**
 * Largest quality whose output fits `targetBytes`.
 *
 * The search keeps the best *fitting* result rather than converging on a quality
 * value: if even the lowest quality is too big, the smallest output found is
 * returned with `met: false`, which is more useful than an error.
 */
export async function compressToTarget(
  job: Omit<ImageJob, 'id' | 'file'>,
  file: Blob,
  { targetBytes, minQuality = 0.2, maxQuality = 0.95, shouldAbort, onProbe }: TargetSearchOptions,
): Promise<TargetSearchResult> {
  let best: { result: ImageJobResult; quality: number } | null = null;
  let smallest: { result: ImageJobResult; quality: number } | null = null;
  let low = minQuality;
  let high = maxQuality;
  let probes = 0;

  // Eight probes: log2(0.75 / 0.01) ≈ 6.2, so this leaves margin for the
  // integer-ish behaviour of some encoders without wasting encodes.
  while (probes < 8) {
    if (shouldAbort?.()) {
      throw new Error('cancelled');
    }

    const quality = (low + high) / 2;
    probes += 1;
    const result = await processImage({ ...job, file, quality });
    onProbe?.(quality, result.blob.size);

    if (!smallest || result.blob.size < smallest.result.blob.size) {
      smallest = { result, quality };
    }

    if (result.blob.size <= targetBytes) {
      best = { result, quality };
      // Already fitting: try to buy back quality.
      low = quality;
      // Stop when the window is narrower than a percent — another encode cannot
      // meaningfully improve the answer.
      if (high - low < 0.01) break;
    } else {
      high = quality;
      if (high - low < 0.01) break;
    }
  }

  const chosen = best ?? smallest!;
  return {
    result: chosen.result,
    quality: Math.round(chosen.quality * 100),
    met: chosen.result.blob.size <= targetBytes,
    probes,
  };
}
