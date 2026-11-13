/**
 * Incremental hashing for large blobs.
 *
 * `crypto.subtle.digest` is one-shot: the whole file has to be resident before it
 * can be hashed, which is why `MAX_HASH_BYTES` exists and why the Hash tool used
 * to describe its own limit as a limitation of the browser. It is a limitation of
 * *WebCrypto*, not of the browser: `@noble/hashes` is already a dependency (the
 * Office decryptor and the file comparator both use it) and it updates
 * incrementally, so a file can be read in slices the way `compare.ts` already
 * reads two.
 *
 * Bringing the loop here does three things a one-shot digest cannot:
 *
 *  - **progress** — a 512 MB hash can report how far along it is,
 *  - **cancellation** — an `AbortSignal` is checked between slices, so a slow
 *    hash can be stopped, and
 *  - **a much higher ceiling** — peak memory is one slice, not one file, so the
 *    cap becomes a policy choice (`MAX_STREAM_HASH_BYTES`) rather than a hard
 *    physical limit.
 *
 * `compare.ts` keeps its own interleaved loop on purpose: it must read *both*
 * files in step to compare bytes as it goes, and sharing a loop with this module
 * would mean reading one file twice. The digest construction is the same code.
 */
import { sha1 } from '@noble/hashes/legacy.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { HashAlgorithm } from './hash';

/**
 * Ceiling for the streaming path.
 *
 * Four gigabytes is not a memory limit any more — peak memory is one slice — it
 * is a *time* limit: a browser digest runs at roughly 200–400 MB/s, so 4 GB is
 * already around fifteen seconds of work the tab is doing. The refusal stays
 * explicit rather than being a crash or a silent truncation.
 */
export const MAX_STREAM_HASH_BYTES = 4 * 1024 * 1024 * 1024;

/** One MiB matches `compare.ts`; big enough to amortise, small enough to stay cheap. */
const SLICE_BYTES = 1024 * 1024;

type Hasher = { update: (data: Uint8Array) => void; digest: () => Uint8Array; destroy: () => void };

function createHasher(algorithm: HashAlgorithm): Hasher {
  switch (algorithm) {
    case 'SHA-1':
      return sha1.create();
    case 'SHA-512':
      return sha512.create();
    case 'SHA-256':
    default:
      return sha256.create();
  }
}

export interface StreamHashOptions {
  /** Called with 0–1 after each slice. Never called for an empty blob. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  /** Smaller slices are useful in tests. Production uses one MiB. */
  sliceSize?: number;
}

/**
 * Hashes a blob in slices, yielding to the event loop between them.
 *
 * The `await` on each slice is what lets the browser paint the progress bar and
 * deliver a click on Cancel; without it this would be one long synchronous loop
 * that reported progress nobody could see.
 */
export async function streamHash(
  blob: Blob,
  algorithm: HashAlgorithm,
  options: StreamHashOptions = {},
): Promise<string> {
  if (blob.size > MAX_STREAM_HASH_BYTES) {
    throw new Error(
      `Hashing is limited to ${MAX_STREAM_HASH_BYTES / (1024 * 1024 * 1024)} GB per file.`,
    );
  }
  const sliceSize = options.sliceSize ?? SLICE_BYTES;
  if (!Number.isSafeInteger(sliceSize) || sliceSize < 1 || sliceSize > SLICE_BYTES) {
    throw new Error('Invalid hash slice size.');
  }

  const hasher = createHasher(algorithm);
  const total = blob.size;
  try {
    if (total === 0) {
      options.onProgress?.(1);
      return bytesToHex(hasher.digest());
    }

    for (let offset = 0; offset < total; offset += sliceSize) {
      if (options.signal?.aborted) throw new HashCancelledError();
      const slice = new Uint8Array(await blob.slice(offset, offset + sliceSize).arrayBuffer());
      hasher.update(slice);
      options.onProgress?.(Math.min(1, (offset + slice.length) / total));
      // Yield: a digest over 512 MB with no await would block paint and input.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    if (options.signal?.aborted) throw new HashCancelledError();
    return bytesToHex(hasher.digest());
  } finally {
    hasher.destroy();
  }
}

/** Distinguished from a real failure so the UI can stay neutral, as it does elsewhere. */
export class HashCancelledError extends Error {
  constructor() {
    super('Hashing was cancelled.');
    this.name = 'HashCancelledError';
  }
}
