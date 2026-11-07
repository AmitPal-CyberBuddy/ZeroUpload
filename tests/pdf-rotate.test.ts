import { describe, expect, it } from 'vitest';
import { PDFDocument, degrees } from '@cantoo/pdf-lib';
import { runOperation } from '../src/lib/pdf/ops';
import { parsePageRanges } from '../src/lib/pdf/ranges';
import type { PdfOperation } from '../src/lib/pdf/protocol';

/**
 * Rotating *some* pages is the case that actually comes up with a scan: the cover
 * is fine and pages 4–9 arrived sideways. These tests read the rotation angle back
 * out of the produced document rather than trusting the operation's own return
 * value, because "rendered sideways but reports success" is the failure that would
 * survive a looser test.
 */

async function pdf(pageCount: number): Promise<Uint8Array> {
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

const rotate = (bytes: Uint8Array, degrees: number, pages?: number[]) =>
  runOperation({
    kind: 'rotate',
    source: asSource(bytes),
    degrees,
    ...(pages ? { pages } : {}),
  } satisfies PdfOperation);

const anglesOf = async (bytes: Uint8Array): Promise<number[]> => {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => ((page.getRotation().angle % 360) + 360) % 360);
};

describe('rotating every page', () => {
  it('turns the document when no page list is given', async () => {
    const outcome = await rotate(await pdf(4), 90);
    expect(await anglesOf(outcome.documents[0])).toEqual([90, 90, 90, 90]);
  });

  it('adds to an existing rotation instead of replacing it', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]).setRotation(degrees(90));
    doc.addPage([595, 842]);
    const bytes = await doc.save();

    const outcome = await rotate(bytes, 180);
    // 90 + 180 = 270, and the upright page simply becomes upside down.
    expect(await anglesOf(outcome.documents[0])).toEqual([270, 180]);
  });
});

describe('rotating selected pages', () => {
  it('turns only the pages that were listed', async () => {
    const outcome = await rotate(await pdf(6), 90, [1, 2, 3]);
    expect(await anglesOf(outcome.documents[0])).toEqual([0, 90, 90, 90, 0, 0]);
  });

  it('accepts the same range syntax the split tool does', async () => {
    const pages = parsePageRanges('2-4, 6', 6);
    expect(pages).toEqual([1, 2, 3, 5]);
    const outcome = await rotate(await pdf(6), 270, pages);
    expect(await anglesOf(outcome.documents[0])).toEqual([0, 270, 270, 270, 0, 270]);
  });

  it('keeps every page, including the ones it did not touch', async () => {
    const outcome = await rotate(await pdf(5), 90, [0]);
    const doc = await PDFDocument.load(outcome.documents[0]);
    expect(doc.getPageCount()).toBe(5);
  });

  it('ignores an out-of-range index rather than turning the wrong page', async () => {
    const outcome = await rotate(await pdf(3), 90, [0, 99]);
    expect(await anglesOf(outcome.documents[0])).toEqual([90, 0, 0]);
  });
});

describe('angles it refuses', () => {
  it('rejects anything that is not a multiple of 90', async () => {
    await expect(rotate(await pdf(2), 45)).rejects.toMatchObject({ code: 'invalid-input' });
  });
});
