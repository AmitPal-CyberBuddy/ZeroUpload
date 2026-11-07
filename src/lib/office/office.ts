/**
 * Office decryption — the library call, the format sniffing and the failure
 * messages, in one place so the worker and the main-thread fallback cannot drift
 * apart.
 *
 * `office-crypto` is a port of `msoffcrypto-tool`; it decrypts Agile and
 * Standard OOXML files and reports a wrong password as `InvalidKeyError`. Its
 * published build imports Node's `crypto`, which `vite.config.ts` aliases to
 * `./crypto-browser-shim.ts` — so this module works unchanged in a worker, on the
 * main thread, and under Node in the test suite.
 */
import { ToolError } from '../files/errors';
import { OFFICE_FORMATS, type OfficeFormat, type OfficeOutcome, type OfficeSource } from './protocol';

/** Encrypted OOXML is a Compound File Binary container, not a ZIP. */
const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

export interface OfficeInspection {
  /** Plain OOXML package (already decryptable by any unzip). */
  plain: boolean;
  /** CFB container: either encrypted OOXML or a legacy .doc/.xls/.ppt. */
  encryptedCandidate: boolean;
  /** From the file name, since the container does not say which Office app wrote it. */
  format: OfficeFormat | null;
}

export function formatFromName(name: string): OfficeFormat | null {
  const match = /\.(docx|xlsx|pptx)$/i.exec(name);
  return match ? (match[1].toLowerCase() as OfficeFormat) : null;
}

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((byte, index) => bytes[index] === byte);
}

/**
 * Reads eight bytes, so the check costs nothing on a 40 MB document.
 *
 * The name is a separate argument rather than `file.name` on purpose: a `Blob`
 * has no name, and spreading one into `{...blob, name}` silently produces a
 * plain object with no `slice()` — a trap worth designing out.
 */
export async function inspectOfficeFile(file: Blob, name = ''): Promise<OfficeInspection> {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  return {
    plain: startsWith(head, ZIP_MAGIC),
    encryptedCandidate: startsWith(head, CFB_MAGIC),
    format: formatFromName(name),
  };
}

/**
 * What kind of file this is, before any password is typed.
 *
 * The same reasoning as the PDF probe: there are two different situations behind
 * "it keeps asking for a password". One is a genuinely encrypted document; the
 * other is a plain .docx that Office opens freely, where the password prompt is
 * coming from something else entirely (a sensitivity label, a read-only
 * recommendation, or the wrong file). Asking for a password in both cases sends
 * people hunting for one that was never set.
 *
 * Deliberately shallow: eight bytes answered from `slice(0, 8)`, so this is
 * instant even for a 40 MB workbook. Distinguishing Agile from Standard needs the
 * `EncryptionInfo` stream, which means parsing the container — that costs a full
 * read and is not worth doing just to label a field the user has not filled in
 * yet. The decrypt step reports the same distinction when it matters.
 */
export type OfficeProbe = 'plain' | 'encrypted' | 'legacy' | 'unreadable';

export interface OfficeProbeResult {
  probe: OfficeProbe;
  format: OfficeFormat | null;
  /** Why the probe reached its verdict, in words the UI can show. */
  note: string;
}

const LEGACY_NAME = /\.(doc|xls|ppt)$/i;

export async function probeOfficeFile(file: Blob, name = ''): Promise<OfficeProbeResult> {
  const info = await inspectOfficeFile(file, name);

  if (info.plain) {
    return {
      probe: 'plain',
      format: info.format,
      note: 'This package is not encrypted. Any password prompt is coming from Office, not from the file.',
    };
  }

  if (LEGACY_NAME.test(name)) {
    return {
      probe: 'legacy',
      format: null,
      note: 'This is the 97–2003 binary format. This tool reads the OOXML container only.',
    };
  }

  if (info.encryptedCandidate) {
    return {
      probe: 'encrypted',
      format: info.format,
      note: 'A password-protected Office container. Enter the password you already use to open it.',
    };
  }

  return { probe: 'unreadable', format: info.format, note: 'This file is not an Office package.' };
}

export interface OfficeContext {
  onProgress?: (ratio: number) => void;
  isCancelled?: () => boolean;
}

export async function decryptOffice(
  source: OfficeSource,
  password: string,
  context: OfficeContext = {},
): Promise<OfficeOutcome> {
  if (source.blob.size === 0) {
    throw new ToolError('empty-input', `${source.name || 'This file'} is empty.`, 'Choose a file that has content.');
  }
  if (password.length === 0) {
    throw new ToolError('invalid-input', 'Enter the document password.', 'Office files need the password that was set on them.');
  }
  if (password.length > 255) {
    throw new ToolError('invalid-input', 'Office passwords are limited to 255 characters.');
  }

  const inspection = await inspectOfficeFile(source.blob, source.name);
  if (inspection.plain) {
    throw new ToolError(
      'invalid-input',
      'This document is not password protected.',
      'It is already a plain OOXML package — open it with Office, or extract it as a ZIP.',
    );
  }
  if (!inspection.encryptedCandidate) {
    throw new ToolError(
      'unsupported-type',
      'This is not a password-protected Office document.',
      'Supported: .docx, .xlsx and .pptx files that were encrypted with a password. Legacy .doc/.xls/.ppt files are a different format and are not supported.',
    );
  }
  if (!inspection.format) {
    throw new ToolError(
      'unsupported-type',
      'Only .docx, .xlsx and .pptx can be decrypted here.',
      'The file name must keep its Office extension: the container itself does not record which application wrote it.',
    );
  }

  context.onProgress?.(0.1);
  const bytes = new Uint8Array(await source.blob.arrayBuffer());

  const { OOXMLFile, isOleFile } = await import('office-crypto');
  if (!isOleFile(bytes)) {
    throw new ToolError('corrupt-file', 'This file is not a readable Office container.', 'It may be damaged.');
  }

  const file = new OOXMLFile(bytes);

  try {
    // The 100 000-round key derivation happens here: ~0.5 s of synchronous work
    // that must never run on the main thread, which is why this module is
    // reached through a worker.
    file.loadKey({ password });
    context.onProgress?.(0.6);
    const plain = file.decrypt();
    context.onProgress?.(1);

    if (!(plain.length > 4 && plain[0] === 0x50 && plain[1] === 0x4b)) {
      throw new ToolError(
        'corrupt-file',
        'The document was decrypted but the result is not a valid Office package.',
        'The file may be truncated, or encrypted with a scheme this build does not fully support.',
      );
    }

    return { bytes: plain, format: inspection.format };
  } catch (error) {
    if (error instanceof ToolError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (/invalid key|could not be decrypted|password/i.test(message)) {
      throw new ToolError(
        'encrypted',
        'That password did not open this document.',
        'Office passwords are case sensitive and are not recoverable — there is no reset outside the application that created the file.',
      );
    }
    throw new ToolError(
      'corrupt-file',
      'This document could not be decrypted.',
      'It may be damaged, or encrypted with a scheme this build does not read (for example an IRM or certificate-protected file).',
    );
  }
}

/**
 * Encrypts a plain OOXML package into the Agile container Office 2013+ writes.
 *
 * Kept behind the interoperability flag on purpose: the container, the key
 * derivation and the HMAC all verify against an independent implementation, but
 * "verified by a library" is not yet "opened by Word", and an encryption tool
 * that produces a document Word refuses is worse than no tool.
 */
export async function encryptOffice(
  source: OfficeSource,
  password: string,
  context: OfficeContext = {},
): Promise<OfficeOutcome> {
  if (source.blob.size === 0) {
    throw new ToolError('empty-input', `${source.name || 'This file'} is empty.`, 'Choose a file that has content.');
  }
  if (password.length === 0) {
    throw new ToolError('invalid-input', 'Set a password for this document.', 'Without one there is nothing to protect.');
  }
  if (password.length > 255) {
    throw new ToolError('invalid-input', 'Office passwords are limited to 255 characters.');
  }

  const inspection = await inspectOfficeFile(source.blob, source.name);
  if (!inspection.format) {
    throw new ToolError(
      'unsupported-type',
      'Only .docx, .xlsx and .pptx files can be encrypted here.',
      'Legacy .doc, .xls and .ppt files are a different format and are not supported.',
    );
  }
  if (inspection.encryptedCandidate) {
    throw new ToolError(
      'invalid-input',
      'This document is already password protected.',
      'Encrypting it again would nest one container inside another. Remove the existing password first.',
    );
  }
  if (!inspection.plain) {
    throw new ToolError(
      'unsupported-type',
      'This is not a modern Office document.',
      'Expect a .docx, .xlsx or .pptx package — those are ZIP archives with XML inside.',
    );
  }

  context.onProgress?.(0.05);
  const bytes = new Uint8Array(await source.blob.arrayBuffer());
  const { encryptOoxml } = await import('./agile');
  const container = await encryptOoxml(bytes, password);
  context.onProgress?.(1);
  return { bytes: container, format: inspection.format };
}

export { OFFICE_FORMATS };
