/**
 * ZIP create/extract on top of `fflate` (lazy-loaded, ~10 kB gzip).
 *
 * Creation runs in a worker (`zip.worker.ts` behind `client.ts`); extraction runs
 * here. Both share one implementation of every guard: `create.ts` owns archive
 * creation and the naming/budget rules, this file owns the public API, the
 * inspection pass and the extraction budget.
 *
 * Safety model — read before changing:
 *
 *  fflate's `unzip` inflates every entry it accepts, so a size check performed
 *  after decompression is not a guard at all: by the time it fires, a 300 KB ZIP
 *  bomb has already allocated 300 MB in the tab. Extraction therefore runs in two
 *  phases:
 *
 *    1. `inspectZip` walks the archive with a filter that always returns false,
 *       collecting the *declared* sizes from the central directory. Nothing is
 *       inflated. Limits are enforced here, before any allocation.
 *    2. `unzip` runs with a filter that re-applies the budget per entry, and the
 *       real byte counts are verified again afterwards (defence in depth).
 *
 *  fflate allocates exactly the declared uncompressed size for each entry, so an
 *  archive that lies about its sizes cannot inflate past its declaration — it
 *  fails instead. That is why declared sizes are a sound basis for the budget.
 *
 *  There is deliberately **no compression-ratio heuristic**: real archives of
 *  text, logs or JSON legitimately compress 300–500×, and rejecting them is worse
 *  than the protection it pretends to offer. Absolute ceilings are deterministic.
 */
import { ToolError } from '../files/errors';
import { OPERATION_BUDGETS } from '../files/budget';
import { sanitizeEntryName } from './names';
import { inspectZipEncryption, type ZipEncryptionKind } from './encrypted';

export interface ZipEntryMeta {
  name: string;
  /** Uncompressed size declared in the central directory. */
  size: number;
  /** Compressed size declared in the central directory. */
  compressedSize: number;
  compression: number;
  isDirectory: boolean;
}

export interface ZipLimits {
  maxEntries: number;
  /** Total uncompressed budget for the whole archive. */
  maxTotalBytes: number;
  maxEntryBytes: number;
}

export const DEFAULT_LIMITS: ZipLimits = {
  maxEntries: 5_000,
  maxTotalBytes: 512 * 1024 * 1024,
  maxEntryBytes: 256 * 1024 * 1024,
};

/**
 * Creating an archive holds every input in memory at once, so the total is
 * capped too. The numbers live with the other multi-input budgets so the PDF
 * tools and the archive tool speak the same vocabulary.
 */
export const CREATE_BUDGET = OPERATION_BUDGETS.zipCreate;

/**
 * Re-exported for callers and tests. The implementation lives in `names.ts`
 * because archive creation needs it inside the worker too, and two copies of a
 * sanitiser is exactly how a traversal bug gets reintroduced.
 */
export { sanitizeEntryName };
export { ZIP_ENCRYPTION_LABEL, MIN_AES_PASSWORD_LENGTH } from './encrypted';
export { inspectZipEncryption };
export type { ZipEncryptionKind, ZipEncryptionInfo } from './encrypted';

interface RawEntryInfo {
  name: string;
  size: number;
  originalSize: number;
  compression: number;
}

/**
 * Phase 1 — metadata only. Returns the central-directory listing without
 * inflating a single byte, then enforces the budget.
 */
export async function inspectZip(bytes: Uint8Array, limits: ZipLimits = DEFAULT_LIMITS): Promise<ZipEntryMeta[]> {
  const { unzip } = await import('fflate');

  const entries: ZipEntryMeta[] = [];
  let total = 0;

  await new Promise<void>((resolve, reject) => {
    unzip(
      bytes,
      {
        filter: (file: RawEntryInfo) => {
          const cleanName = sanitizeEntryName(file.name);
          const size = file.originalSize ?? 0;

          if (entries.length + 1 > limits.maxEntries) {
            reject(
              new ToolError(
                'limit-exceeded',
                `This archive contains more than ${limits.maxEntries.toLocaleString()} entries.`,
                'Extraction was stopped before anything was decompressed.',
              ),
            );
            return false;
          }

          total += size;
          if (size > limits.maxEntryBytes) {
            reject(
              new ToolError(
                'limit-exceeded',
                `"${cleanName || file.name}" would expand to ${(size / 1024 / 1024).toFixed(0)} MB.`,
                `Single entries are limited to ${Math.round(limits.maxEntryBytes / 1024 / 1024)} MB.`,
              ),
            );
            return false;
          }
          if (total > limits.maxTotalBytes) {
            reject(
              new ToolError(
                'limit-exceeded',
                `This archive expands to more than ${Math.round(limits.maxTotalBytes / 1024 / 1024)} MB.`,
                'It was refused before decompression — this is what a ZIP bomb looks like.',
              ),
            );
            return false;
          }

          entries.push({
            name: file.name,
            size,
            compressedSize: file.size ?? 0,
            compression: file.compression ?? 0,
            isDirectory: file.name.endsWith('/'),
          });
          // Skip decompression; we only want the listing in this pass.
          return false;
        },
      },
      (error) => {
        if (error) {
          reject(
            new ToolError(
              'corrupt-file',
              'This archive could not be read.',
              'It may be damaged or use an unsupported compression method.',
            ),
          );
        } else {
          resolve();
        }
      },
    );
  });

  return entries;
}

export interface OpenedArchive {
  entries: { meta: ZipEntryMeta; data: Uint8Array }[];
  warnings: string[];
}

/**
 * Phase 2 — validated extraction. The budget is applied again per entry so a
 * corrupted or crafted central directory cannot slip past phase 1.
 */
export async function readZip(
  file: Blob,
  limits: ZipLimits = DEFAULT_LIMITS,
  onProgress?: (ratio: number) => void,
  password?: string,
): Promise<OpenedArchive> {
  const bytes = new Uint8Array(await file.arrayBuffer());

  /*
   * Encrypted archives cannot go through fflate at all — AES entries use
   * compression method 99, which it reports as "unsupported". The central
   * directory says which kind it is before anything is inflated, so the routing
   * decision is made from metadata and the password prompt is a real prompt
   * rather than a parse failure the user has to interpret.
   */
  const encryption = inspectZipEncryption(bytes);
  if (encryption.kind) {
    if (!password) {
      throw new ToolError(
        'encrypted',
        `This archive is protected with ${encryption.kind === 'aes-256' ? 'AES-256' : 'ZipCrypto'}.`,
        'Enter the archive password to list and extract its contents. Nothing is sent anywhere — the password stays in this tab.',
      );
    }
    const { readEncryptedZip } = await import('./encrypted');
    const opened = await readEncryptedZip(file, password, limits, onProgress);
    return {
      entries: opened.entries.map((entry) => ({
        meta: {
          name: entry.name,
          size: entry.size,
          compressedSize: entry.size,
          compression: encryption.kind === 'aes-256' ? 99 : 8,
          isDirectory: entry.name.endsWith('/'),
        },
        data: entry.data,
      })),
      warnings: opened.warnings,
    };
  }

  const { unzip } = await import('fflate');
  const manifest = await inspectZip(bytes, limits);

  let budget = limits.maxTotalBytes;
  const warnings: string[] = [];
  const names = new Set<string>();
  /** fflate keys its result by the *original* entry name, so keep the mapping. */
  const renamed = new Map<string, string>();

  const archive = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    let failure: ToolError | null = null;
    unzip(
      bytes,
      {
        filter: (entry: RawEntryInfo) => {
          if (failure) return false;

          const declared = entry.originalSize ?? 0;
          if (declared > limits.maxEntryBytes) {
            failure = new ToolError('limit-exceeded', `"${entry.name}" exceeds the per-entry limit.`);
            return false;
          }
          if (declared > budget) {
            failure = new ToolError(
              'limit-exceeded',
              'This archive expands beyond the extraction budget.',
              'Extraction stopped partway through; nothing beyond the budget was allocated.',
            );
            return false;
          }

          const cleanName = sanitizeEntryName(entry.name);
          if (!cleanName) {
            warnings.push(`Skipped an entry with an unsafe name: ${entry.name}`);
            return false;
          }
          if (names.has(cleanName)) {
            warnings.push(`Duplicate entry name: ${cleanName}`);
            return false;
          }
          if (cleanName !== entry.name.replace(/^\.\//, '')) {
            warnings.push(`Renamed "${entry.name}" to "${cleanName}".`);
          }
          names.add(cleanName);
          renamed.set(entry.name, cleanName);
          budget -= declared;
          return true;
        },
      },
      (error, data) => {
        if (failure) reject(failure);
        else if (error) {
          reject(
            new ToolError(
              'corrupt-file',
              'This archive could not be opened.',
              'It may be damaged or use an unsupported compression method.',
            ),
          );
        } else resolve(data);
      },
    );
  });

  const byOriginal = new Map(manifest.map((meta) => [meta.name, meta]));
  let total = 0;
  const entries: OpenedArchive['entries'] = [];
  const originals = Object.keys(archive);

  for (let index = 0; index < originals.length; index += 1) {
    const original = originals[index];
    const data = archive[original];
    const declaredMeta = byOriginal.get(original);
    const cleanName = renamed.get(original) ?? sanitizeEntryName(original);
    if (!cleanName) continue;

    total += data.byteLength;
    // Phase 1 trusted the declared sizes; verify the real ones too.
    if (data.byteLength > limits.maxEntryBytes || total > limits.maxTotalBytes) {
      throw new ToolError(
        'limit-exceeded',
        'The archive claims to be smaller than it really is.',
        'Extraction was aborted and the output discarded.',
      );
    }

    entries.push({
      meta: {
        name: cleanName,
        size: data.byteLength,
        compressedSize: declaredMeta?.compressedSize ?? data.byteLength,
        compression: declaredMeta?.compression ?? 0,
        isDirectory: cleanName.endsWith('/'),
      },
      data,
    });
    onProgress?.((index + 1) / Math.max(1, originals.length));
  }

  return { entries, warnings };
}

/**
 * Creates a ZIP, enforcing a cumulative input budget **before reading a byte**.
 *
 * The budget is computed from `Blob.size`, which is metadata: no `arrayBuffer()`
 * call, no `Uint8Array`, no assembly happens until the decision is made. Sizes
 * are re-checked while streaming in (a `Blob` cannot lie about `.size`, but a
 * derived blob or a future `ReadableStream` input might).
 *
 * The work happens in a dedicated worker, so a 30-file batch packaging does not
 * freeze the interface; `client.ts` falls back to this same implementation on the
 * main thread when a worker cannot be created. Callers cannot tell the
 * difference, which is the point.
 */
export async function createZip(
  files: readonly { name: string; blob: Blob }[],
  options: {
    onProgress?: (ratio: number) => void;
    signal?: AbortSignal;
    /** Omit for a plain archive. Setting it switches engine and budget. */
    password?: string;
    /** Defaults to AES-256; ZipCrypto must be asked for explicitly. */
    encryption?: ZipEncryptionKind;
  } = {},
): Promise<Blob> {
  // Loaded lazily so the client (and its worker URL) is only fetched on use.
  const { runZipOperation } = await import('./client');
  const outcome = await runZipOperation(
    {
      kind: 'create',
      entries: files.map((file) => ({ name: file.name, blob: file.blob })),
      ...(options.password
        ? { encryption: { kind: options.encryption ?? 'aes-256', password: options.password } }
        : {}),
    },
    { onProgress: options.onProgress, signal: options.signal },
  );

  // `Blob` copies the view's bytes, so no defensive array copy is needed here.
  return new Blob([outcome.archive as BlobPart], { type: 'application/zip' });
}
