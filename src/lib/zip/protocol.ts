/**
 * Contract shared by `createZip`, the client and the ZIP worker.
 *
 * Same shape as the PDF worker protocol (`lib/pdf/protocol.ts`): an operation
 * that is safe to structure-clone, a single outcome type, a transfer list for
 * the bytes going back, and `ToolErrorCode` on the failure branch. Nothing here
 * imports `fflate`, so the React layer can import these types (or the budget) at
 * no cost.
 *
 * Inputs are `Blob`s rather than `ArrayBuffer`s for the same reasons as PDF
 * inputs: a Blob crosses the worker boundary as a handle, the main thread never
 * allocates a copy just to hand it over, and the worker reads one entry at a
 * time. Results travel back as a transferred `ArrayBuffer`, so the worker drops
 * its copy instead of keeping a duplicate alive next to the main thread's.
 */
import type { ToolErrorCode } from '../files/errors';
import type { ZipEncryptionKind } from './encrypted';

export interface ZipSource {
  name: string;
  blob: Blob;
}

/**
 * A password crosses the worker boundary with the operation, which is why it is
 * part of the request rather than a module-level setting: no global can outlive
 * one archive and leak into the next.
 */
export interface ZipEncryptionRequest {
  kind: ZipEncryptionKind;
  password: string;
}

export type ZipOperation = {
  kind: 'create';
  entries: ZipSource[];
  /** Absent for an ordinary archive. */
  encryption?: ZipEncryptionRequest;
};

/**
 * Progress in *useful* units: how many entries are done and how many bytes have
 * been read. Deliberately not a byte-level tick — one event per file, plus one
 * per phase change, is enough for a bar and cheap enough to send.
 */
export interface ZipProgress {
  /** Entries whose bytes are in hand. */
  completed: number;
  total: number;
  /** Input bytes read so far. */
  inputBytes: number;
  /**
   * `compressing` while entries are being read, `finalising` while DEFLATE runs
   * over the whole archive. The last tenth of the ratio belongs to finalising.
   */
  phase: 'compressing' | 'finalising';
}

export interface ZipOutcome {
  /** The archive bytes. Ownership passes to the receiver. */
  archive: Uint8Array;
  entryCount: number;
  /** Sum of the bytes actually read from the inputs. */
  inputBytes: number;
}

/** Wire form — a transferable buffer rather than a view over one. */
export interface ZipWireOutcome {
  archive: ArrayBuffer;
  entryCount: number;
  inputBytes: number;
}

export type ZipWorkerRequest =
  | { type: 'run'; id: number; operation: ZipOperation }
  | { type: 'cancel'; id: number };

export type ZipWorkerResponse =
  | { type: 'progress'; id: number; progress: ZipProgress }
  | { type: 'done'; id: number; outcome: ZipWireOutcome }
  | { type: 'error'; id: number; code: ToolErrorCode; message: string; hint?: string };

/**
 * A view that exactly covers its buffer can be transferred for free; anything
 * else is sliced first, because a transfer list only accepts whole buffers.
 */
export function toTransferableBuffer(bytes: Uint8Array): ArrayBuffer {
  const { byteOffset, byteLength } = bytes;
  const buffer = bytes.buffer as ArrayBuffer;
  if (buffer instanceof ArrayBuffer && byteOffset === 0 && byteLength === buffer.byteLength) {
    return buffer;
  }
  return buffer.slice(byteOffset, byteOffset + byteLength);
}

export function encodeZipOutcome(outcome: ZipOutcome): { wire: ZipWireOutcome; transfer: ArrayBuffer[] } {
  const archive = toTransferableBuffer(outcome.archive);
  return {
    wire: { archive, entryCount: outcome.entryCount, inputBytes: outcome.inputBytes },
    transfer: [archive],
  };
}

export function decodeZipOutcome(wire: ZipWireOutcome): ZipOutcome {
  return {
    archive: new Uint8Array(wire.archive),
    entryCount: wire.entryCount,
    inputBytes: wire.inputBytes,
  };
}

/**
 * One ratio for a progress bar, derived from the file counter rather than from
 * bytes: "12 of 30 files, then the archive is written" is easier to trust than a
 * byte counter that jumps when one large file lands.
 */
export function zipProgressRatio(progress: ZipProgress): number {
  if (progress.phase === 'finalising') return 0.92;
  if (progress.total === 0) return 0;
  return Math.min(0.9, (progress.completed / progress.total) * 0.9);
}
