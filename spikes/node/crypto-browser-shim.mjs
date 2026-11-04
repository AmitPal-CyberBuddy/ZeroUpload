/**
 * A browser stand-in for Node's `crypto`, sized exactly to what `office-crypto`
 * imports: createHash, createHmac, createCipheriv, createDecipheriv,
 * createPrivateKey, privateDecrypt, constants.
 *
 * `office-crypto` ships a Node-only ESM build (`import … from "crypto"`), so it
 * cannot be dropped into a static site as-is. This file is the measurement of how
 * much work that gap is: ~60 lines, because @noble/hashes and @noble/ciphers are
 * synchronous and work in every browser.
 *
 * Certificate-based (privateKey) decryption is out of scope for a password tool,
 * so those two entry points throw instead of pretending.
 */
import { sha1 } from '@noble/hashes/legacy.js';
import { sha256, sha384, sha512 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { cbc, ecb } from '@noble/ciphers/aes.js';

const HASHES = { sha1, sha256, sha384, sha512 };
const resolve = (algorithm) => {
  const name = String(algorithm).toLowerCase().replace('-', '');
  const fn = HASHES[name];
  if (!fn) throw new Error(`Unsupported hash in the browser shim: ${algorithm}`);
  return fn;
};

export function createHash(algorithm) {
  const fn = resolve(algorithm);
  const parts = [];
  return {
    update(chunk) {
      parts.push(chunk);
      return this;
    },
    digest() {
      const total = parts.reduce((sum, part) => sum + part.length, 0);
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const part of parts) {
        merged.set(part, offset);
        offset += part.length;
      }
      return fn(merged);
    },
  };
}

export function createHmac(algorithm, key) {
  const fn = resolve(algorithm);
  const parts = [];
  return {
    update(chunk) {
      parts.push(chunk);
      return this;
    },
    digest() {
      const total = parts.reduce((sum, part) => sum + part.length, 0);
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const part of parts) {
        merged.set(part, offset);
        offset += part.length;
      }
      return hmac(fn, key, merged);
    },
  };
}

const pkcs7 = (data, blockSize = 16) => {
  const pad = blockSize - (data.length % blockSize);
  const out = new Uint8Array(data.length + pad);
  out.set(data);
  out.fill(pad, data.length);
  return out;
};

const unpkcs7 = (data) => {
  const pad = data[data.length - 1];
  return pad > 0 && pad <= 16 ? data.subarray(0, data.length - pad) : data;
};

/**
 * Node's crypto API surface as `office-crypto` uses it: `setAutoPadding(false)`,
 * one `update()`, one `final()`, and both CBC and ECB names.
 */
const cipherFactory = (direction) => (algorithm, key, iv) => {
  const name = String(algorithm).toLowerCase();
  const chunks = [];
  let autoPadding = true;
  const run = (data) => {
    const engine = name.includes('ecb') ? ecb(key) : cbc(key, iv, { disablePadding: true });
    const input = direction === 'encrypt' && autoPadding ? pkcs7(data) : data;
    const output = direction === 'encrypt' ? engine.encrypt(input) : engine.decrypt(input);
    return direction === 'decrypt' && autoPadding ? unpkcs7(output) : output;
  };
  return {
    setAutoPadding(value = true) {
      autoPadding = value;
      return this;
    },
    update(chunk) {
      chunks.push(chunk);
      return new Uint8Array(0);
    },
    final() {
      const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      chunks.length = 0;
      return run(merged);
    },
  };
};

export const createCipheriv = cipherFactory('encrypt');
export const createDecipheriv = cipherFactory('decrypt');

export const constants = { RSA_PKCS1_PADDING: 4 };

export function createPrivateKey() {
  throw new Error('Certificate-protected documents are not supported in the browser build.');
}

export function privateDecrypt() {
  throw new Error('Certificate-protected documents are not supported in the browser build.');
}

/** `office-crypto` reaches for `require("crypto").randomFillSync` when encrypting. */
export function randomFillSync(target) {
  globalThis.crypto.getRandomValues(target);
  return target;
}

export function randomBytes(size) {
  return globalThis.crypto.getRandomValues(new Uint8Array(size));
}
