/**
 * Fixtures shared by the tests. Kept dependency-light: `zipSync` from fflate is
 * the same library the app ships, so the archives under test are real archives,
 * not hand-built byte arrays that could accidentally differ from production.
 */
import { Zip, ZipDeflate, strToU8, zipSync } from 'fflate';

/** Builds a real ZIP from name → content pairs. `level: 0` keeps sizes honest. */
export function makeZip(entries: [string, Uint8Array][], level: 0 | 6 = 0): Uint8Array {
  return zipSync(Object.fromEntries(entries) as Record<string, Uint8Array>, { level });
}

/**
 * Builds a ZIP that contains the **same** entry name twice. `zipSync` takes an
 * object, so it cannot express duplicates; the streaming `Zip` API can.
 */
export function makeZipWithDuplicateName(name: string, contents: string[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  let done = false;
  const zip = new Zip((error, chunk, final) => {
    if (error) throw error;
    chunks.push(chunk);
    if (final) done = true;
  });
  for (const text of contents) {
    const file = new ZipDeflate(name, { level: 6 });
    zip.add(file);
    file.push(strToU8(text), true);
  }
  zip.end();
  if (!done) throw new Error('archive was not finalised');
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** A Blob-like object that counts reads, for "must not read before deciding" tests. */
export function unreadableBlob(size: number): Blob & { reads: number } {
  const blob = {
    size,
    type: '',
    reads: 0,
    arrayBuffer() {
      blob.reads += 1;
      throw new Error('the budget check read the file, which it must not do');
    },
    slice() {
      throw new Error('unexpected slice');
    },
  };
  return blob as unknown as Blob & { reads: number };
}

/** Deterministic pseudo-random bytes (no crypto, no flakiness). */
export function bytes(length: number, seed = 1): Uint8Array {
  const out = new Uint8Array(length);
  let value = seed;
  for (let i = 0; i < length; i += 1) {
    value = (value * 1103515245 + 12345) & 0x7fffffff;
    out[i] = value >> 16;
  }
  return out;
}

export const MB = 1024 * 1024;

/**
 * `new Blob([uint8])` needs a cast under TS 5.9 because `Uint8Array` is generic
 * over `ArrayBufferLike` while `BlobPart` wants `ArrayBuffer`. Kept in one place.
 */
export function blobOf(bytes: Uint8Array, type = ''): Blob {
  return new Blob([bytes as BlobPart], { type });
}
