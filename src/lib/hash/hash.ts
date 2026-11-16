/**
 * Hashing via WebCrypto. Everything happens on-device; no digest ever leaves the
 * browser unless the user copies it.
 *
 * WebCrypto has no streaming digest API, so the whole buffer must be resident.
 * We therefore cap file hashing at 512 MB and explain the limitation in the UI.
 */
export type HashAlgorithm = 'SHA-256' | 'SHA-1' | 'SHA-384' | 'SHA-512';

export const HASH_ALGORITHMS: { value: HashAlgorithm; label: string; bits: number }[] = [
  { value: 'SHA-256', label: 'SHA-256', bits: 256 },
  { value: 'SHA-512', label: 'SHA-512', bits: 512 },
  { value: 'SHA-1', label: 'SHA-1 (legacy)', bits: 160 },
];

export const MAX_HASH_BYTES = 512 * 1024 * 1024;

export function isCryptoAvailable(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle;
}

export async function hashBuffer(buffer: ArrayBuffer, algorithm: HashAlgorithm): Promise<string> {
  if (!isCryptoAvailable()) {
    throw new Error('Web Crypto is unavailable. Open ZeroUpload over HTTPS or from localhost.');
  }
  const digest = await crypto.subtle.digest(algorithm, buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashText(text: string, algorithm: HashAlgorithm = 'SHA-256'): Promise<string> {
  return hashBuffer(new TextEncoder().encode(text).buffer as ArrayBuffer, algorithm);
}

/**
 * Digest of a file, read once and hashed in memory.
 *
 * The cap is not arbitrary: `crypto.subtle.digest` is one-shot, so the whole file
 * has to be resident, and a 2 GB video would take the tab with it. The refusal is
 * explicit rather than a crash.
 */
export async function hashFile(file: Blob & { name?: string }, algorithm: HashAlgorithm): Promise<string> {
  if (file.size > MAX_HASH_BYTES) {
    throw new Error(
      `${file.name ?? 'This file'} is larger than the 512 MB a browser digest can hold in memory.`,
    );
  }
  return hashBuffer(await file.arrayBuffer(), algorithm);
}

/**
 * The bit length a pasted value most plausibly is, from its own length.
 *
 * A hex digest of n characters carries 4n bits, so 64 characters is a SHA-256
 * value and 40 characters a SHA-1 one. Used to tell "wrong file" from "wrong
 * algorithm selected", which is the far more common cause of a failed comparison.
 */
export function digestBitsIn(value: string): number | null {
  const cleaned = value
    .toLowerCase()
    .replace(/^(sha-?\d+|md5)[\s:=-]*/, '')
    .replace(/[\s:_-]+/g, '');
  const run = (cleaned.match(/[0-9a-f]+/g) ?? []).filter((part) => part.length >= 8).sort((a, b) => b.length - a.length)[0];
  return run ? run.length * 4 : null;
}

export interface DigestCheck {
  /** True only when the field holds exactly the digest that was computed. */
  match: boolean;
  /** The digest found in the field, or '' when there was none. */
  expected: string;
  /** Why the comparison could not be made, when that is the case. */
  problem?: 'empty' | 'not-hex' | 'wrong-length';
}

/**
 * Compare a pasted checksum with a computed digest.
 *
 * Published checksums arrive in every shape people can paste from: uppercase,
 * spaced in groups of eight, prefixed `sha256:`, wrapped in `SHA256 (file.iso) = …`
 * from `sha256sum -c` output, with a leading `\`, or with the filename on the same
 * line. Parsing that grammar properly would be a small parser for one field, so the
 * rule is simpler and more forgiving: find the longest hexadecimal run and compare
 * that.
 *
 * A value that cannot be a digest of this algorithm is reported as such rather than
 * as "mismatch" — calling a paste problem a corrupted download sends someone
 * hunting for the wrong bug.
 */
export function checkDigest(expected: string, actual: string, algorithm: HashAlgorithm): DigestCheck {
  const bits = HASH_ALGORITHMS.find((entry) => entry.value === algorithm)?.bits ?? 256;
  const wanted = bits / 4;

  if (!expected.trim()) return { match: false, expected: '', problem: 'empty' };

  /*
   * An algorithm label first (`sha256:`, `SHA-256 =`), because its trailing digits
   * are hexadecimal and would otherwise fuse with the digest into one long run.
   * Then the separators that appear inside a printed digest (spaces in groups of
   * eight, hyphens, colons); whatever is left around the hex is prose.
   */
  const stripped = expected
    .toLowerCase()
    .replace(/^(sha-?\d+|md5)[\s:=-]*/, '')
    .replace(/[\s:_-]+/g, '');
  const runs = (stripped.match(/[0-9a-f]+/g) ?? []).filter((run) => run.length >= 8);
  if (runs.length === 0) return { match: false, expected: '', problem: 'not-hex' };

  const exact = runs.find((run) => run.length === wanted);
  if (exact) return { match: exact === actual.toLowerCase(), expected: exact };

  // No run of the right length: the longest is what the reader probably meant.
  const longest = runs.reduce((a, b) => (b.length > a.length ? b : a));
  return { match: false, expected: longest, problem: 'wrong-length' };
}
