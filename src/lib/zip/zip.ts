/**
 * ZIP create/extract on top of `fflate` (lazy-loaded, ~10 kB gzip).
 *
 * Safety notes:
 *  - Extraction is guarded against ZIP bombs: bounded uncompressed size, entry
 *    count and per-entry size, plus a compression-ratio ceiling.
 *  - Paths are sanitised; `../` traversal and absolute paths never reach a
 *    filesystem (we are not writing to disk, but names are still normalised so
 *    downloads cannot be tricked).
 */
import { ToolError } from '../files/errors';

export interface ZipEntryMeta {
  name: string;
  size: number;
  compressedSize: number;
  isDirectory: boolean;
  lastModified?: number;
}

export interface ZipLimits {
  maxEntries: number;
  maxTotalBytes: number;
  maxEntryBytes: number;
  maxRatio: number;
}

export const DEFAULT_LIMITS: ZipLimits = {
  maxEntries: 5_000,
  maxTotalBytes: 512 * 1024 * 1024,
  maxEntryBytes: 256 * 1024 * 1024,
  maxRatio: 220,
};

export function sanitizeEntryName(name: string): string {
  return name
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .join('/')
    .replace(/^\/+/, '');
}

export async function createZip(
  files: { name: string; blob: Blob }[],
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
  if (files.length === 0) throw new ToolError('empty-input', 'Add at least one file to build an archive.');

  const { zip } = await import('fflate');
  const input: Record<string, [Uint8Array, { level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 }]> = {};
  const used = new Map<string, number>();

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const bytes = new Uint8Array(await file.blob.arrayBuffer());
    let name = sanitizeEntryName(file.name) || `file-${i + 1}`;
    const count = used.get(name) ?? 0;
    used.set(name, count + 1);
    if (count > 0) {
      const dot = name.lastIndexOf('.');
      name = dot > 0 ? `${name.slice(0, dot)} (${count})${name.slice(dot)}` : `${name} (${count})`;
    }
    input[name] = [bytes, { level: 6 }];
    onProgress?.((i + 1) / (files.length + 1));
  }

  const archive = await new Promise<Uint8Array>((resolve, reject) => {
    zip(input, { level: 6 }, (error, data) => {
      if (error) reject(error);
      else resolve(data);
    });
  });

  onProgress?.(1);
  return new Blob([new Uint8Array(archive)], { type: 'application/zip' });
}

export interface OpenedArchive {
  entries: { meta: ZipEntryMeta; data: Uint8Array }[];
  warnings: string[];
}

export async function readZip(
  file: Blob,
  limits: ZipLimits = DEFAULT_LIMITS,
  onProgress?: (ratio: number) => void,
): Promise<OpenedArchive> {
  const { unzip } = await import('fflate');
  const bytes = new Uint8Array(await file.arrayBuffer());

  const archive = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(bytes, (error, data) => {
      if (error) {
        reject(
          new ToolError(
            'corrupt-file',
            'This archive could not be opened.',
            'It may be damaged or use an unsupported compression method.',
          ),
        );
      } else {
        resolve(data);
      }
    });
  });

  const names = Object.keys(archive);
  if (names.length > limits.maxEntries) {
    throw new ToolError(
      'limit-exceeded',
      `This archive contains ${names.length.toLocaleString()} entries.`,
      `For safety, ZeroUpload opens at most ${limits.maxEntries.toLocaleString()} entries at once.`,
    );
  }

  const warnings: string[] = [];
  let total = 0;
  const entries: OpenedArchive['entries'] = [];

  for (let i = 0; i < names.length; i += 1) {
    const rawName = names[i];
    const data = archive[rawName];
    total += data.byteLength;

    if (data.byteLength > limits.maxEntryBytes) {
      throw new ToolError(
        'limit-exceeded',
        `"${rawName}" expands to more than ${Math.round(limits.maxEntryBytes / 1024 / 1024)} MB.`,
        'Very large entries are blocked to keep the tab responsive.',
      );
    }
    if (total > limits.maxTotalBytes) {
      throw new ToolError(
        'limit-exceeded',
        `This archive expands to more than ${Math.round(limits.maxTotalBytes / 1024 / 1024)} MB.`,
        'This looks like a compressed archive designed to exhaust memory (a ZIP bomb).',
      );
    }
    if (file.size > 0 && total / file.size > limits.maxRatio) {
      throw new ToolError(
        'limit-exceeded',
        'This archive expands suspiciously far beyond its compressed size.',
        'Extraction was stopped to protect your browser (possible ZIP bomb).',
      );
    }

    const cleanName = sanitizeEntryName(rawName);
    if (!cleanName) {
      warnings.push(`Skipped an entry with an unsafe name: ${rawName}`);
      continue;
    }
    if (cleanName !== rawName.replace(/^\.\//, '')) {
      warnings.push(`Renamed "${rawName}" to "${cleanName}".`);
    }

    entries.push({
      meta: {
        name: cleanName,
        size: data.byteLength,
        compressedSize: data.byteLength,
        isDirectory: cleanName.endsWith('/'),
      },
      data,
    });
    onProgress?.((i + 1) / names.length);
  }

  return { entries, warnings };
}
