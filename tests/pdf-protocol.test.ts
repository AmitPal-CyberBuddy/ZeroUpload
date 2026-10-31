import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  decodePdfOutcome,
  encodePdfOutcome,
  toTransferableBuffer,
  type PdfOutcome,
} from '../src/lib/pdf/protocol';
import { MAX_OUTPUT_DOCUMENTS, runOperation } from '../src/lib/pdf/ops';
import { pdfBytesToBlob } from '../src/lib/pdf/pdf';
import { OPERATION_BUDGETS } from '../src/lib/files/budget';
import { ToolError } from '../src/lib/files/errors';
import { MB, unreadableBlob } from './helpers';

async function pdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i += 1) {
    doc.addPage([595, 842]).drawText(`page ${i + 1}`, { x: 40, y: 700, size: 12 });
  }
  return doc.save();
}

const asSource = (name: string, bytes: Uint8Array) => ({
  name,
  blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }),
});

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
    return 'no-throw';
  } catch (error) {
    return (error as ToolError).code;
  }
};

describe('worker protocol encoding', () => {
  it('reuses an exactly-covering buffer without copying', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(toTransferableBuffer(bytes)).toBe(bytes.buffer);
  });

  it('copies only when the view is a window into a larger buffer', () => {
    const backing = new Uint8Array([9, 1, 2, 3, 9]);
    const view = backing.subarray(1, 4);
    const transferred = toTransferableBuffer(view);
    expect(transferred).not.toBe(backing.buffer);
    expect(transferred.byteLength).toBe(3);
    expect([...new Uint8Array(transferred)]).toEqual([1, 2, 3]);
  });

  it('round-trips an outcome, preserving metadata and bytes', () => {
    const outcome: PdfOutcome = {
      documents: [new Uint8Array([1, 2]), new Uint8Array([3])],
      pages: [{ index: 0, width: 595, height: 842, rotation: 0 }],
      pageCount: 3,
      documentCount: 2,
    };
    const { wire, transfer } = encodePdfOutcome(outcome);
    expect(transfer).toHaveLength(2);
    const decoded = decodePdfOutcome(wire);
    expect(decoded.pageCount).toBe(3);
    expect(decoded.documentCount).toBe(2);
    expect(decoded.pages).toEqual(outcome.pages);
    expect(decoded.documents.map((doc) => [...doc])).toEqual([[1, 2], [3]]);
  });

  it('survives structured cloning, the way the worker boundary uses it', () => {
    const outcome: PdfOutcome = {
      documents: [new Uint8Array([7, 8, 9])],
      pages: [],
      pageCount: 1,
      documentCount: 1,
    };
    const { wire } = encodePdfOutcome(outcome);
    const cloned = structuredClone(wire);
    expect([...decodePdfOutcome(cloned).documents[0]]).toEqual([7, 8, 9]);
  });
});

describe('operation budgets are enforced before reading inputs', () => {
  it('rejects a merge over the item limit without touching the files', async () => {
    const sources = Array.from({ length: OPERATION_BUDGETS.pdfMerge.maxItems + 1 }, (_, i) => ({
      name: `f${i}.pdf`,
      blob: unreadableBlob(1024),
    }));
    expect(await codeOf(runOperation({ kind: 'merge', sources }))).toBe('limit-exceeded');
    expect(sources.every((source) => (source.blob as unknown as { reads: number }).reads === 0)).toBe(true);
  });

  it('rejects a merge over the cumulative byte limit without reading', async () => {
    const sources = [
      { name: 'a.pdf', blob: unreadableBlob(150 * MB) },
      { name: 'b.pdf', blob: unreadableBlob(150 * MB) },
    ];
    const error = await runOperation({ kind: 'merge', sources }).catch((err: unknown) => err as ToolError);
    expect((error as ToolError).code).toBe('limit-exceeded');
    expect((error as ToolError).message).toMatch(/300 MB together/);
    expect(sources.every((source) => (source.blob as unknown as { reads: number }).reads === 0)).toBe(true);
  });

  it('rejects images-to-pdf over the byte limit without reading', async () => {
    const images = [
      { name: 'a.png', type: 'image/png', blob: unreadableBlob(80 * MB) },
      { name: 'b.png', type: 'image/png', blob: unreadableBlob(80 * MB) },
    ];
    expect(
      await codeOf(runOperation({ kind: 'images-to-pdf', images, options: { pageSize: 'fit', margin: 0 } })),
    ).toBe('limit-exceeded');
    expect(images.every((image) => (image.blob as unknown as { reads: number }).reads === 0)).toBe(true);
  });

  it('rejects an empty input and a corrupt document with distinct codes', async () => {
    expect(await codeOf(runOperation({ kind: 'describe', source: { name: 'empty', blob: new Blob([]) } }))).toBe(
      'empty-input',
    );
    expect(
      await codeOf(runOperation({ kind: 'describe', source: { name: 'junk', blob: new Blob(['not a pdf']) } })),
    ).toBe('corrupt-file');
  });

  it('rejects an invalid rotation angle', async () => {
    const bytes = await pdf(1);
    expect(
      await codeOf(runOperation({ kind: 'rotate', source: asSource('a.pdf', bytes), degrees: 45 })),
    ).toBe('invalid-input');
  });

  it('caps the number of documents one split may produce', async () => {
    const bytes = await pdf(1);
    const groups = Array.from({ length: MAX_OUTPUT_DOCUMENTS + 1 }, () => [0]);
    expect(await codeOf(runOperation({ kind: 'split', source: asSource('a.pdf', bytes), groups }))).toBe(
      'limit-exceeded',
    );
  });

  it('rejects a page group that points outside the document', async () => {
    const bytes = await pdf(2);
    expect(await codeOf(runOperation({ kind: 'split', source: asSource('a.pdf', bytes), groups: [[5]] }))).toBe(
      'invalid-input',
    );
  });
});

describe('operations produce the same results as before the worker refactor', () => {
  it('describes pages with dimensions and rotation', async () => {
    const outcome = await runOperation({ kind: 'describe', source: asSource('a.pdf', await pdf(3)) });
    expect(outcome.pages).toHaveLength(3);
    expect(outcome.pages[0]).toMatchObject({ index: 0, width: 595, height: 842, rotation: 0 });
  });

  it('merges and reports the page count without re-parsing', async () => {
    const outcome = await runOperation({
      kind: 'merge',
      sources: [asSource('a.pdf', await pdf(2)), asSource('b.pdf', await pdf(3))],
    });
    expect(outcome.pageCount).toBe(5);
    expect(outcome.documentCount).toBe(2);
    expect(outcome.documents).toHaveLength(1);
    const reopened = await PDFDocument.load(outcome.documents[0]);
    expect(reopened.getPageCount()).toBe(5);
  });

  it('splits into the requested groups, in order', async () => {
    const outcome = await runOperation({
      kind: 'split',
      source: asSource('a.pdf', await pdf(5)),
      groups: [[0, 1], [2], [3, 4]],
    });
    expect(outcome.documents).toHaveLength(3);
    expect(outcome.pageCount).toBe(5);
    const counts = await Promise.all(outcome.documents.map(async (doc) => (await PDFDocument.load(doc)).getPageCount()));
    expect(counts).toEqual([2, 1, 2]);
  });

  it('extracts pages and applies rotation', async () => {
    const outcome = await runOperation({
      kind: 'extract',
      source: asSource('a.pdf', await pdf(4)),
      indices: [1, 2],
      options: { rotate: 90 },
    });
    const doc = await PDFDocument.load(outcome.documents[0]);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getRotation().angle).toBe(90);
  });

  it('reports progress from 0 to 1', async () => {
    const seen: number[] = [];
    await runOperation(
      { kind: 'split', source: asSource('a.pdf', await pdf(6)), groups: [[0], [1], [2], [3], [4], [5]] },
      { onProgress: (ratio) => seen.push(ratio) },
    );
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.at(-1)).toBe(1);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });

  it('honours cooperative cancellation between documents', async () => {
    let calls = 0;
    const error = await runOperation(
      { kind: 'split', source: asSource('a.pdf', await pdf(10)), groups: [[0], [1], [2], [3], [4]] },
      {
        onProgress: () => {
          calls += 1;
        },
        isCancelled: () => calls >= 2,
      },
    ).catch((err: unknown) => err as ToolError);

    expect((error as ToolError).code).toBe('cancelled');
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(calls).toBeLessThan(5);
  });
});

describe('pdfBytesToBlob', () => {
  it('wraps the bytes without altering them', () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const blob = pdfBytesToBlob(bytes);
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBe(4);
  });

  it('copies exactly the view, not the whole backing buffer', async () => {
    const backing = new Uint8Array([9, 9, 0x25, 0x50, 9]);
    const blob = pdfBytesToBlob(backing.subarray(2, 4));
    expect(blob.size).toBe(2);
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([0x25, 0x50]);
  });
});
