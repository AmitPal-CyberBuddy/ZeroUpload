import { describe, expect, it } from 'vitest';
import {
  createZip,
  inspectZipEncryption,
  readZip,
  ZIP_ENCRYPTION_LABEL,
} from '../src/lib/zip/zip';
import { OPERATION_BUDGETS } from '../src/lib/files/budget';
import { ToolError } from '../src/lib/files/errors';
import { MB } from './helpers';

/**
 * AES ZIP support is only useful if the archive is a real AE-2 archive and if a
 * wrong password is refused, so these tests read the central directory by hand
 * (method 99, `0x9901` extra field, general-purpose bit 0) instead of trusting
 * the writer that produced it, and they check that the round trip rejects the
 * wrong key.
 */

const file = (name: string, text: string) => ({
  name,
  blob: new Blob([text], { type: 'text/plain' }),
});

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

/** Minimal central-directory walk, independent of zip.js. */
function centralDirectory(bytes: Uint8Array) {
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (bytes[offset] === 0x50 && bytes[offset + 1] === 0x4b && bytes[offset + 2] === 0x05 && bytes[offset + 3] === 0x06) {
      eocd = offset;
      break;
    }
  }
  expect(eocd).toBeGreaterThan(-1);
  const count = bytes[eocd + 10] | (bytes[eocd + 11] << 8);
  let offset = bytes[eocd + 16] | (bytes[eocd + 17] << 8) | (bytes[eocd + 18] << 16) | (bytes[eocd + 19] << 24);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const flags = bytes[offset + 8] | (bytes[offset + 9] << 8);
    const method = bytes[offset + 10] | (bytes[offset + 11] << 8);
    const nameLength = bytes[offset + 28] | (bytes[offset + 29] << 8);
    const extraLength = bytes[offset + 30] | (bytes[offset + 31] << 8);
    const commentLength = bytes[offset + 32] | (bytes[offset + 33] << 8);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    const extra = bytes.subarray(offset + 46 + nameLength, offset + 46 + nameLength + extraLength);
    let aesKeyBits: number | null = null;
    for (let cursor = 0; cursor + 4 <= extra.length; ) {
      const id = extra[cursor] | (extra[cursor + 1] << 8);
      const size = extra[cursor + 2] | (extra[cursor + 3] << 8);
      // AE-2 body: vendor version (2), vendor id 'AE' (2), key strength (1), method (2)
      if (id === 0x9901 && size >= 7) {
        const strength = extra[cursor + 8];
        aesKeyBits = strength === 1 ? 128 : strength === 2 ? 192 : strength === 3 ? 256 : null;
      }
      cursor += 4 + size;
    }
    entries.push({ name, flags, method, aesKeyBits });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

describe('AES-256 archive creation', () => {
  it('writes WinZip AE-2 entries: method 99, encrypted flag, 256-bit key', async () => {
    const archive = await createZip([file('notes.txt', 'the quick brown fox')], { password: 'correct horse' });
    const entries = centralDirectory(await bytesOf(archive));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.method).toBe(99);
    expect(entries[0]!.flags & 0x0001).toBe(1);
    expect(entries[0]!.aesKeyBits).toBe(256);
  });

  it('is detected as AES by the central-directory scan, before any inflation', async () => {
    const archive = await createZip([file('a.txt', 'payload')], { password: 'correct horse' });
    const info = inspectZipEncryption(await bytesOf(archive));
    expect(info.kind).toBe('aes-256');
    expect(info.entryCount).toBe(1);
  });

  it('reports a plain archive as unencrypted', async () => {
    const archive = await createZip([file('a.txt', 'payload')]);
    expect(inspectZipEncryption(await bytesOf(archive)).kind).toBeNull();
  });

  it('round-trips through the extract path with the right password', async () => {
    const archive = await createZip(
      [file('notes.txt', 'the quick brown fox'), file('dir/data.csv', 'a,b\n1,2\n')],
      { password: 'correct horse' },
    );
    const opened = await readZip(archive, undefined, undefined, 'correct horse');
    const names = opened.entries.map((entry) => entry.meta.name).sort();
    expect(names).toEqual(['dir/data.csv', 'notes.txt']);
    const text = new TextDecoder().decode(opened.entries.find((entry) => entry.meta.name === 'notes.txt')!.data);
    expect(text).toBe('the quick brown fox');
  });

  it('refuses a wrong password instead of returning garbage', async () => {
    const archive = await createZip([file('notes.txt', 'secret')], { password: 'correct horse' });
    await expect(readZip(archive, undefined, undefined, 'wrong horse')).rejects.toMatchObject({
      code: 'encrypted',
    });
  });

  it('asks for a password rather than failing to parse when none is given', async () => {
    const archive = await createZip([file('notes.txt', 'secret')], { password: 'correct horse' });
    await expect(readZip(archive)).rejects.toMatchObject({ code: 'encrypted' });
  });

  it('rejects a password that is too short to be worth the label', async () => {
    await expect(createZip([file('a.txt', 'x')], { password: 'short' })).rejects.toMatchObject({
      code: 'invalid-input',
    });
  });

  it('keeps the entry-count and byte guards on the encrypted path', async () => {
    const tooBig = new Blob([new Uint8Array(OPERATION_BUDGETS.zipCreateEncrypted.maxBytes + 1)]);
    await expect(createZip([{ name: 'big.bin', blob: tooBig }], { password: 'correct horse' })).rejects.toMatchObject({
      code: 'limit-exceeded',
    });
  });

  it('sanitises traversal names before writing them into an encrypted archive', async () => {
    const archive = await createZip([file('../../etc/passwd', 'x')], { password: 'correct horse' });
    const names = centralDirectory(await bytesOf(archive)).map((entry) => entry.name);
    expect(names).toEqual(['etc/passwd']);
  });

  it('renames duplicate names instead of writing two entries with one name', async () => {
    const archive = await createZip([file('same.txt', 'one'), file('same.txt', 'two')], { password: 'correct horse' });
    const names = centralDirectory(await bytesOf(archive)).map((entry) => entry.name);
    expect(new Set(names).size).toBe(2);
  });
});

describe('ZipCrypto (the compatibility mode)', () => {
  it('is only used when asked for explicitly, and stays readable everywhere', async () => {
    const archive = await createZip([file('a.txt', 'legacy')], { password: 'hunter2!', encryption: 'zipcrypto' });
    const entries = centralDirectory(await bytesOf(archive));
    expect(entries[0]!.method).not.toBe(99);
    expect(entries[0]!.flags & 0x0001).toBe(1);
    expect(inspectZipEncryption(await bytesOf(archive)).kind).toBe('zipcrypto');
    expect(ZIP_ENCRYPTION_LABEL.zipcrypto).toMatch(/legacy/i);
  });

  it('round-trips with the right password and rejects a wrong one', async () => {
    const archive = await createZip([file('a.txt', 'legacy')], { password: 'hunter2!', encryption: 'zipcrypto' });
    const opened = await readZip(archive, undefined, undefined, 'hunter2!');
    expect(new TextDecoder().decode(opened.entries[0]!.data)).toBe('legacy');
    await expect(readZip(archive, undefined, undefined, 'nope')).rejects.toMatchObject({ code: 'encrypted' });
  });
});

describe('encrypted extraction budgets', () => {
  it('refuses an entry that would expand beyond the per-entry ceiling', async () => {
    const archive = await createZip([file('big.txt', 'x'.repeat(2000))], { password: 'correct horse' });
    const limits = { maxEntries: 10, maxTotalBytes: 10 * MB, maxEntryBytes: 500 };
    await expect(readZip(archive, limits, undefined, 'correct horse')).rejects.toMatchObject({ code: 'limit-exceeded' });
  });

  it('refuses an archive with too many entries before decrypting any of them', async () => {
    const files = Array.from({ length: 5 }, (_, index) => file(`f${index}.txt`, `payload ${index}`));
    const archive = await createZip(files, { password: 'correct horse' });
    const limits = { maxEntries: 2, maxTotalBytes: 10 * MB, maxEntryBytes: MB };
    await expect(readZip(archive, limits, undefined, 'correct horse')).rejects.toMatchObject({ code: 'limit-exceeded' });
  });

  it('never writes a traversal path: the name is flattened at creation and on read', async () => {
    const archive = await createZip([file('../../escape.txt', 'x')], { password: 'correct horse' });
    const entries = centralDirectory(await bytesOf(archive));
    expect(entries[0]!.name).toBe('escape.txt');
    const opened = await readZip(archive, undefined, undefined, 'correct horse');
    expect(opened.entries[0]!.meta.name).toBe('escape.txt');
  });

  it('throws a ToolError, not a raw zip.js error, for a truncated archive', async () => {
    const archive = await createZip([file('a.txt', 'payload')], { password: 'correct horse' });
    const bytes = await bytesOf(archive);
    const truncated = new Blob([bytes.subarray(0, Math.floor(bytes.length / 2)) as BlobPart]);
    const error = await readZip(truncated, undefined, undefined, 'correct horse').catch((caught) => caught);
    expect(error).toBeInstanceOf(ToolError);
    expect(['corrupt-file', 'encrypted']).toContain((error as ToolError).code);
  });
});
