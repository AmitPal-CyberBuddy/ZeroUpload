/**
 * PDF operations built on pdf-lib.
 *
 * pdf-lib is lazy-loaded (dynamic import) by every caller — it is ~380 kB and
 * only needed inside the PDF tools, so it must never land in the entry chunk.
 *
 * These helpers are structurally safe: page indices are validated, and encrypted
 * or malformed documents surface as a `ToolError` rather than a silent failure.
 */
import { ToolError } from '../files/errors';

export type PDFDocument = import('pdf-lib').PDFDocument;

export async function loadPdf(data: ArrayBuffer): Promise<PDFDocument> {
  const { PDFDocument, EncryptedPDFError } = await import('pdf-lib');
  try {
    return await PDFDocument.load(data, { updateMetadata: false });
  } catch (error) {
    if (error instanceof EncryptedPDFError) {
      throw new ToolError(
        'encrypted',
        'This PDF is password protected.',
        'Remove the password in a PDF reader first, then try again.',
      );
    }
    throw new ToolError(
      'corrupt-file',
      'This file could not be read as a PDF.',
      'It may be damaged, or it may not be a PDF at all.',
    );
  }
}

export interface PageInfo {
  index: number;
  width: number;
  height: number;
  rotation: number;
}

export async function describePdf(bytes: ArrayBuffer): Promise<PageInfo[]> {
  const doc = await loadPdf(bytes);
  return doc.getPages().map((page, index) => ({
    index,
    width: Math.round(page.getWidth()),
    height: Math.round(page.getHeight()),
    rotation: page.getRotation().angle,
  }));
}

/** Parses "1-3, 5, 8-" into zero-based page indices, validated against the count. */
export function parsePageRanges(input: string, pageCount: number): number[] {
  const cleaned = input.trim();
  if (!cleaned) {
    throw new ToolError('invalid-input', 'Enter at least one page or range.', 'For example: 1-3, 5');
  }

  const seen = new Set<number>();
  for (const chunk of cleaned.split(/[,\s]+/).filter(Boolean)) {
    const match = /^(\d+)?\s*-\s*(\d+)?$/.exec(chunk);
    if (match && (match[1] || match[2])) {
      const start = match[1] ? Number(match[1]) : 1;
      const end = match[2] ? Number(match[2]) : pageCount;
      if (start < 1 || end < 1) {
        throw new ToolError('invalid-input', `"${chunk}" is not a valid page range.`, 'Pages start at 1.');
      }
      if (start > end) {
        throw new ToolError('invalid-input', `"${chunk}" counts backwards.`, 'Use a range like 2-5.');
      }
      for (let i = start; i <= Math.min(end, pageCount); i += 1) seen.add(i - 1);
    } else if (/^\d+$/.test(chunk)) {
      const n = Number(chunk);
      if (n < 1 || n > pageCount) {
        throw new ToolError('invalid-input', `Page ${n} does not exist.`, `This document has ${pageCount} pages.`);
      }
      seen.add(n - 1);
    } else {
      throw new ToolError('invalid-input', `"${chunk}" is not a page number or range.`, 'For example: 1-3, 5');
    }
  }

  if (seen.size === 0) {
    throw new ToolError('invalid-input', 'No pages selected.', 'The ranges you entered are outside this document.');
  }
  return [...seen].sort((a, b) => a - b);
}

export async function mergePdfs(files: { name: string; data: ArrayBuffer }[]): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const out = await PDFDocument.create();
  for (const file of files) {
    const src = await loadPdf(file.data);
    const indices = src.getPageIndices();
    const copied = await out.copyPages(src, indices);
    for (const page of copied) out.addPage(page);
  }
  out.setProducer('ZeroUpload');
  return out.save();
}

export async function extractPages(
  data: ArrayBuffer,
  indices: number[],
  options: { rotate?: number; pageSize?: { width: number; height: number } } = {},
): Promise<Uint8Array> {
  const { PDFDocument, degrees } = await import('pdf-lib');
  const src = await loadPdf(data);
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, indices);
  for (const page of copied) {
    if (options.rotate) {
      page.setRotation(degrees((page.getRotation().angle + options.rotate) % 360));
    }
    const size = page.getSize();
    if (options.pageSize && (size.width > options.pageSize.width || size.height > options.pageSize.height)) {
      page.scale(options.pageSize.width / size.width, options.pageSize.height / size.height);
    }
    out.addPage(page);
  }
  out.setProducer('ZeroUpload');
  return out.save();
}

export async function rotatePdf(data: ArrayBuffer, byDegrees: number): Promise<Uint8Array> {
  const { PDFDocument, degrees } = await import('pdf-lib');
  const doc = await PDFDocument.load(data, { updateMetadata: false });
  for (const page of doc.getPages()) {
    page.setRotation(degrees(((page.getRotation().angle + byDegrees) % 360 + 360) % 360));
  }
  doc.setProducer('ZeroUpload');
  return doc.save();
}

export async function imagesToPdf(
  images: { blob: Blob; type: string }[],
  options: { pageSize: 'fit' | 'a4'; margin: number },
): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const A4 = { width: 595.28, height: 841.89 };

  for (const image of images) {
    const bytes = new Uint8Array(await image.blob.arrayBuffer());
    let embedded;
    if (image.type === 'image/png') {
      embedded = await doc.embedPng(bytes);
    } else if (image.type === 'image/jpeg') {
      embedded = await doc.embedJpg(bytes);
    } else {
      throw new ToolError(
        'unsupported-type',
        `${image.type || 'This image'} cannot be embedded directly.`,
        'Convert it to JPEG or PNG first — the image converter can do that locally.',
      );
    }

    const margin = Math.max(0, options.margin);
    if (options.pageSize === 'a4') {
      const page = doc.addPage([A4.width, A4.height]);
      const box = {
        width: A4.width - margin * 2,
        height: A4.height - margin * 2,
      };
      const scale = Math.min(box.width / embedded.width, box.height / embedded.height, 1);
      const w = embedded.width * scale;
      const h = embedded.height * scale;
      page.drawImage(embedded, {
        x: (A4.width - w) / 2,
        y: (A4.height - h) / 2,
        width: w,
        height: h,
      });
    } else {
      const page = doc.addPage([embedded.width + margin * 2, embedded.height + margin * 2]);
      page.drawImage(embedded, {
        x: margin,
        y: margin,
        width: embedded.width,
        height: embedded.height,
      });
    }
  }

  doc.setProducer('ZeroUpload');
  doc.setCreator('ZeroUpload · local-first');
  return doc.save();
}

export function pdfBytesToBlob(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes);
  return new Blob([copy], { type: 'application/pdf' });
}
