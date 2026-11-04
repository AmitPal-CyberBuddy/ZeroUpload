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
