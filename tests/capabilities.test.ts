import { describe, expect, it } from 'vitest';
import { detectFile, guessFamily } from '../src/lib/capabilities/detect';
import { familyFromMime, formatFromFilename, formatsInFamily } from '../src/lib/capabilities/formats';
import { availableEdges, convertibleFormats } from '../src/lib/capabilities/table';

/**
 * The workspace answers "what can I do with this file" from the file itself, so
 * the detector is the thing that decides which actions a visitor is offered. A
 * wrong answer here is not a cosmetic bug: it hides the tool they needed.
 *
 * These fixtures are real headers, not invented bytes — each one is the smallest
 * prefix that a signature check will match, which is exactly what `detectFile`
 * reads.
 */

const file = (bytes: number[], name: string, type = '') =>
  new File([new Uint8Array(bytes)], name, { type });

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const PDF = [...'%PDF-1.7'].map((c) => c.charCodeAt(0));
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const GIF = [...'GIF89a'].map((c) => c.charCodeAt(0));
const WEBP = [...[...'RIFF'].map((c) => c.charCodeAt(0)), 0, 0, 0, 0, ...'WEBP'.split('').map((c) => c.charCodeAt(0))];

describe('detectFile', () => {
  it('identifies an image from its bytes, even when the name lies', async () => {
    const result = await detectFile(file(PNG, 'notes.txt', 'text/plain'));
    expect(result.family).toBe('image');
    expect(result.format).toBe('png');
    expect(result.source).toBe('signature');
    // The extension claims text, the bytes say PNG. That is worth telling a user.
    expect(result.mismatch).toBe(true);
  });

  it('identifies a PDF, a JPEG, a GIF and a WebP', async () => {
    expect((await detectFile(file(PDF, 'a.pdf', 'application/pdf'))).family).toBe('pdf');
    expect((await detectFile(file(JPEG, 'a.jpg', 'image/jpeg'))).family).toBe('image');
    expect((await detectFile(file(GIF, 'a.gif', 'image/gif'))).family).toBe('image');
    expect((await detectFile(file(WEBP, 'a.webp', 'image/webp'))).family).toBe('image');
  });

  it('separates the Office formats from a plain ZIP', async () => {
    // All four are the same container; only the extension distinguishes them, and
    // treating a .docx as a "ZIP archive" would offer extraction instead of unlock.
    const docx = await detectFile(file(ZIP, 'letter.docx'));
    expect(docx.family).toBe('office');
    expect(docx.format).toBe('docx');

    const xlsx = await detectFile(file(ZIP, 'sheet.xlsx'));
    expect(xlsx.family).toBe('spreadsheet');
    expect(xlsx.format).toBe('xlsx');

    const pptx = await detectFile(file(ZIP, 'deck.pptx'));
    expect(pptx.family).toBe('office');
    expect(pptx.format).toBe('pptx');

    const zip = await detectFile(file(ZIP, 'bundle.zip'));
    expect(zip.family).toBe('archive');
  });

  it('treats a text file as text rather than "unrecognised"', async () => {
    // Text has no signature by design — it is the absence of one.
    for (const name of ['notes.txt', 'data.json', 'rows.csv', 'readme.md']) {
      const result = await detectFile(file([...'hello world'].map((c) => c.charCodeAt(0)), name));
      expect(result.family, name).toBe('text');
    }
  });

  it('names JSON specifically, because a JSON tool exists', async () => {
    const result = await detectFile(file([...'{"a":1}'].map((c) => c.charCodeAt(0)), 'data.json'));
    expect(result.format).toBe('json');
  });

  it('falls back to the extension when the bytes are unknown', async () => {
    const result = await detectFile(file([0x00, 0x01, 0x02, 0x03], 'mystery.heic'));
    expect(result.source).toBe('extension');
    expect(result.family).toBe('image');
  });

  it('says "unrecognised" rather than guessing when nothing matches', async () => {
    const result = await detectFile(file([0x00, 0x11, 0x22], 'no-extension'));
    expect(result.family).toBe('unknown');
    expect(result.source).toBe('none');
    expect(result.label).toMatch(/unrecognised/i);
  });

  it('does not flag a text file as mismatched just because its MIME was empty', async () => {
    const result = await detectFile(file([...'plain words'].map((c) => c.charCodeAt(0)), 'words.txt', ''));
    expect(result.mismatch).toBe(false);
  });
});

describe('format helpers', () => {
  it('normalises the aliases people actually have', () => {
    expect(formatFromFilename('photo.JPEG')).toBe('jpg');
    expect(formatFromFilename('archive.PDF')).toBe('pdf');
    expect(formatFromFilename('notes.md')).toBe('txt');
    expect(formatFromFilename('no-extension')).toBeUndefined();
  });

  it('reads the final extension, so a double extension resolves to the real type', () => {
    expect(formatFromFilename('report.pdf.zip')).toBe('zip');
  });

  it('maps MIME prefixes to families', () => {
    expect(familyFromMime('image/png')).toBe('image');
    expect(familyFromMime('application/pdf')).toBe('pdf');
    expect(familyFromMime('text/csv')).toBe('text');
    expect(familyFromMime('video/mp4')).toBe('video');
    expect(familyFromMime('')).toBeUndefined();
  });

  it('lists the formats of a family for the UI', () => {
    const image = formatsInFamily('image').map((format) => format.id);
    expect(image).toEqual(expect.arrayContaining(['jpg', 'png', 'webp', 'avif']));
  });

  it('guesses a family synchronously for a badge', () => {
    expect(guessFamily('a.png', '')).toBe('image');
    expect(guessFamily('a.xlsx', '')).toBe('spreadsheet');
    expect(guessFamily('a.docx', '')).toBe('office');
    expect(guessFamily('a.pdf', '')).toBe('pdf');
  });
});

describe('what the workspace offers', () => {
  it('offers the image tools for an image and none of the PDF ones', () => {
    const edges = availableEdges('image');
    const tools = edges.map((edge) => edge.tool);
    expect(tools).toContain('image-converter');
    expect(tools).toContain('image-compressor');
    expect(tools).not.toContain('merge-pdf');
  });

  it('offers unlock for both PDF and Office, which is the grouping the review asked for', () => {
    expect(availableEdges('pdf').some((edge) => edge.tool === 'unlock-pdf')).toBe(true);
    expect(availableEdges('office').some((edge) => edge.tool === 'unlock-office')).toBe(true);
  });

  it('never offers a tool that is switched off', () => {
    // Office encryption is compiled in but the output has not been verified.
    const office = availableEdges('office');
    expect(office.some((edge) => edge.tool === 'encrypt-office')).toBe(false);
    expect(availableEdges('text').every((edge) => edge.available !== false)).toBe(true);
  });

  it('tells an image which formats it can become', () => {
    const formats = convertibleFormats('image');
    expect(formats).toEqual(expect.arrayContaining(['jpg', 'png', 'webp', 'avif']));
  });

  it('does not claim a conversion that does not exist', () => {
    // There is no PDF converter here, and saying so is the honest answer.
    expect(convertibleFormats('pdf')).toEqual([]);
    expect(convertibleFormats('archive')).toEqual([]);
  });

  it('always offers the inspector, for every family including unknown', () => {
    for (const family of ['image', 'pdf', 'archive', 'spreadsheet', 'office', 'text', 'video', 'audio', 'unknown'] as const) {
      const edges = availableEdges(family);
      expect(edges.some((edge) => edge.tool === 'file-inspector'), family).toBe(true);
    }
  });
});
