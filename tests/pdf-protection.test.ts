import { describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { runOperation } from '../src/lib/pdf/ops';
import type { PdfOperation, PdfProtection } from '../src/lib/pdf/protocol';
import { ToolError } from '../src/lib/files/errors';

/**
 * PDF protection is the one place in this app that writes cryptography, so the
 * tests do not trust the library's own round trip: they re-open the output and
 * read the `/Encrypt` dictionary out of the bytes, the same way a PDF reader
 * would.
 */

async function plainPdf(pageCount = 3): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    doc.addPage([595, 842]).drawText(`page ${index + 1}`, { x: 40, y: 700, size: 12 });
  }
  return doc.save();
}

const asSource = (bytes: Uint8Array) => ({
  name: 'sample.pdf',
  blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }),
});

const protection = (overrides: Partial<PdfProtection> = {}): PdfProtection => ({
  userPassword: 'correct horse',
  ownerPassword: 'battery staple',
  allowPrinting: true,
  allowCopying: false,
  allowModifying: false,
  allowAnnotating: false,
  ...overrides,
});

const protect = (bytes: Uint8Array, overrides: Partial<PdfProtection> = {}) =>
  runOperation({ kind: 'protect', source: asSource(bytes), protection: protection(overrides) } satisfies PdfOperation);

const unlock = (bytes: Uint8Array, password: string) =>
  runOperation({ kind: 'unlock', source: asSource(bytes), password } satisfies PdfOperation);

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

/** `/P` is a signed 32-bit mask; bit `n` (1-based) grants permission `n`. */
function permissionBits(bytes: Uint8Array): number {
  const match = /\/P\s*(-?\d+)/.exec(latin1(bytes));
  if (!match) throw new Error('no /P entry in the output');
  return Number(match[1]);
}

const allows = (mask: number, bit: number) => (mask >> (bit - 1)) & 1 ? true : false;

describe('protect: the output is a real AES-256 PDF', () => {
  it('writes /V 5 /R 6 with an AESV3 crypt filter', async () => {
    const out = await protect(await plainPdf());
    const text = latin1(out.documents[0]!);
    expect(text).toMatch(/\/Filter\s*\/Standard/);
    expect(text).toMatch(/\/V\s*5/);
    expect(text).toMatch(/\/R\s*6/);
    expect(text).toMatch(/\/Length\s*256/);
    expect(text).toMatch(/\/StmF\s*\/StdCF/);
    expect(text).toMatch(/\/CFM\s*\/AESV3/);
  });

  it('cannot be opened without the password', async () => {
    const out = await protect(await plainPdf());
    await expect(PDFDocument.load(out.documents[0]!)).rejects.toThrow(/encrypted/i);
  });

  it('opens with the user password and with the owner password', async () => {
    const out = await protect(await plainPdf(4));
    const withUser = await PDFDocument.load(out.documents[0]!, { password: 'correct horse' });
    const withOwner = await PDFDocument.load(out.documents[0]!, { password: 'battery staple' });
    expect(withUser.getPageCount()).toBe(4);
    expect(withOwner.getPageCount()).toBe(4);
  });

  it('reports the page count without re-parsing the output', async () => {
    const out = await protect(await plainPdf(7));
    expect(out.pageCount).toBe(7);
  });

  it('maps the toggles onto the /P bits', async () => {
    const out = await protect(await plainPdf(), {
      allowPrinting: false,
      allowCopying: true,
      allowModifying: true,
      allowAnnotating: false,
    });
    const mask = permissionBits(out.documents[0]!);
    expect(allows(mask, 3)).toBe(false); // print
    expect(allows(mask, 5)).toBe(true); // copy / extract
    expect(allows(mask, 4)).toBe(true); // modify contents
    expect(allows(mask, 6)).toBe(false); // annotate
    // Accessibility extraction is never taken away (bit 10).
    expect(allows(mask, 10)).toBe(true);
  });

  it('keeps the pages intact behind the encryption', async () => {
    const out = await protect(await plainPdf(2));
    const reopened = await PDFDocument.load(out.documents[0]!, { password: 'correct horse' });
    const sizes = reopened.getPages().map((page) => [Math.round(page.getWidth()), Math.round(page.getHeight())]);
    expect(sizes).toEqual([
      [595, 842],
      [595, 842],
    ]);
  });
});

describe('protect: validation', () => {
  it('requires an owner password', async () => {
    expect(await codeOf(protect(await plainPdf(), { ownerPassword: '' }))).toBe('invalid-input');
  });

  it('rejects a one-character open password', async () => {
    expect(await codeOf(protect(await plainPdf(), { userPassword: 'a' }))).toBe('invalid-input');
  });

  it('rejects a request that would change nothing', async () => {
    const code = await codeOf(
      protect(await plainPdf(), {
        userPassword: '',
        allowPrinting: true,
        allowCopying: true,
        allowModifying: true,
        allowAnnotating: true,
      }),
    );
    expect(code).toBe('invalid-input');
  });

  it('refuses to stack a second layer on an already-protected file', async () => {
    const once = await protect(await plainPdf());
    expect(await codeOf(protect(once.documents[0]!))).toBe('encrypted');
  });

  it('refuses an empty file', async () => {
    expect(await codeOf(protect(new Uint8Array()))).toBe('empty-input');
  });

  it('refuses a file that is not a PDF', async () => {
    expect(await codeOf(protect(new Uint8Array([1, 2, 3, 4])))).toBe('corrupt-file');
  });
});

describe('protect: restrictions without an open password', () => {
  it('produces a file that opens with an empty password but stays encrypted', async () => {
    const out = await protect(await plainPdf(), { userPassword: '', allowPrinting: false });
    const reopened = await PDFDocument.load(out.documents[0]!, { password: '' });
    expect(reopened.getPageCount()).toBe(3);
    expect(latin1(out.documents[0]!)).toMatch(/\/Encrypt/);
    expect(allows(permissionBits(out.documents[0]!), 3)).toBe(false); // no printing
  });
});

describe('unlock', () => {
  it('removes the encryption so the output opens with no password', async () => {
    const protectedFile = await protect(await plainPdf(5));
    const out = await unlock(protectedFile.documents[0]!, 'correct horse');

    expect(out.wasEncrypted).toBe(true);
    expect(out.pageCount).toBe(5);
    expect(latin1(out.documents[0]!)).not.toMatch(/\/Encrypt/);

    const reopened = await PDFDocument.load(out.documents[0]!);
    expect(reopened.getPageCount()).toBe(5);
  });

  it('accepts the owner password too', async () => {
    const protectedFile = await protect(await plainPdf());
    const out = await unlock(protectedFile.documents[0]!, 'battery staple');
    expect(out.pageCount).toBe(3);
  });

  it('rejects a wrong password with an actionable code', async () => {
    const protectedFile = await protect(await plainPdf());
    expect(await codeOf(unlock(protectedFile.documents[0]!, 'nope'))).toBe('encrypted');
  });

  it('reports an unencrypted file as such instead of failing', async () => {
    const out = await unlock(await plainPdf(2), '');
    expect(out.wasEncrypted).toBe(false);
    expect(out.pageCount).toBe(2);
  });

  it('opens a restrictions-only file with an empty password', async () => {
    const restricted = await protect(await plainPdf(), { userPassword: '', allowCopying: false });
    const out = await unlock(restricted.documents[0]!, '');
    expect(out.wasEncrypted).toBe(true);
    expect(latin1(out.documents[0]!)).not.toMatch(/\/Encrypt/);
  });

  it('refuses a file that is not a PDF', async () => {
    expect(await codeOf(unlock(new Uint8Array([9, 9, 9]), 'x'))).toBe('corrupt-file');
  });
});
