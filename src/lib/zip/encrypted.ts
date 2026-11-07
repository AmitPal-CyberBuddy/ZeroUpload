/**
 * Password-protected ZIPs.
 *
 * `fflate` — the DEFLATE engine the rest of the archive code uses — has no
 * encryption support at all, so AES archives need a second engine:
 * `@zip.js/zip.js` (BSD-3-Clause, ~70 kB gzipped, loaded only when a password is
 * actually used). This module is that engine, and nothing else.
 *
 * Measured before it was adopted (see `docs/v2-proofs.md`):
 *
 *  - AES-256 (WinZip AE-2) it writes is opened by pyzipper and by zip.js itself,
 *    and is **refused** by Python's stdlib `zipfile` and by Info-ZIP `unzip`,
 *    which is the same "unsupported compression method 99" outcome Windows
 *    Explorer and macOS Archive Utility produce. That is a property of AE-2, not
 *    a bug, and the UI says so before writing anything.
 *  - Peak memory is roughly 3.8× the input size: 50 MB of incompressible data
 *    cost +188 MB RSS. The budget for encrypted archives is therefore a quarter
 *    of the plain-ZIP budget, and is enforced from metadata before a byte is read.
 *
 * ZipCrypto is offered because it is the only format that opens everywhere, and
 * it is labelled as what it is: obfuscation with a known break, not protection.
 */
import { ToolError } from '../files/errors';
import { sanitizeEntryName } from './names';
import {
  MIN_AES_PASSWORD_LENGTH,
  MIN_ZIPCRYPTO_PASSWORD_LENGTH,
  type ZipEncryptionKind,
} from './inspect';
import type { ZipLimits } from './zip';

/*
 * The byte-level half of this feature — detecting encryption in the central
 * directory, the labels and the password minimums — lives in `inspect.ts` so the
 * extraction path can use it without dragging in zip.js. Re-exported here so
 * callers that already think of "ZIP encryption" as this module keep working.
 */
export {
  inspectZipEncryption,
  ZIP_ENCRYPTION_LABEL,
  MIN_AES_PASSWORD_LENGTH,
  MIN_ZIPCRYPTO_PASSWORD_LENGTH,
} from './inspect';
export type { ZipEncryptionKind, ZipEncryptionInfo } from './inspect';

export interface EncryptionOptions {
  password: string;
  kind: ZipEncryptionKind;
}

export interface EncryptedEntry {
  name: string;
  blob: Blob;
}

export interface EncryptedCreateContext {
  onProgress?: (ratio: number) => void;
  isCancelled?: () => boolean;
}

const assertPassword = (password: string, minimum: number, mode: ZipEncryptionKind) => {
  if (password.length < minimum) {
    throw new ToolError(
      'invalid-input',
      mode === 'aes-256'
        ? `Use at least ${minimum} characters for the archive password.`
        : `ZipCrypto needs at least ${minimum} characters.`,
      mode === 'aes-256'
        ? 'AES-256 is strong, but a three-character password is not. This is the only copy of the key.'
        : 'ZipCrypto is weak by design; a short password makes it weaker still.',
    );
  }
  if (password.length > 128) {
    throw new ToolError('invalid-input', 'Archive passwords are limited to 128 characters.', 'Some unzip tools truncate long passwords.');
  }
};

/**
 * Builds an encrypted archive from bytes already read by `create.ts`.
 *
 * Taking `Uint8Array`s rather than `Blob`s keeps one read path: the caller has
 * already applied the cumulative budget, sanitised every name and renamed
 * duplicates, so this function only encrypts what it is given.
 */
export async function buildEncryptedArchive(
  entries: readonly { name: string; bytes: Uint8Array }[],
  options: EncryptionOptions,
  context: EncryptedCreateContext = {},
): Promise<Uint8Array> {
  assertPassword(
    options.password,
    options.kind === 'aes-256' ? MIN_AES_PASSWORD_LENGTH : MIN_ZIPCRYPTO_PASSWORD_LENGTH,
    options.kind,
  );

  const { BlobReader, BlobWriter, ZipWriter } = await import('@zip.js/zip.js');
  const writer = new ZipWriter(new BlobWriter('application/zip'), {
    password: options.password,
    // 3 = AES-256. ZipCrypto is a different switch, and mixing the two in one
    // archive produces a file some readers cannot open at all.
    ...(options.kind === 'aes-256' ? { encryptionStrength: 3 } : { zipCrypto: true }),
  });

  try {
    for (let index = 0; index < entries.length; index += 1) {
      if (context.isCancelled?.()) {
        throw new ToolError('cancelled', 'Building the archive was cancelled.', 'The partial archive was discarded.');
      }
      const entry = entries[index];
      // Copy into a fresh buffer: zip.js may detach what it is handed, and the
      // caller's arrays are still referenced by the progress accounting.
      await writer.add(entry.name, new BlobReader(new Blob([new Uint8Array(entry.bytes)])));
      context.onProgress?.((index + 1) / entries.length);
    }
    const blob = await writer.close();
    return new Uint8Array(await blob.arrayBuffer());
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError(
      'unknown',
      'The browser could not build this encrypted archive.',
      error instanceof Error && error.message ? error.message : 'Try fewer or smaller files.',
    );
  }
}

export interface OpenedEncryptedArchive {
  entries: { name: string; size: number; data: Uint8Array }[];
  warnings: string[];
}

/**
 * Lists and decrypts an encrypted archive with the same rules as `readZip`:
 * limits are checked against the *declared* sizes before anything is
 * decompressed, names are sanitised, duplicates are skipped with a warning, and
 * the real byte counts are verified again afterwards.
 */
export async function readEncryptedZip(
  file: Blob,
  password: string,
  limits: ZipLimits,
  onProgress?: (ratio: number) => void,
): Promise<OpenedEncryptedArchive> {
  if (password.length === 0) {
    throw new ToolError('encrypted', 'This archive is password protected.', 'Enter the archive password to open it.');
  }

  const { BlobReader, BlobWriter, ZipReader } = await import('@zip.js/zip.js');
  const reader = new ZipReader(new BlobReader(file), { password });

  try {
    const entries = await reader.getEntries();

    if (entries.length > limits.maxEntries) {
      throw new ToolError(
        'limit-exceeded',
        `This archive contains ${entries.length.toLocaleString()} entries; the limit is ${limits.maxEntries.toLocaleString()}.`,
        'Nothing was decompressed.',
      );
    }

    let declared = 0;
    for (const entry of entries) {
      if (entry.directory) continue;
      const size = entry.uncompressedSize ?? 0;
      if (size > limits.maxEntryBytes) {
        throw new ToolError(
          'limit-exceeded',
          `"${sanitizeEntryName(entry.filename) || entry.filename}" would expand to ${(size / 1024 / 1024).toFixed(0)} MB.`,
          `Single entries are limited to ${Math.round(limits.maxEntryBytes / 1024 / 1024)} MB.`,
        );
      }
      declared += size;
      if (declared > limits.maxTotalBytes) {
        throw new ToolError(
          'limit-exceeded',
          `This archive expands to more than ${Math.round(limits.maxTotalBytes / 1024 / 1024)} MB.`,
          'It was refused before decompression — this is what a ZIP bomb looks like.',
        );
      }
    }

    const opened: OpenedEncryptedArchive['entries'] = [];
    const warnings: string[] = [];
    const used = new Set<string>();
    let total = 0;

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (entry.directory) continue;

      const clean = sanitizeEntryName(entry.filename);
      if (!clean) {
        warnings.push(`Skipped an entry with an unsafe name: ${entry.filename}`);
        continue;
      }
      if (used.has(clean)) {
        warnings.push(`Duplicate entry name: ${clean}`);
        continue;
      }
      used.add(clean);
      if (clean !== entry.filename.replace(/^\.\//, '')) {
        warnings.push(`Renamed "${entry.filename}" to "${clean}".`);
      }

      // `getData` rejects on a wrong password: zip.js verifies the AE-2
      // authentication code, so a corrupt file is caught here too.
      const blob = await entry.getData!(new BlobWriter());
      const data = new Uint8Array(await blob.arrayBuffer());
      total += data.byteLength;
      if (data.byteLength > limits.maxEntryBytes || total > limits.maxTotalBytes) {
        throw new ToolError(
          'limit-exceeded',
          'The archive claims to be smaller than it really is.',
          'Extraction was aborted and the output discarded.',
        );
      }

      opened.push({ name: clean, size: data.byteLength, data });
      onProgress?.((index + 1) / Math.max(1, entries.length));
    }

    return { entries: opened, warnings };
  } catch (error) {
    if (error instanceof ToolError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (/password/i.test(message)) {
      throw new ToolError(
        'encrypted',
        'That password did not open this archive.',
        'AES and ZipCrypto archives both reject a wrong password outright — there is nothing to recover from a near miss.',
      );
    }
    throw new ToolError(
      'corrupt-file',
      'This archive could not be opened.',
      'It may be damaged, or it may use an encryption variant this build does not read.',
    );
  } finally {
    await reader.close().catch(() => undefined);
  }
}
