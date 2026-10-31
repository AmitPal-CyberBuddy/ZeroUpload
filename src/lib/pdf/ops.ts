/**
 * The pdf-lib work itself.
 *
 * This module is loaded **inside the worker** (and, as a fallback, on the main
 * thread when a worker cannot be created). It is deliberately free of DOM API
 * use so the two hosts behave identically, and it is the only place pdf-lib is
 * imported — the library never reaches the entry chunk.
 *
 * Memory: inputs arrive as `Blob`s and are read **one at a time**, so the peak
 * is roughly one source document plus the output being built — not the whole
 * batch at once. Nothing here relies on DOM APIs, so the worker and the
 * main-thread fallback behave identically.
 */
import { PDFDocument, EncryptedPDFError, PDFDict, PDFInvalidObject, degrees } from '@cantoo/pdf-lib';
import { ToolError } from '../files/errors';
import { OPERATION_BUDGETS, assertCumulativeBudget, assertPageBudget } from '../files/budget';
import type {
  ExtractOptions,
  ImagesToPdfOptions,
  PageInfo,
  PdfImageSource,
  PdfOperation,
  PdfOutcome,
  PdfProtection,
  PdfSource,
} from './protocol';
import { MAX_PDF_PASSWORD_LENGTH } from './protocol';

export interface OperationContext {
  /** 0–1. Called from inside the worker; each call is a `postMessage`. */
  onProgress?: (ratio: number) => void;
  /** Cooperative cancellation, polled between documents. */
  isCancelled?: () => boolean;
}

/** More outputs than this at once is a memory problem, not a feature. */
export const MAX_OUTPUT_DOCUMENTS = 1_000;

const A4 = { width: 595.28, height: 841.89 };

/**
 * Returns control to the host event loop.
 *
 * Without this, a loop of `await out.save()` calls only ever yields to the
 * microtask queue, so a `cancel` message sitting in the worker's queue is never
 * dispatched until the whole batch has finished — cancellation that cannot
 * actually cancel. Yielding every few documents also keeps progress painting.
 */
const yieldToHost = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function assertActive(context: OperationContext): void {
  if (context.isCancelled?.()) {
    throw new ToolError('cancelled', 'Processing was cancelled.', 'Nothing was downloaded.');
  }
}

/** Reads one source. Called per document so only one copy is live at a time. */
async function readSource(source: PdfSource): Promise<Uint8Array> {
  if (source.blob.size === 0) {
    throw new ToolError(
      'empty-input',
      `${source.name || 'This file'} is empty.`,
      'Choose a file that has content.',
    );
  }
  return new Uint8Array(await source.blob.arrayBuffer());
}

async function loadDocument(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
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

function describe(doc: PDFDocument): PageInfo[] {
  return doc.getPages().map((page, index) => ({
    index,
    width: Math.round(page.getWidth()),
    height: Math.round(page.getHeight()),
    rotation: page.getRotation().angle,
  }));
}

/**
 * Shape checks that need no page count, so they run **before** the source is
 * read: an impossible request costs nothing.
 */
function assertGroupShape(groups: number[][]): void {
  if (groups.length === 0) {
    throw new ToolError('invalid-input', 'No pages were selected.', 'Choose at least one page.');
  }
  if (groups.length > MAX_OUTPUT_DOCUMENTS) {
    throw new ToolError(
      'limit-exceeded',
      `This would produce ${groups.length.toLocaleString()} files in one run.`,
      `One run is limited to ${MAX_OUTPUT_DOCUMENTS.toLocaleString()} outputs so the tab stays alive. Split the document in a few passes instead.`,
    );
  }
  for (const group of groups) {
    if (group.length === 0) {
      throw new ToolError('invalid-input', 'One of the page groups is empty.');
    }
  }
}

/** Bounds checks — these need the real page count, so they run after loading. */
function assertGroupIndices(groups: number[][], pageCount: number): void {
  for (const group of groups) {
    for (const index of group) {
      if (!Number.isInteger(index) || index < 0 || index >= pageCount) {
        throw new ToolError(
          'invalid-input',
          `Page ${index + 1} does not exist.`,
          `This document has ${pageCount} page${pageCount === 1 ? '' : 's'}.`,
        );
      }
    }
  }
}

async function runDescribe(source: PdfSource, context: OperationContext): Promise<PdfOutcome> {
  assertActive(context);
  const doc = await loadDocument(await readSource(source));
  const pages = describe(doc);
  context.onProgress?.(1);
  return { documents: [], pages, pageCount: pages.length, documentCount: 1 };
}

async function runMerge(sources: PdfSource[], context: OperationContext): Promise<PdfOutcome> {
  const budget = OPERATION_BUDGETS.pdfMerge;
  // Metadata only: `Blob.size` is known without reading anything.
  assertCumulativeBudget(
    sources.map((source) => ({ name: source.name, size: source.blob.size })),
    budget,
  );

  const out = await PDFDocument.create();
  let pagesSoFar = 0;

  for (let index = 0; index < sources.length; index += 1) {
    assertActive(context);
    const src = await loadDocument(await readSource(sources[index]));
    // Check the page ceiling as documents load, before copying anything.
    pagesSoFar += src.getPageCount();
    assertPageBudget(pagesSoFar, budget);

    const copied = await out.copyPages(src, src.getPageIndices());
    for (const page of copied) out.addPage(page);
    // Leave the last tenth for the serialisation step.
    context.onProgress?.(((index + 1) / sources.length) * 0.9);
    await yieldToHost();
  }

  out.setProducer('ZeroUpload');
  const bytes = await out.save();
  context.onProgress?.(1);
  return {
    documents: [bytes],
    pages: [],
    pageCount: pagesSoFar,
    documentCount: sources.length,
  };
}

/**
 * Splits a document while parsing it **once**.
 *
 * The obvious implementation calls `extractPages` per output document, which
 * re-parses the entire source every time. Measured on a 300-page PDF that costs
 * ~23 ms/page versus ~1.1 ms/page here — the gap widens with page count.
 */
async function runSplit(
  source: PdfSource,
  groups: number[][],
  context: OperationContext,
): Promise<PdfOutcome> {
  assertActive(context);
  // Count and shape first: a 1,001-document request is refused before any read.
  assertGroupShape(groups);
  const src = await loadDocument(await readSource(source));
  const pageCount = src.getPageCount();
  assertGroupIndices(groups, pageCount);

  const documents: Uint8Array[] = [];
  for (let index = 0; index < groups.length; index += 1) {
    assertActive(context);
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, groups[index]);
    for (const page of copied) out.addPage(page);
    out.setProducer('ZeroUpload');
    documents.push(await out.save());
    context.onProgress?.((index + 1) / groups.length);
    if (index % 8 === 7) await yieldToHost();
  }

  return {
    documents,
    pages: [],
    pageCount: groups.reduce((sum, group) => sum + group.length, 0),
    documentCount: documents.length,
  };
}

async function runExtract(
  source: PdfSource,
  indices: number[],
  options: ExtractOptions,
  context: OperationContext,
): Promise<PdfOutcome> {
  assertActive(context);
  const src = await loadDocument(await readSource(source));
  const pageCount = src.getPageCount();
  assertGroupIndices([indices], pageCount);

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
  const bytes = await out.save();
  context.onProgress?.(1);
  return { documents: [bytes], pages: [], pageCount: indices.length, documentCount: 1 };
}

async function runRotate(
  source: PdfSource,
  byDegrees: number,
  context: OperationContext,
): Promise<PdfOutcome> {
  if (!Number.isFinite(byDegrees) || byDegrees % 90 !== 0) {
    throw new ToolError('invalid-input', 'Rotation must be a multiple of 90°.', 'Use 90, 180 or 270.');
  }
  assertActive(context);
  const doc = await loadDocument(await readSource(source));
  for (const page of doc.getPages()) {
    page.setRotation(degrees((((page.getRotation().angle + byDegrees) % 360) + 360) % 360));
  }
  doc.setProducer('ZeroUpload');
  const pages = describe(doc);
  const bytes = await doc.save();
  context.onProgress?.(1);
  return { documents: [bytes], pages, pageCount: pages.length, documentCount: 1 };
}

async function runImagesToPdf(
  images: PdfImageSource[],
  options: ImagesToPdfOptions,
  context: OperationContext,
): Promise<PdfOutcome> {
  const budget = OPERATION_BUDGETS.imagesToPdf;
  assertCumulativeBudget(
    images.map((image, index) => ({ name: image.name || `image ${index + 1}`, size: image.blob.size })),
    budget,
  );
  assertPageBudget(images.length, budget);

  assertActive(context);
  const doc = await PDFDocument.create();
  const margin = Math.max(0, options.margin);

  for (let index = 0; index < images.length; index += 1) {
    assertActive(context);
    const image = images[index];
    if (image.blob.size === 0) {
      throw new ToolError('empty-input', `${image.name || 'An image'} is empty.`);
    }
    // Read per image: a 150 MB batch never exists in memory all at once.
    const data = new Uint8Array(await image.blob.arrayBuffer());

    let embedded;
    if (image.type === 'image/png') {
      embedded = await doc.embedPng(data);
    } else if (image.type === 'image/jpeg') {
      embedded = await doc.embedJpg(data);
    } else {
      throw new ToolError(
        'unsupported-type',
        `${image.type || 'This image'} cannot be embedded directly.`,
        'Convert it to JPEG or PNG first — the image converter can do that locally.',
      );
    }

    if (options.pageSize === 'a4') {
      const page = doc.addPage([A4.width, A4.height]);
      const box = { width: A4.width - margin * 2, height: A4.height - margin * 2 };
      const scale = Math.min(box.width / embedded.width, box.height / embedded.height, 1);
      const width = embedded.width * scale;
      const height = embedded.height * scale;
      page.drawImage(embedded, {
        x: (A4.width - width) / 2,
        y: (A4.height - height) / 2,
        width,
        height,
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

    context.onProgress?.(((index + 1) / images.length) * 0.9);
    if (index % 8 === 7) await yieldToHost();
  }

  doc.setProducer('ZeroUpload');
  doc.setCreator('ZeroUpload · local-first');
  const bytes = await doc.save();
  context.onProgress?.(1);
  return { documents: [bytes], pages: [], pageCount: images.length, documentCount: 1 };
}

/**
 * A protection request is a password from a keyboard, so every rule here is a
 * message the user can act on — never a library exception surfaced raw.
 *
 * The two meaningful modes:
 *   - `userPassword` set    → the document cannot be opened without it.
 *   - `userPassword` empty  → the document opens for anyone, but carries `/P`
 *                             restrictions (advisory; the tool copy says so).
 * Both need an owner password, because that is what lifts the restrictions.
 */
function assertProtection(protection: PdfProtection): void {
  const { userPassword, ownerPassword } = protection;
  if (ownerPassword.length === 0) {
    throw new ToolError(
      'invalid-input',
      'An owner password is required.',
      'It is the password that removes the restrictions later, so it cannot be blank.',
    );
  }
  if (userPassword.length > MAX_PDF_PASSWORD_LENGTH || ownerPassword.length > MAX_PDF_PASSWORD_LENGTH) {
    throw new ToolError(
      'invalid-input',
      `Passwords are limited to ${MAX_PDF_PASSWORD_LENGTH} characters.`,
      'Most PDF readers behave erratically with unusually long passwords.',
    );
  }
  if (userPassword.length > 0 && userPassword.length < 4) {
    throw new ToolError(
      'invalid-input',
      'Use at least four characters for the open password.',
      'AES-256 is strong; a one-character password is not.',
    );
  }
  const restricts =
    !protection.allowPrinting || !protection.allowCopying || !protection.allowModifying || !protection.allowAnnotating;
  if (userPassword.length === 0 && !restricts) {
    throw new ToolError(
      'invalid-input',
      'Nothing would change: no password and every permission allowed.',
      'Set an open password, or turn at least one permission off.',
    );
  }
}

async function runProtect(
  source: PdfSource,
  protection: PdfProtection,
  context: OperationContext,
): Promise<PdfOutcome> {
  assertProtection(protection);
  assertActive(context);

  const bytes = await readSource(source);
  // Loading without a password: an already-protected file throws
  // `EncryptedPDFError`, and stacking a second layer is not something a reader
  // can undo, so it is refused rather than attempted.
  const doc = await loadDocument(bytes);
  assertActive(context);

  doc.encrypt({
    userPassword: protection.userPassword,
    ownerPassword: protection.ownerPassword,
    algorithm: 'AES-256',
    permissions: {
      printing: protection.allowPrinting ? 'highResolution' : false,
      copying: protection.allowCopying,
      modifying: protection.allowModifying,
      annotating: protection.allowAnnotating,
      // Extracting text for a screen reader is not a permission worth taking
      // away, and readers that honour it would make the document unusable for
      // people who need it. It is always granted.
      contentAccessibility: true,
      fillingForms: protection.allowAnnotating,
      documentAssembly: protection.allowModifying,
    },
  });

  const pages = describe(doc);
  const out = await doc.save();
  context.onProgress?.(1);
  return { documents: [out], pages: [], pageCount: pages.length, documentCount: 1 };
}

/**
 * Removes the leftovers of decryption before the plain document is written.
 *
 * Loading an encrypted file leaves three things behind that the writer would
 * otherwise copy verbatim: the `/Encrypt` dictionary itself, the previous
 * cross-reference stream (which still names `/Encrypt`), and the orphaned
 * metadata object the security handler created. The output would open fine —
 * the new trailer does not reference any of them — but a file that still
 * *contains* the old `/O` and `/U` hashes is not what "protection removed"
 * should mean, and naive scanners flag it.
 *
 * The match is deliberately narrow: the standard security handler is the only
 * dictionary carrying `/O` + `/U` + `/P` + `/R`, and `PDFInvalidObject` is the
 * library's bucket for raw objects it could not classify (in practice, the old
 * xref stream). Pages and content streams are typed objects and are untouched.
 */
function stripEncryptionArtifacts(doc: PDFDocument): void {
  const doomed: { ref: unknown }[] = [];
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    if (object instanceof PDFInvalidObject) {
      doomed.push({ ref });
      continue;
    }
    if (!(object instanceof PDFDict)) continue;
    const keys = object.keys().map((key) => key.toString());
    const isSecurityHandler = ['/O', '/U', '/P', '/R'].every((key) => keys.includes(key));
    if (isSecurityHandler || keys.includes('/Encrypt')) doomed.push({ ref });
  }
  // Deleting inside the enumeration skips entries, so the pass above only
  // collects; removal happens here.
  for (const entry of doomed) doc.context.delete(entry.ref as Parameters<typeof doc.context.delete>[0]);
}

/**
 * Open symmetrically is not guaranteed — a file may be protected by any
 * reader's dialect. Matching on the message is unlovely, but it is the only
 * signal the library gives, and every branch ends in the same actionable error.
 */
function isWrongPasswordError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /password incorrect|needs password|bad password|invalid password/i.test(error.message);
}

async function runUnlock(source: PdfSource, password: string, context: OperationContext): Promise<PdfOutcome> {
  if (password.length > MAX_PDF_PASSWORD_LENGTH) {
    throw new ToolError('invalid-input', `Passwords are limited to ${MAX_PDF_PASSWORD_LENGTH} characters.`);
  }
  assertActive(context);
  const bytes = await readSource(source);

  /*
   * Is it encrypted at all? Asking the parser is exact, and costs one parse: an
   * unprotected document loads here and the answer is `false`. Only when that
   * throws is the password used, so the "already unlocked" case costs one parse
   * instead of two.
   *
   * (`doc.isEncrypted` cannot answer this: it is `true` only for a document
   * loaded with `ignoreEncryption`, i.e. one that was *not* decrypted.)
   */
  let wasEncrypted: boolean;
  try {
    await PDFDocument.load(bytes, { updateMetadata: false });
    wasEncrypted = false;
  } catch (error) {
    if (!(error instanceof EncryptedPDFError)) {
      throw new ToolError(
        'corrupt-file',
        'This file could not be read as a PDF.',
        'It may be damaged, or it may not be a PDF at all.',
      );
    }
    wasEncrypted = true;
  }

  let doc: PDFDocument;
  try {
    // Always pass `password`, even when empty: for a restrictions-only file the
    // empty password is the correct key, and the library documents that
    // distinction rather than treating '' as "no password given".
    doc = await PDFDocument.load(bytes, { password, updateMetadata: false });
  } catch (error) {
    if (isWrongPasswordError(error) || error instanceof EncryptedPDFError) {
      throw new ToolError(
        'encrypted',
        password.length === 0 ? 'This PDF needs a password to open.' : 'That password did not open this document.',
        'Check capitals, spaces and keyboard layout. If the file only restricts printing or copying, it opens with no password at all — leave the field empty and try again.',
      );
    }
    throw new ToolError(
      'corrupt-file',
      'This file could not be read as a PDF.',
      'It may be damaged, or it may not be a PDF at all.',
    );
  }

  assertActive(context);
  // Re-saving writes a plain document, but the parsed source still carries the
  // security handler and its cross-reference stream; they are dropped first so
  // the result contains no trace of the old protection.
  stripEncryptionArtifacts(doc);
  const pages = describe(doc);
  const out = await doc.save();
  context.onProgress?.(1);
  return { documents: [out], pages: [], pageCount: pages.length, documentCount: 1, wasEncrypted };
}

/**
 * Single entry point used by both the worker and the main-thread fallback.
 * Throws `ToolError` for everything a user could plausibly cause.
 */
export async function runOperation(
  operation: PdfOperation,
  context: OperationContext = {},
): Promise<PdfOutcome> {
  switch (operation.kind) {
    case 'describe':
      return runDescribe(operation.source, context);
    case 'merge':
      return runMerge(operation.sources, context);
    case 'split':
      return runSplit(operation.source, operation.groups, context);
    case 'extract':
      return runExtract(operation.source, operation.indices, operation.options ?? {}, context);
    case 'rotate':
      return runRotate(operation.source, operation.degrees, context);
    case 'images-to-pdf':
      return runImagesToPdf(operation.images, operation.options, context);
    case 'protect':
      return runProtect(operation.source, operation.protection, context);
    case 'unlock':
      return runUnlock(operation.source, operation.password, context);
  }
}
