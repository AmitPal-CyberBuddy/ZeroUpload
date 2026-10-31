/**
 * Public PDF API.
 *
 * Every operation runs in a worker (`pdf.worker.ts`) unless one cannot be
 * created, in which case the same code runs on the main thread. Callers do not
 * know or care which path was taken: same signature, same `ToolError`s, same
 * progress stream. Nothing in this file imports pdf-lib, so the React layer can
 * import `MAX_PAGES_FOR_PER_PAGE_SPLIT` or `parsePageRanges` from here without
 * paying for the library.
 *
 * Inputs are `Blob`s (a `File` is a `Blob`). The bytes are read inside the
 * worker, one document at a time, so the main thread never holds a copy and the
 * same file object can be processed again later.
 */
import {
  type ExtractOptions,
  type ImagesToPdfOptions,
  type PdfImageSource,
  type PdfOperation,
  type PdfOutcome,
  type PdfProtection,
  type PdfSource,
} from './protocol';

export type { ExtractOptions, ImagesToPdfOptions, PageInfo, PdfProtection } from './protocol';
export { MAX_PDF_PASSWORD_LENGTH, PDF_CIPHER } from './protocol';
export {
  MAX_PAGES_FOR_PER_PAGE_SPLIT,
  chunkPageIndices,
  everyPageIndices,
  parsePageRanges,
  summarisePageSelection,
} from './ranges';

export interface PdfRunOptions {
  /** 0–1, emitted from the worker as each document completes. */
  onProgress?: (ratio: number) => void;
  /** Cooperative: checked between documents, not inside a single save. */
  signal?: AbortSignal;
}

async function run(operation: PdfOperation, options: PdfRunOptions = {}): Promise<PdfOutcome> {
  // Loaded lazily so the client (and its worker URL) is only fetched on use.
  const { runPdfOperation } = await import('./client');
  return runPdfOperation(operation, options);
}

/** Files carry their name; a bare Blob (from `slice()`) does not. */
function source(file: { name?: string } & Blob): PdfSource {
  return { name: file.name ?? 'document.pdf', blob: file };
}

/** Page count, sizes and rotation without modifying the document. */
export async function describePdf(file: Blob & { name?: string }, options: PdfRunOptions = {}) {
  const outcome = await run({ kind: 'describe', source: source(file) }, options);
  return outcome.pages;
}

export interface MergeResult {
  bytes: Uint8Array;
  pageCount: number;
  documentCount: number;
}

/**
 * Merges documents and reports the page count, so callers never re-parse the output.
 *
 * Budget: merging keeps the source document parsed *and* the growing output in
 * memory, so cumulative input bytes and the output page count are both capped.
 */
export async function mergePdfs(
  files: { name: string; blob: Blob }[],
  options: PdfRunOptions = {},
): Promise<MergeResult> {
  const outcome = await run(
    { kind: 'merge', sources: files.map((file) => ({ name: file.name, blob: file.blob })) },
    options,
  );
  return { bytes: outcome.documents[0], pageCount: outcome.pageCount, documentCount: outcome.documentCount };
}

/** Splits a document into the given page groups, parsing the source **once**. */
export async function splitPdf(
  file: Blob & { name?: string },
  groups: number[][],
  options: PdfRunOptions = {},
): Promise<Uint8Array[]> {
  const outcome = await run({ kind: 'split', source: source(file), groups }, options);
  return outcome.documents;
}

export async function extractPages(
  file: Blob & { name?: string },
  indices: number[],
  options: ExtractOptions = {},
  runOptions: PdfRunOptions = {},
): Promise<Uint8Array> {
  const outcome = await run(
    { kind: 'extract', source: source(file), indices, options },
    runOptions,
  );
  return outcome.documents[0];
}

export async function rotatePdf(
  file: Blob & { name?: string },
  byDegrees: number,
  options: PdfRunOptions = {},
): Promise<Uint8Array> {
  const outcome = await run({ kind: 'rotate', source: source(file), degrees: byDegrees }, options);
  return outcome.documents[0];
}

/**
 * Builds a PDF from images. One image becomes one page, so the page budget *is*
 * the item budget; the byte budget matters because every embedded image stays
 * in the output document until it is saved.
 */
export async function imagesToPdf(
  images: { blob: Blob; type: string; name?: string }[],
  options: ImagesToPdfOptions,
  runOptions: PdfRunOptions = {},
): Promise<Uint8Array> {
  const sources: PdfImageSource[] = images.map((image, index) => ({
    name: image.name ?? (image.blob as File).name ?? `image ${index + 1}`,
    type: image.type,
    blob: image.blob,
  }));
  const outcome = await run({ kind: 'images-to-pdf', images: sources, options }, runOptions);
  return outcome.documents[0];
}

export interface ProtectResult {
  bytes: Uint8Array;
  pageCount: number;
}

/**
 * Protects a document with a password and `/P` restrictions.
 *
 * AES-256 (`/V 5`, `/R 6`) — the only cipher this app writes, and the only one
 * ISO 32000-2 still recommends. An empty `userPassword` is allowed and means the
 * document opens without a password while still carrying restrictions; that is
 * a real mode, not an accident of an empty form field.
 */
export async function protectPdf(
  file: Blob & { name?: string },
  protection: PdfProtection,
  options: PdfRunOptions = {},
): Promise<ProtectResult> {
  const outcome = await run({ kind: 'protect', source: source(file), protection }, options);
  return { bytes: outcome.documents[0], pageCount: outcome.pageCount };
}

export interface UnlockResult {
  bytes: Uint8Array;
  pageCount: number;
  /** Whether the source carried an `/Encrypt` entry at all. */
  wasEncrypted: boolean;
}

/**
 * Removes password protection. The output is a plain PDF: the `/Encrypt`
 * dictionary, the encryption key and the permission bits are not carried over.
 */
export async function unlockPdf(
  file: Blob & { name?: string },
  password: string,
  options: PdfRunOptions = {},
): Promise<UnlockResult> {
  const outcome = await run({ kind: 'unlock', source: source(file), password }, options);
  return {
    bytes: outcome.documents[0],
    pageCount: outcome.pageCount,
    wasEncrypted: outcome.wasEncrypted ?? false,
  };
}

/** `Blob` copies the view's bytes itself, so an extra `Uint8Array` copy is waste. */
export function pdfBytesToBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}
