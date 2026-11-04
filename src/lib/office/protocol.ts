/**
 * Contract shared by the Office tools, the client and the worker.
 *
 * Same shape as the PDF and ZIP protocols: a structured-clone-safe operation, a
 * single outcome, transferable buffers, `ToolErrorCode` on the failure branch.
 * Nothing here imports `office-crypto`, so the React layer can read these types
 * (and the limits below) without paying for the library.
 */
import type { ToolErrorCode } from '../files/errors';

export type OfficeFormat = 'docx' | 'xlsx' | 'pptx';

export interface OfficeSource {
  name: string;
  blob: Blob;
}

export type OfficeOperation =
  | { kind: 'decrypt'; source: OfficeSource; password: string }
  /** Behind the interoperability flag — see `features.ts`. */
  | { kind: 'encrypt'; source: OfficeSource; password: string };

export interface OfficeOutcome {
  /** The decrypted OOXML package (a ZIP), ownership passed to the receiver. */
  bytes: Uint8Array;
  format: OfficeFormat;
}

export interface OfficeWireOutcome {
  bytes: ArrayBuffer;
  format: OfficeFormat;
}

export type OfficeWorkerRequest =
  | { type: 'run'; id: number; operation: OfficeOperation }
  | { type: 'cancel'; id: number };

export type OfficeWorkerResponse =
  | { type: 'progress'; id: number; ratio: number }
  | { type: 'done'; id: number; outcome: OfficeWireOutcome }
  | { type: 'error'; id: number; code: ToolErrorCode; message: string; hint?: string };

/** Extensions this tool can decrypt, and what the decrypted file is called. */
export const OFFICE_FORMATS: Record<OfficeFormat, { extension: string; label: string; mime: string }> = {
  docx: {
    extension: 'docx',
    label: 'Word document',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  xlsx: {
    extension: 'xlsx',
    label: 'Excel workbook',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  pptx: {
    extension: 'pptx',
    label: 'PowerPoint presentation',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
};

export function toTransferableBuffer(bytes: Uint8Array): ArrayBuffer {
  const { byteOffset, byteLength } = bytes;
  const buffer = bytes.buffer as ArrayBuffer;
  if (buffer instanceof ArrayBuffer && byteOffset === 0 && byteLength === buffer.byteLength) return buffer;
  return buffer.slice(byteOffset, byteOffset + byteLength);
}

export function encodeOfficeOutcome(outcome: OfficeOutcome): { wire: OfficeWireOutcome; transfer: ArrayBuffer[] } {
  const bytes = toTransferableBuffer(outcome.bytes);
  return { wire: { bytes, format: outcome.format }, transfer: [bytes] };
}

export function decodeOfficeOutcome(wire: OfficeWireOutcome): OfficeOutcome {
  return { bytes: new Uint8Array(wire.bytes), format: wire.format };
}
