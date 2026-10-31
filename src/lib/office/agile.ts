/**
 * Agile OOXML encryption — [MS-OFFCRYPTO] §2.3.4.7 — in the browser.
 *
 * Nothing on npm encrypts an Office document: `office-crypto`, `msoffice-crypto`
 * and their relatives decrypt only, and their crypto layer is Node-only anyway.
 * So the writer exists here, implemented against the specification and verified
 * against msoffcrypto-tool, which decrypts the result byte-identically with its
 * HMAC integrity check enabled (`docs/v2-proofs.md`).
 *
 * Two things in this file are not obvious, and both were measured rather than
 * assumed:
 *
 *  1. **The spin loop must not use `crypto.subtle`.** 100 000 rounds cost
 *     6 093 ms as 100 000 Web Crypto promises versus 482 ms with a synchronous
 *     JS SHA-512. Same bytes out, 12.6× faster, and it keeps the work in one
 *     place a worker can own.
 *  2. **Web Crypto's AES-CBC always pads.** `subtle.encrypt('AES-CBC')` applies
 *     PKCS#7, so a block-aligned 32-byte input comes back as 48 bytes and every
 *     reader rejects the file. The trailing block is dropped below; every call
 *     site passes block-aligned data, which is what makes that safe.
 */
import { sha512 } from '@noble/hashes/sha2.js';
import { DATASPACES } from './dataspaces';
import { writeEncryptedOoxmlContainer } from './cfb';

const BLOCK_KEY_VERIFIER_INPUT = Uint8Array.from([0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79]);
const BLOCK_KEY_VERIFIER_HASH = Uint8Array.from([0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e]);
const BLOCK_KEY_KEY_VALUE = Uint8Array.from([0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6]);
const BLOCK_KEY_INTEGRITY_1 = Uint8Array.from([0x5f, 0xb2, 0xad, 0x01, 0x0c, 0xb9, 0xe1, 0xf6]);
const BLOCK_KEY_INTEGRITY_2 = Uint8Array.from([0xa0, 0x67, 0x7f, 0x02, 0xb2, 0x2c, 0x84, 0x33]);

const SEGMENT = 4096;
const BLOCK = 16;

/** Office's own default; lowering it only makes an attacker's job easier. */
export const DEFAULT_SPIN_COUNT = 100_000;

const subtle = globalThis.crypto.subtle;

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function le32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

const random = (length: number): Uint8Array => globalThis.crypto.getRandomValues(new Uint8Array(length));

/** Truncates or pads to an exact length — the spec's "normalize" step. */
function resize(bytes: Uint8Array, length: number, fill = 0x00): Uint8Array {
  if (bytes.length === length) return bytes;
  const out = new Uint8Array(length).fill(fill);
  out.set(bytes.subarray(0, length));
  return out;
}

const padToBlock = (bytes: Uint8Array, block = BLOCK): Uint8Array =>
  resize(bytes, Math.ceil(bytes.length / block) * block);

async function aesCbcEncrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await subtle.importKey('raw', key as BufferSource, { name: 'AES-CBC' }, false, ['encrypt']);
  const padded = new Uint8Array(await subtle.encrypt({ name: 'AES-CBC', iv: iv as BufferSource }, cryptoKey, data as BufferSource));
  // Drop the PKCS#7 block Web Crypto always adds; the caller passed whole blocks.
  return padded.subarray(0, padded.length - BLOCK);
}

async function ivFromSalt(salt: Uint8Array, blockKey?: Uint8Array, length = BLOCK): Promise<Uint8Array> {
  return blockKey ? resize(sha512(concat(salt, blockKey)), length) : resize(salt, length);
}

function utf16le(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    out[index * 2] = code & 0xff;
    out[index * 2 + 1] = code >> 8;
  }
  return out;
}

/** `H(0) = H(salt + password)`, then `H(n) = H(LE32(n) + H(n-1))` — 100 000 times. */
function iteratedHash(password: string, salt: Uint8Array, spinCount: number): Uint8Array {
  let hash = sha512(concat(salt, utf16le(password)));
  for (let index = 0; index < spinCount; index += 1) hash = sha512(concat(le32(index), hash));
  return hash;
}

const deriveKey = (finalHash: Uint8Array, blockKey: Uint8Array): Uint8Array =>
  resize(sha512(concat(finalHash, blockKey)), 32);

const base64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

interface DescriptorParams {
  keyDataSalt: Uint8Array;
  keySalt: Uint8Array;
  spinCount: number;
  encryptedVerifierInput: Uint8Array;
  encryptedVerifierHash: Uint8Array;
  encryptedKeyValue: Uint8Array;
  encryptedHmacKey: Uint8Array;
  encryptedHmacValue: Uint8Array;
}

/**
 * The XML descriptor Office reads out of the `EncryptionInfo` stream.
 *
 * Attribute names and the SHA-512/AES-256/CBC combination are the part of this
 * file that must match the spec exactly: Office does not negotiate, it either
 * recognises the descriptor or refuses the file.
 */
function encryptionDescriptor(params: DescriptorParams): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<encryption xmlns="http://schemas.microsoft.com/office/2006/encryption" xmlns:p="http://schemas.microsoft.com/office/2006/keyEncryptor/password">
  <keyData saltSize="16" blockSize="16" keyBits="256" hashSize="64" cipherAlgorithm="AES" cipherChaining="ChainingModeCBC" hashAlgorithm="SHA512" saltValue="${base64(params.keyDataSalt)}"/>
  <dataIntegrity encryptedHmacKey="${base64(params.encryptedHmacKey)}" encryptedHmacValue="${base64(params.encryptedHmacValue)}"/>
  <keyEncryptors>
    <keyEncryptor uri="http://schemas.microsoft.com/office/2006/keyEncryptor/password">
      <p:encryptedKey spinCount="${params.spinCount}" saltSize="16" blockSize="16" keyBits="256" hashSize="64" cipherAlgorithm="AES" cipherChaining="ChainingModeCBC" hashAlgorithm="SHA512" saltValue="${base64(params.keySalt)}" encryptedVerifierHashInput="${base64(params.encryptedVerifierInput)}" encryptedVerifierHashValue="${base64(params.encryptedVerifierHash)}" encryptedKeyValue="${base64(params.encryptedKeyValue)}"/>
    </keyEncryptor>
  </keyEncryptors>
</encryption>`;
}

export interface AgileOptions {
  spinCount?: number;
}

/**
 * Encrypts a plain OOXML package (a ZIP) and returns an OLE container Office can
 * open with the password.
 */
export async function encryptOoxml(
  packageBytes: Uint8Array,
  password: string,
  options: AgileOptions = {},
): Promise<Uint8Array> {
  const spinCount = options.spinCount ?? DEFAULT_SPIN_COUNT;

  /* 1. Password-derived keys: one spin, three block-key derivations. */
  const keySalt = random(16);
  const spin = iteratedHash(password, keySalt, spinCount);
  const keyVerifierInput = deriveKey(spin, BLOCK_KEY_VERIFIER_INPUT);
  const keyVerifierHash = deriveKey(spin, BLOCK_KEY_VERIFIER_HASH);
  const keyKeyValue = deriveKey(spin, BLOCK_KEY_KEY_VALUE);

  const verifierInput = random(16);
  const encryptedVerifierInput = await aesCbcEncrypt(keyVerifierInput, keySalt, verifierInput);
  const encryptedVerifierHash = await aesCbcEncrypt(keyVerifierHash, keySalt, padToBlock(sha512(verifierInput)));

  /* 2. The random key that actually encrypts the package: 32 real random bytes
   *    (msoffcrypto writes 16 random + 16 × 0x36, which halves the key). */
  const secretKey = random(32);
  const encryptedKeyValue = await aesCbcEncrypt(keyKeyValue, keySalt, secretKey);

  /* 3. Payload: an 8-byte length header, then 4 096-byte segments, each with a
   *    derived IV, so a single corrupted block cannot rewrite the rest. */
  const keyDataSalt = random(16);
  const segments: Uint8Array[] = [];
  for (let offset = 0, index = 0; offset < packageBytes.length || index === 0; offset += SEGMENT, index += 1) {
    const chunk = packageBytes.subarray(offset, offset + SEGMENT);
    const iv = await ivFromSalt(keyDataSalt, le32(index));
    segments.push(await aesCbcEncrypt(secretKey, iv, padToBlock(chunk)));
    if (chunk.length < SEGMENT) break;
  }

  const header = new Uint8Array(8);
  new DataView(header.buffer).setBigUint64(0, BigInt(packageBytes.length), true);
  const encryptedPackage = concat(header, ...segments);

  /* 4. Integrity: HMAC-SHA-512 over the encrypted payload, key itself encrypted. */
  const hmacSalt = random(64);
  const hmacKey = await subtle.importKey('raw', hmacSalt as BufferSource, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const hmacValue = new Uint8Array(await subtle.sign('HMAC', hmacKey, encryptedPackage as BufferSource));
  const encryptedHmacKey = await aesCbcEncrypt(secretKey, await ivFromSalt(keyDataSalt, BLOCK_KEY_INTEGRITY_1), hmacSalt);
  const encryptedHmacValue = await aesCbcEncrypt(secretKey, await ivFromSalt(keyDataSalt, BLOCK_KEY_INTEGRITY_2), hmacValue);

  /* 5. EncryptionInfo = 8-byte version/flags header + the XML descriptor. */
  const xml = new TextEncoder().encode(
    encryptionDescriptor({
      keyDataSalt,
      keySalt,
      spinCount,
      encryptedVerifierInput,
      encryptedVerifierHash,
      encryptedKeyValue,
      encryptedHmacKey,
      encryptedHmacValue,
    }),
  );
  const versionHeader = Uint8Array.from([0x04, 0x00, 0x04, 0x00, 0x40, 0x00, 0x00, 0x00]);
  const encryptionInfo = concat(versionHeader, xml);

  return writeEncryptedOoxmlContainer(encryptionInfo, encryptedPackage, DATASPACES);
}
