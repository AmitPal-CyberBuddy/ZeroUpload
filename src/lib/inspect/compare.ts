import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { MAX_HASH_BYTES } from '../hash/hash';
import { ToolError } from '../files/errors';

/** Compare actual bytes while incrementally hashing both inputs, with bounded buffers. */
export async function compareFiles(first: Blob, second: Blob, options: {
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
  /** Smaller sizes are useful for tests; production uses one MiB. */
  chunkSize?: number;
} = {}) {
  if (first.size > MAX_HASH_BYTES || second.size > MAX_HASH_BYTES) {
    throw new ToolError('too-large', 'Comparison is limited to 512 MB per file.', 'Choose smaller files to compare.');
  }
  const chunkSize = options.chunkSize ?? 1024 * 1024;
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > 1024 * 1024) throw new Error('Invalid comparison chunk size.');
  const assertActive = () => {
    if (options.signal?.aborted) throw new ToolError('cancelled', 'Comparison was cancelled.');
  };
  const left = sha256.create(); const right = sha256.create();
  const total = Math.max(first.size, second.size);
  let firstDifference: number | null = null;
  try {
    assertActive();
    for (let offset = 0; offset < total; offset += chunkSize) {
      assertActive();
      const a = new Uint8Array(await first.slice(offset, offset + chunkSize).arrayBuffer());
      const b = new Uint8Array(await second.slice(offset, offset + chunkSize).arrayBuffer());
      assertActive();
      left.update(a); right.update(b);
      if (firstDifference === null) {
        const commonLength = Math.min(a.length, b.length);
        for (let i = 0; i < commonLength; i++) {
          if (a[i] !== b[i]) { firstDifference = offset + i; break; }
        }
        if (firstDifference === null && a.length !== b.length) firstDifference = offset + commonLength;
      }
      options.onProgress?.(Math.min(1, (offset + chunkSize) / total));
      // Yield to allow painting and cancellation; digest and comparisons are synchronous.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    assertActive();
    return { identical: firstDifference === null, firstDifference, firstHash: bytesToHex(left.digest()), secondHash: bytesToHex(right.digest()) };
  } finally { left.destroy(); right.destroy(); }
}
