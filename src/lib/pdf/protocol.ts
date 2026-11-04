/**
 * Contract shared by the PDF tools, the client and the worker.
 *
 * Everything here is transferable/structured-clone safe: no pdf-lib types leak
 * out of `ops.ts`, so the main thread never imports the library just to talk to
 * the worker.
 *
 * Inputs are `Blob`s, not `ArrayBuffer`s, on purpose:
 *
 *  - A `Blob` crosses the worker boundary as a handle. The bytes are not copied,
 *    and the main thread never allocates a multi-hundred-megabyte buffer just to
 *    hand it over.
 *  - The worker reads one document at a time, so peak memory is roughly one
 *    source plus the growing output — not "every input at once".
 *  - Nothing is detached, so a caller cannot accidentally reuse a consumed
 *    buffer and get a confusing zero-length error.
 *
 * Results travel the other way as `ArrayBuffer`s in the transfer list, so the
 * worker gives up ownership instead of keeping a duplicate alive.
 */
import type { ToolErrorCode } from '../files/errors';

export interface PageInfo {
  index: number;
  width: number;
  height: number;
  rotation: number;
}

export interface PdfSource {
  name: string;
  blob: Blob;
}

export interface PdfImageSource {
  name: string;
  type: string;
  blob: Blob;
}

export interface ExtractOptions {
  rotate?: number;
  pageSize?: { width: number; height: number };
}

export interface ImagesToPdfOptions {
  pageSize: 'fit' | 'a4';
  margin: number;
}

/**
 * How to protect a document.
 *
 * Flat booleans rather than nested objects: this crosses the worker boundary by
 * structured clone, and a flat record is the shape that cannot silently lose a
 * field on the way. `userPassword: ''` is a real mode — the document opens
 * without a password but carries restrictions — so emptiness is meaningful here
 * and must never be conflated with "not set".
 */
export interface PdfProtection {
  /** Open password. Empty string means "opens without one". */
  userPassword: string;
  /** Password that lifts the restrictions. Always at least one character. */
  ownerPassword: string;
  allowPrinting: boolean;
  allowCopying: boolean;
  allowModifying: boolean;
  allowAnnotating: boolean;
}

/** AES-256 (`/V 5`, `/R 6`) is the only cipher this app writes for PDFs. */
export const PDF_CIPHER = 'AES-256' as const;

/** Long enough for a passphrase, short enough to stay a sane input field. */
export const MAX_PDF_PASSWORD_LENGTH = 128;

export type PdfOperation =
  | { kind: 'describe'; source: PdfSource }
  | { kind: 'merge'; sources: PdfSource[] }
  | { kind: 'split'; source: PdfSource; groups: number[][] }
  | { kind: 'extract'; source: PdfSource; indices: number[]; options?: ExtractOptions }
  | { kind: 'rotate'; source: PdfSource; degrees: number }
  | { kind: 'images-to-pdf'; images: PdfImageSource[]; options: ImagesToPdfOptions }
  | { kind: 'protect'; source: PdfSource; protection: PdfProtection }
  | { kind: 'unlock'; source: PdfSource; password: string };

/**
 * One result shape for every operation. `documents` holds the produced PDFs in
 * output order; `pages` is only populated by `describe`. Keeping a single shape
 * means the client has one decode path instead of six.
 */
export interface PdfOutcome {
  documents: Uint8Array[];
  pages: PageInfo[];
  pageCount: number;
  documentCount: number;
  /**
   * Set by `unlock`: whether the source actually carried an `/Encrypt` entry.
   * A file that only needed an empty password still reports `true`, so the UI
   * can say "protection removed" instead of guessing from the password field.
   */
  wasEncrypted?: boolean;
}

/** Wire form — `ArrayBuffer`s so they can be transferred, not copied. */
export interface PdfWireOutcome {
  buffers: ArrayBuffer[];
  pages: PageInfo[];
  pageCount: number;
  documentCount: number;
  wasEncrypted?: boolean;
}

export type PdfWorkerRequest =
  | { type: 'run'; id: number; operation: PdfOperation }
  | { type: 'cancel'; id: number };

export type PdfWorkerResponse =
  | { type: 'progress'; id: number; ratio: number }
  | { type: 'done'; id: number; outcome: PdfWireOutcome }
  | { type: 'error'; id: number; code: ToolErrorCode; message: string; hint?: string };

/**
 * A `Uint8Array` view that exactly covers its buffer can be transferred for
 * free; otherwise slice out a copy (pdf-lib's `save()` normally returns an exact
 * view, so the copy path is rare).
 */
export function toTransferableBuffer(bytes: Uint8Array): ArrayBuffer {
  const { byteOffset, byteLength } = bytes;
  // `.slice()` on the buffer yields a plain ArrayBuffer, which is what the
  // transfer list accepts (a SharedArrayBuffer view is never transferable).
  const buffer: ArrayBuffer = bytes.buffer as ArrayBuffer;
  if (buffer instanceof ArrayBuffer && byteOffset === 0 && byteLength === buffer.byteLength) {
    return buffer;
  }
  return buffer.slice(byteOffset, byteOffset + byteLength);
}

export function encodePdfOutcome(outcome: PdfOutcome): { wire: PdfWireOutcome; transfer: ArrayBuffer[] } {
  const buffers = outcome.documents.map(toTransferableBuffer);
  return {
    wire: {
      buffers,
      pages: outcome.pages,
      pageCount: outcome.pageCount,
      documentCount: outcome.documentCount,
      wasEncrypted: outcome.wasEncrypted,
    },
    transfer: buffers,
  };
}

export function decodePdfOutcome(wire: PdfWireOutcome): PdfOutcome {
  return {
    documents: wire.buffers.map((buffer) => new Uint8Array(buffer)),
    pages: wire.pages,
    pageCount: wire.pageCount,
    documentCount: wire.documentCount,
    wasEncrypted: wire.wasEncrypted,
  };
}
