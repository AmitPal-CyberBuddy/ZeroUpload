/**
 * Reading an archive's central directory: the parts of ZIP encryption support
 * that need no ZIP engine at all.
 *
 * `encrypted.ts` imports `@zip.js/zip.js` to actually encrypt and decrypt, and it
 * is loaded on demand only when a password is involved. This module holds the
 * pieces that every ZIP read needs — "is this archive encrypted, and with what?"
 * — as plain byte arithmetic over the central directory, with no imports beyond
 * the error type.
 *
 * They live here rather than in `encrypted.ts` for a concrete reason: `zip.ts`
 * needs `inspectZipEncryption` eagerly (every extraction calls it) *and* imports
 * `readEncryptedZip` lazily. When both lived in one module, Rollup could see the
 * static import winning and reported the dynamic one as ineffective — which was
 * true, and meant the 70 kB encryption engine was pulled into the extraction path
 * whether or not anyone typed a password. Splitting the pure half from the engine
 * makes the lazy import genuinely lazy.
 */
import { ZIP_TAIL_BYTES } from './tail';


export type ZipEncryptionKind = 'aes-256' | 'zipcrypto';

export const ZIP_ENCRYPTION_LABEL: Record<ZipEncryptionKind, string> = {
  'aes-256': 'AES-256 (WinZip AE-2)',
  zipcrypto: 'ZipCrypto (legacy)',
};

export const MIN_AES_PASSWORD_LENGTH = 8;
export const MIN_ZIPCRYPTO_PASSWORD_LENGTH = 6;

/**
 * WinZip AES marks every entry with method 99 and an `0x9901` extra field;
 * ZipCrypto keeps the real method and sets general-purpose bit 0.
 *
 * Detection reads the central directory only — no decompression, no allocation
 * beyond the directory itself — so the extract tool can decide what to do with
 * an archive before touching its contents.
 */
export interface ZipEncryptionInfo {
  kind: ZipEncryptionKind | null;
  entryCount: number;
}

const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;

function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

/**
 * Walks the central directory and reports whether entries are encrypted.
 *
 * The end-of-central-directory record sits within the last 64 KiB (the comment
 * field is bounded), so the scan starts there instead of parsing from the front.
 */
export function inspectZipEncryption(bytes: Uint8Array): ZipEncryptionInfo {
  let eocd = -1;
  const stop = Math.max(0, bytes.length - ZIP_TAIL_BYTES);
  for (let offset = bytes.length - 22; offset >= stop; offset -= 1) {
    if (u32(bytes, offset) === END_OF_CENTRAL_DIRECTORY) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) return { kind: null, entryCount: 0 };

  const entryCount = u16(bytes, eocd + 10);
  let offset = u32(bytes, eocd + 16);
  let kind: ZipEncryptionKind | null = null;

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.length || u32(bytes, offset) !== CENTRAL_HEADER) break;
    const flags = u16(bytes, offset + 8);
    const method = u16(bytes, offset + 10);
    const nameLength = u16(bytes, offset + 28);
    const extraLength = u16(bytes, offset + 30);
    const commentLength = u16(bytes, offset + 32);

    if (flags & 0x0001) {
      if (method === 99) kind = 'aes-256';
      else if (kind === null) kind = 'zipcrypto';
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return { kind, entryCount };
}
