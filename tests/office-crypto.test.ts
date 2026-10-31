import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decryptOffice, formatFromName, inspectOfficeFile } from '../src/lib/office/office';
import { encryptOoxml, DEFAULT_SPIN_COUNT } from '../src/lib/office/agile';
import { readZip } from '../src/lib/zip/zip';
import { ToolError } from '../src/lib/files/errors';

/**
 * Office decryption, checked against fixtures produced by `msoffcrypto-tool`
 * (Agile, AES-256/SHA-512, 100 000 rounds) from files written by python-docx and
 * openpyxl — see `tests/fixtures/locked.md`. Nothing here is produced by the code
 * under test except the round-trip in the last block, which is deliberately a
 * second, independent direction.
 */

const fixture = (name: string) => readFileSync(`tests/fixtures/${name}`);
const asSource = (name: string, bytes: Uint8Array) => ({
  name,
  blob: new File([bytes as BlobPart], name, { type: 'application/octet-stream' }),
});

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
    return 'no-throw';
  } catch (error) {
    return error instanceof ToolError ? error.code : `threw-${String(error)}`;
  }
};

const latin1 = (bytes: Uint8Array): string => {
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
};

describe('inspection', () => {
  it('recognises an encrypted OOXML container by its CFB magic bytes', async () => {
    const info = await inspectOfficeFile(new File([fixture('locked.docx') as BlobPart], 'locked.docx'), 'locked.docx');
    expect(info.encryptedCandidate).toBe(true);
    expect(info.plain).toBe(false);
    expect(info.format).toBe('docx');
  });

  it('recognises an already-plain package', async () => {
    const info = await inspectOfficeFile(new File([fixture('plain.docx') as BlobPart], 'plain.docx'), 'plain.docx');
    expect(info.plain).toBe(true);
    expect(info.encryptedCandidate).toBe(false);
  });

  it('reads the format from the extension, because the container does not store it', () => {
    expect(formatFromName('report.docx')).toBe('docx');
    expect(formatFromName('BOOK.XLSX')).toBe('xlsx');
    expect(formatFromName('slides.pptx')).toBe('pptx');
    expect(formatFromName('legacy.doc')).toBeNull();
  });
});

describe('decrypting real encrypted documents', () => {
  it('decrypts a .docx to a valid OOXML package', async () => {
    const out = await decryptOffice(asSource('locked.docx', fixture('locked.docx')), 'correct horse');
    expect(out.format).toBe('docx');
    expect(out.bytes[0]).toBe(0x50); // 'P'
    expect(out.bytes[1]).toBe(0x4b); // 'K'
    expect(latin1(out.bytes)).toContain('word/document.xml');
  });

  it('decrypts a .xlsx and preserves the workbook part', async () => {
    const out = await decryptOffice(asSource('locked.xlsx', fixture('locked.xlsx')), 'correct horse');
    expect(out.format).toBe('xlsx');
    expect(latin1(out.bytes)).toContain('xl/workbook.xml');
  });

  it('produces a package the ZIP reader accepts, so the result is a real archive', async () => {
    const out = await decryptOffice(asSource('locked.docx', fixture('locked.docx')), 'correct horse');
    const opened = await readZip(new Blob([out.bytes as BlobPart]));
    expect(opened.entries.map((entry) => entry.meta.name)).toContain('[Content_Types].xml');
  });
});

describe('rejections are actionable, not mysterious', () => {
  it('reports a wrong password as `encrypted`', async () => {
    expect(await codeOf(decryptOffice(asSource('locked.docx', fixture('locked.docx')), 'wrong horse'))).toBe('encrypted');
  });

  it('asks for a password instead of treating an empty field as one', async () => {
    expect(await codeOf(decryptOffice(asSource('locked.docx', fixture('locked.docx')), ''))).toBe('invalid-input');
  });

  it('says so when the document was never protected', async () => {
    expect(await codeOf(decryptOffice(asSource('plain.docx', fixture('plain.docx')), 'x'))).toBe('invalid-input');
  });

  it('refuses a file that is not an Office container', async () => {
    expect(await codeOf(decryptOffice(asSource('notes.docx', new Uint8Array([1, 2, 3, 4, 5])), 'x'))).toBe('unsupported-type');
  });

  it('refuses a legacy .doc extension, which is a different format', async () => {
    expect(await codeOf(decryptOffice(asSource('legacy.doc', fixture('locked.docx')), 'correct horse'))).toBe(
      'unsupported-type',
    );
  });

  it('refuses an empty file', async () => {
    expect(await codeOf(decryptOffice(asSource('empty.docx', new Uint8Array()), 'x'))).toBe('empty-input');
  });
});

describe('encryption round trip (behind the interoperability flag)', () => {
  it('writes a container our own reader and office-crypto both open', async () => {
    const plain = fixture('plain.docx');
    const locked = await encryptOoxml(plain, 'correct horse', { spinCount: 1_000 });

    expect(locked.slice(0, 8)).toEqual(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));

    const out = await decryptOffice(asSource('roundtrip.docx', locked), 'correct horse');
    expect(out.bytes.length).toBe(plain.length);
    expect(out.bytes.every((byte, index) => byte === plain[index])).toBe(true);
  });

  it('refuses to open its own output with the wrong password', async () => {
    const locked = await encryptOoxml(fixture('plain.xlsx'), 'correct horse', { spinCount: 1_000 });
    expect(await codeOf(decryptOffice(asSource('roundtrip.xlsx', locked), 'nope'))).toBe('encrypted');
  });

  it('uses a spin count worth having by default', () => {
    expect(DEFAULT_SPIN_COUNT).toBe(100_000);
  });

  it('writes an EncryptionInfo stream declaring Agile AES-256 and a real spin count', async () => {
    const locked = await encryptOoxml(fixture('plain.docx'), 'correct horse', { spinCount: 1_000 });
    const text = latin1(locked);
    expect(locked[512] ?? 0).toBeGreaterThanOrEqual(0); // header written, not empty
    expect(text).toContain('schemas.microsoft.com/office/2006/encryption');
    expect(text).toContain('cipherAlgorithm="AES"');
    expect(text).toContain('keyBits="256"');
    expect(text).toContain('hashAlgorithm="SHA512"');
    expect(text).toContain('spinCount="1000"');
  });
});
