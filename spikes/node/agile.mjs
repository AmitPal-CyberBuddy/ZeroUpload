/**
 * Agile OOXML encryption ([MS-OFFCRYPTO] §2.3.4.7) using nothing but Web Crypto.
 *
 * This is the piece no published browser library offers: `office-crypto`,
 * `msoffice-crypto` and friends decrypt only. The code below runs unchanged in a
 * browser or a worker — `crypto.subtle` is the whole dependency — so the spike
 * can state, with evidence, whether "protect a document with a password" is
 * buildable without shipping a Python runtime.
 *
 * Verified against msoffcrypto-tool (CPython + pycryptodome), which is the
 * reference implementation this format is normally checked against.
 */
import CFB from 'cfb';
import { sha512 as sha512Sync } from '@noble/hashes/sha2.js';
import { DATASPACE_STREAMS } from './office-defaults.mjs';

const BLOCK_KEY_VERIFIER_INPUT = Uint8Array.from([0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79]);
const BLOCK_KEY_VERIFIER_HASH = Uint8Array.from([0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e]);
const BLOCK_KEY_KEY_VALUE = Uint8Array.from([0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6]);
const BLOCK_KEY_INTEGRITY_1 = Uint8Array.from([0x5f, 0xb2, 0xad, 0x01, 0x0c, 0xb9, 0xe1, 0xf6]);
const BLOCK_KEY_INTEGRITY_2 = Uint8Array.from([0xa0, 0x67, 0x7f, 0x02, 0xb2, 0x2c, 0x84, 0x33]);

const subtle = globalThis.crypto.subtle;
const SEGMENT = 4096;

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const le32 = (value) => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
};

const random = (length) => globalThis.crypto.getRandomValues(new Uint8Array(length));
const sha512 = async (bytes) => new Uint8Array(await subtle.digest('SHA-512', bytes));

/** Pads with 0x36 (the spec's "normalize") or zeros, and truncates. */
const resize = (bytes, length, fill = 0x00) => {
  if (bytes.length === length) return bytes;
  const out = new Uint8Array(length).fill(fill);
  out.set(bytes.subarray(0, length));
  return out;
};

const padToBlock = (bytes, block = 16) => resize(bytes, Math.ceil(bytes.length / block) * block);

/**
 * AES-CBC, encrypt only, without padding.
 *
 * Web Crypto has no "no padding" mode: `subtle.encrypt('AES-CBC')` always applies
 * PKCS#7, so a block-aligned 32-byte input comes back as 48 bytes. [MS-OFFCRYPTO]
 * uses raw CBC, so the extra trailing block has to be dropped. Every call site
 * below passes block-aligned data, which is what makes the drop safe.
 */
const aesCbc = async (key, iv, data) => {
  const cryptoKey = await subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['encrypt']);
  const padded = new Uint8Array(await subtle.encrypt({ name: 'AES-CBC', iv }, cryptoKey, data));
  return padded.subarray(0, padded.length - 16);
};

const ivFromSalt = async (salt, blockKey, length = 16) =>
  blockKey ? resize(await sha512(concat(salt, blockKey)), length) : resize(salt, length);

const utf16le = (text) => {
  const out = new Uint8Array(text.length * 2);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    out[index * 2] = code & 0xff;
    out[index * 2 + 1] = code >> 8;
  }
  return out;
};

/**
 * SHA-512 iterated spinCount times — the deliberately expensive part.
 *
 * Measured on this machine, 100 000 iterations: one `crypto.subtle.digest` promise
 * per round costs 6 093 ms; a synchronous pure-JS SHA-512 (@noble/hashes) costs
 * 482 ms. Same output, 12.6× faster, and it can run in a worker. Hence the
 * sync implementation here even though the rest of the file uses Web Crypto.
 */
const iteratedHash = async (password, salt, spinCount) => {
  let hash = sha512Sync(concat(salt, utf16le(password)));
  for (let index = 0; index < spinCount; index += 1) hash = sha512Sync(concat(le32(index), hash));
  return hash;
};

const deriveKey = async (finalHash, blockKey) => resize(await sha512(concat(finalHash, blockKey)), 32);

const base64 = (bytes) => Buffer.from(bytes).toString('base64');

const encryptionDescriptor = (params) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<encryption xmlns="http://schemas.microsoft.com/office/2006/encryption" xmlns:p="http://schemas.microsoft.com/office/2006/keyEncryptor/password">
  <keyData saltSize="16" blockSize="16" keyBits="256" hashSize="64" cipherAlgorithm="AES" cipherChaining="ChainingModeCBC" hashAlgorithm="SHA512" saltValue="${base64(params.keyDataSalt)}"/>
  <dataIntegrity encryptedHmacKey="${base64(params.encryptedHmacKey)}" encryptedHmacValue="${base64(params.encryptedHmacValue)}"/>
  <keyEncryptors>
    <keyEncryptor uri="http://schemas.microsoft.com/office/2006/keyEncryptor/password">
      <p:encryptedKey spinCount="${params.spinCount}" saltSize="16" blockSize="16" keyBits="256" hashSize="64" cipherAlgorithm="AES" cipherChaining="ChainingModeCBC" hashAlgorithm="SHA512" saltValue="${base64(params.keySalt)}" encryptedVerifierHashInput="${base64(params.encryptedVerifierInput)}" encryptedVerifierHashValue="${base64(params.encryptedVerifierHash)}" encryptedKeyValue="${base64(params.encryptedKeyValue)}"/>
    </keyEncryptor>
  </keyEncryptors>
</encryption>`;

/**
 * @param {Uint8Array} packageBytes plain OOXML (a ZIP)
 * @param {string} password
 * @param {{ spinCount?: number }} [options]
 * @returns {Promise<Uint8Array>} an OLE/CFB container Office can open with the password
 */
export async function encryptOoxml(packageBytes, password, { spinCount = 100_000 } = {}) {
  /* 1. password-derived keys */
  const keySalt = random(16);
  const spin = await iteratedHash(password, keySalt, spinCount);
  const [keyVerifierInput, keyVerifierHash, keyKeyValue] = await Promise.all([
    deriveKey(spin, BLOCK_KEY_VERIFIER_INPUT),
    deriveKey(spin, BLOCK_KEY_VERIFIER_HASH),
    deriveKey(spin, BLOCK_KEY_KEY_VALUE),
  ]);

  const verifierInput = random(16);
  const encryptedVerifierInput = await aesCbc(keyVerifierInput, keySalt, verifierInput);
  const encryptedVerifierHash = await aesCbc(keyVerifierHash, keySalt, padToBlock(await sha512(verifierInput)));

  /* 2. the random key that actually encrypts the package (32 random bytes, not
   *    msoffcrypto's 16-random + 16×0x36, which halves the effective strength) */
  const secretKey = random(32);
  const encryptedKeyValue = await aesCbc(keyKeyValue, keySalt, secretKey);

  /* 3. payload: 8-byte length header, then 4096-byte segments, each with its own IV */
  const keyDataSalt = random(16);
  const segments = [];
  for (let offset = 0, index = 0; offset < packageBytes.length || index === 0; offset += SEGMENT, index += 1) {
    const chunk = packageBytes.subarray(offset, offset + SEGMENT);
    const iv = await ivFromSalt(keyDataSalt, le32(index));
    segments.push(await aesCbc(secretKey, iv, padToBlock(chunk)));
    if (chunk.length < SEGMENT) break;
  }
  const header = new Uint8Array(8);
  new DataView(header.buffer).setBigUint64(0, BigInt(packageBytes.length), true);
  const encryptedPackage = concat(header, ...segments);

  /* 4. integrity: HMAC-SHA512 of the encrypted payload, key itself encrypted */
  const hmacSalt = random(64);
  const hmacKey = await subtle.importKey('raw', hmacSalt, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const hmac = new Uint8Array(await subtle.sign('HMAC', hmacKey, encryptedPackage));
  const encryptedHmacKey = await aesCbc(secretKey, await ivFromSalt(keyDataSalt, BLOCK_KEY_INTEGRITY_1), hmacSalt);
  const encryptedHmacValue = await aesCbc(secretKey, await ivFromSalt(keyDataSalt, BLOCK_KEY_INTEGRITY_2), hmac);

  const xml = encryptionDescriptor({
    keyDataSalt,
    keySalt,
    spinCount,
    encryptedVerifierInput,
    encryptedVerifierHash,
    encryptedKeyValue,
    encryptedHmacKey,
    encryptedHmacValue,
  });
  const descriptor = concat(Uint8Array.from([0x04, 0x00, 0x04, 0x00, 0x40, 0x00, 0x00, 0x00]), new TextEncoder().encode(xml));

  /* 5. wrap both streams in an OLE container */
  const container = CFB.utils.cfb_new();
  const stream = (name, bytes) => CFB.utils.cfb_add(container, name, new Uint8Array(bytes));
  stream('EncryptionInfo', descriptor);
  stream('EncryptedPackage', encryptedPackage);
  stream('\\x06DataSpaces/Version', Uint8Array.from(atob(DATASPACE_STREAMS.Version), (c) => c.charCodeAt(0)));
  stream('\\x06DataSpaces/DataSpaceMap', Uint8Array.from(atob(DATASPACE_STREAMS.DataSpaceMap), (c) => c.charCodeAt(0)));
  stream('\\x06DataSpaces/DataSpaceInfo/StrongEncryptionDataSpace', Uint8Array.from(atob(DATASPACE_STREAMS.StrongEncryptionDataSpace), (c) => c.charCodeAt(0)));
  stream('\\x06DataSpaces/TransformInfo/StrongEncryptionTransform/\\x06Primary', Uint8Array.from(atob(DATASPACE_STREAMS.Primary), (c) => c.charCodeAt(0)));

  return new Uint8Array(CFB.write(container, { type: 'buffer' }));
}
