/**
 * A browser stand-in for the few Node `crypto` entry points `office-crypto`
 * imports.
 *
 * The published `office-crypto` build starts with
 * `import { createHash, createCipheriv, … } from "crypto"`, so it cannot be
 * bundled for a static site as-is. Rather than fork it, the build aliases the
 * bare `crypto` specifier to this module (see `vite.config.ts`): the library's
 * own decryption logic stays untouched and only its primitive layer is swapped
 * for `@noble/hashes` + `@noble/ciphers`, which are synchronous and available in
 * every browser.
 *
 * This was verified before adoption (docs/v2-proofs.md): the shimmed bundle
 * decrypts msoffcrypto-tool's files byte-identically, for .docx, .xlsx and
 * .pptx, and rejects a wrong password.
 *
 * Certificate-based (`privateKey`) decryption is deliberately unsupported — a
 * password tool has no business pretending to read smart-card-protected files.
 */
import { sha1 } from '@noble/hashes/legacy.js';
import { sha256, sha384, sha512 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { cbc, ecb } from '@noble/ciphers/aes.js';
import type { CHash } from '@noble/hashes/utils.js';

type Bytes = Uint8Array;

/** `@noble/hashes` hashes are callables with metadata; one type covers them all. */
type HashFn = CHash;

const HASHES: Record<string, HashFn> = { sha1, sha256, sha384, sha512 };

function resolveHash(algorithm: string): HashFn {
  const name = String(algorithm).toLowerCase().replace(/-/g, '');
  const fn = HASHES[name];
  if (!fn) throw new Error(`Unsupported hash for the browser crypto shim: ${algorithm}`);
  return fn;
}

function concat(chunks: Bytes[]): Bytes {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** `createHash(...).update(chunk).digest()`, the way the library calls it. */
export function createHash(algorithm: string) {
  const fn = resolveHash(algorithm);
  const chunks: Bytes[] = [];
  return {
    update(chunk: Bytes) {
      chunks.push(chunk);
      return this;
    },
    digest(): Bytes {
      return fn(concat(chunks));
    },
  };
}

export function createHmac(algorithm: string, key: Bytes) {
  const fn = resolveHash(algorithm);
  const chunks: Bytes[] = [];
  return {
    update(chunk: Bytes) {
      chunks.push(chunk);
      return this;
    },
    digest(): Bytes {
      return hmac(fn, key, concat(chunks));
    },
  };
}

const pkcs7Pad = (data: Bytes, blockSize = 16): Bytes => {
  const pad = blockSize - (data.length % blockSize);
  const out = new Uint8Array(data.length + pad);
  out.set(data);
  out.fill(pad, data.length);
  return out;
};

const pkcs7Unpad = (data: Bytes): Bytes => {
  const pad = data[data.length - 1];
  return pad > 0 && pad <= 16 ? data.subarray(0, data.length - pad) : data;
};

/**
 * `createCipheriv` / `createDecipheriv` for `aes-*-cbc` and `aes-*-ecb`.
 *
 * The library always calls `setAutoPadding(false)`, feeds one `update()` and one
 * `final()`, so this buffers the input and transforms it once. Padding is still
 * implemented, because a silent no-op `setAutoPadding` would be a trap for any
 * future caller.
 */
const cipherFactory = (direction: 'encrypt' | 'decrypt') => (algorithm: string, key: Bytes, iv: Bytes | null) => {
  const name = String(algorithm).toLowerCase();
  const chunks: Bytes[] = [];
  let autoPadding = true;

  const run = (data: Bytes): Bytes => {
    const engine = name.includes('ecb')
      ? ecb(key)
      : cbc(key, (iv ?? new Uint8Array(16)) as Bytes, { disablePadding: true });
    if (direction === 'encrypt') {
      return engine.encrypt(autoPadding ? pkcs7Pad(data) : data);
    }
    const plain = engine.decrypt(data);
    return autoPadding ? pkcs7Unpad(plain) : plain;
  };

  return {
    setAutoPadding(value = true) {
      autoPadding = value;
      return this;
    },
    update(chunk: Bytes) {
      chunks.push(chunk);
      return new Uint8Array(0);
    },
    final(): Bytes {
      const merged = concat(chunks);
      chunks.length = 0;
      return run(merged);
    },
  };
};

export const createCipheriv = cipherFactory('encrypt');
export const createDecipheriv = cipherFactory('decrypt');

export const constants = { RSA_PKCS1_PADDING: 4 };

export function createPrivateKey(): never {
  throw new Error('Certificate-protected documents are not supported in the browser build.');
}

export function privateDecrypt(): never {
  throw new Error('Certificate-protected documents are not supported in the browser build.');
}

/** Reached through `require("crypto").randomFillSync` when the library encrypts. */
export function randomFillSync<T extends Uint8Array>(target: T): T {
  globalThis.crypto.getRandomValues(target);
  return target;
}

export function randomBytes(size: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(size));
}
