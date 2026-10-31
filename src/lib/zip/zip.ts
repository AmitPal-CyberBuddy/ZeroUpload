/**
 * ZIP create/extract on top of `fflate` (lazy-loaded, ~10 kB gzip).
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
import { OPERATION_BUDGETS, assertCumulativeBudget } from '../files/budget';

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

export function sanitizeEntryName(name: string): string {
  return name
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .join('/')
    // Strip a Windows drive prefix ("C:") — the colon is invalid on Windows and
    // pointless in a download name.
    .replace(/^[A-Za-z]:\/?/, '')
    .replace(/^\/+/, '');
}

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
): Promise<OpenedArchive> {
  const { unzip } = await import('fflate');
  const bytes = new Uint8Array(await file.arrayBuffer());

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
 */
export async function createZip(
  files: { name: string; blob: Blob }[],
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
  if (files.length === 0) {
    throw new ToolError('empty-input', 'Add at least one file to build an archive.');
  }
  // Metadata only — nothing has been allocated at this point.
  assertCumulativeBudget(
    files.map((file) => ({ name: file.name, size: file.blob.size })),
    CREATE_BUDGET,
  );

  const { zip } = await import('fflate');
  const input: Record<string, [Uint8Array, { level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 }]> = {};
  const used = new Map<string, number>();
  let read = 0;

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const bytes = new Uint8Array(await file.blob.arrayBuffer());
    read += bytes.byteLength;
    if (read > CREATE_BUDGET.maxBytes) {
      // Cannot happen with honest `Blob.size`, so reaching this means the
      // inputs changed under us. Refuse rather than finish the allocation.
      throw new ToolError(
        'limit-exceeded',
        'These files are larger than their reported sizes.',
        CREATE_BUDGET.hint,
      );
    }

    let name = sanitizeEntryName(file.name) || `file-${i + 1}`;
    const count = used.get(name) ?? 0;
    used.set(name, count + 1);
    if (count > 0) {
      const dot = name.lastIndexOf('.');
      name = dot > 0 ? `${name.slice(0, dot)} (${count})${name.slice(dot)}` : `${name} (${count})`;
    }
    input[name] = [bytes, { level: 6 }];
    onProgress?.(((i + 1) / (files.length + 1)) * 0.9);
  }

  const archive = await new Promise<Uint8Array>((resolve, reject) => {
    zip(input, { level: 6 }, (error, data) => {
      if (error) {
        reject(
          new ToolError(
            'unknown',
            'The browser could not build this archive.',
            'Try fewer or smaller files.',
          ),
        );
      } else resolve(data);
    });
  });

  onProgress?.(1);
  // `Blob` copies the view's bytes, so no defensive array copy is needed here.
  return new Blob([archive as BlobPart], { type: 'application/zip' });
}
