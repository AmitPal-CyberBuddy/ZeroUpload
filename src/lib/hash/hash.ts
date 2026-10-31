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

/** Non-cryptographic 53-bit hash for quick duplicate detection in the UI. */
export function quickFingerprint(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}
