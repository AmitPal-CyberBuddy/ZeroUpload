import { describe, expect, it } from 'vitest';
import {
  CREATE_BUDGET,
  DEFAULT_LIMITS,
  createZip,
  inspectZip,
  readZip,
  sanitizeEntryName,
} from '../src/lib/zip/zip';
import { ToolError } from '../src/lib/files/errors';
import { MB, blobOf, bytes, makeZip, makeZipWithDuplicateName, unreadableBlob } from './helpers';

const code = (error: unknown) => (error as ToolError).code;

describe('sanitizeEntryName', () => {
  it('strips traversal segments', () => {
    expect(sanitizeEntryName('../../etc/passwd')).toBe('etc/passwd');
    expect(sanitizeEntryName('a/../../../b.txt')).toBe('a/b.txt');
    expect(sanitizeEntryName('./folder/file.txt')).toBe('folder/file.txt');
  });

  it('normalises Windows separators and drops the drive prefix', () => {
    expect(sanitizeEntryName('C:\\Users\\me\\file.txt')).toBe('Users/me/file.txt');
    expect(sanitizeEntryName('D:/data/file.txt')).toBe('data/file.txt');
  });

  it('collapses absolute and empty names', () => {
    expect(sanitizeEntryName('/etc/passwd')).toBe('etc/passwd');
    expect(sanitizeEntryName('////')).toBe('');
    expect(sanitizeEntryName('..')).toBe('');
    expect(sanitizeEntryName('')).toBe('');
  });

  it('keeps legitimate dotfiles', () => {
    expect(sanitizeEntryName('.env')).toBe('.env');
    expect(sanitizeEntryName('config/.gitignore')).toBe('config/.gitignore');
  });
});

describe('inspectZip — budgets are enforced before inflation', () => {
  const entries: [string, Uint8Array][] = [
    ['a.bin', new Uint8Array(400)],
    ['b.bin', new Uint8Array(400)],
  ];

  it('accepts an archive inside the budget', async () => {
    const meta = await inspectZip(makeZip(entries), { maxEntries: 10, maxTotalBytes: 1000, maxEntryBytes: 500 });
    expect(meta.map((entry) => entry.name)).toEqual(['a.bin', 'b.bin']);
    expect(meta[0].size).toBe(400);
  });

  it('rejects a total that exceeds the cumulative budget', async () => {
    await expect(
      inspectZip(makeZip(entries), { maxEntries: 10, maxTotalBytes: 500, maxEntryBytes: 500 }),
    ).rejects.toSatisfy((error) => code(error) === 'limit-exceeded');
  });

  it('rejects a single entry above the per-entry ceiling', async () => {
    const error = await inspectZip(makeZip([['big.bin', new Uint8Array(900)]]), {
      maxEntries: 10,
      maxTotalBytes: 1000,
      maxEntryBytes: 500,
    }).catch((err: unknown) => err);
    expect(code(error)).toBe('limit-exceeded');
    expect((error as ToolError).message).toContain('big.bin');
  });

  it('rejects too many entries', async () => {
    const many: [string, Uint8Array][] = Array.from({ length: 12 }, (_, i) => [`f${i}.txt`, new Uint8Array(1)]);
    await expect(inspectZip(makeZip(many), { maxEntries: 10, maxTotalBytes: 1e6, maxEntryBytes: 1e6 })).rejects.toThrow(
      /more than 10 entries/,
    );
  });

  it('does not use a compression-ratio heuristic', async () => {
    // 4 MB of zeros compresses to a few KB — a ~1000× ratio. Real text archives
    // look like this, so it must be accepted, not treated as a bomb.
    const zeros = new Uint8Array(4 * MB);
    const archive = makeZip([['log.txt', zeros]], 6);
    expect(zeros.byteLength / archive.byteLength).toBeGreaterThan(100);
    const meta = await inspectZip(archive);
    expect(meta[0].size).toBe(4 * MB);
  });

  it('reports a corrupt archive as corrupt, not as a budget failure', async () => {
    await expect(inspectZip(new Uint8Array([1, 2, 3, 4, 5]))).rejects.toSatisfy(
      (error) => code(error) === 'corrupt-file',
    );
  });
});

describe('readZip — extraction safety', () => {
  it('sanitises traversal names and warns', async () => {
    const archive = makeZip([
      ['../../evil.txt', new Uint8Array([1, 2, 3])],
      ['keep/me.txt', new Uint8Array([4, 5])],
    ]);
    const opened = await readZip(blobOf(archive));
    const names = opened.entries.map((entry) => entry.meta.name);
    expect(names).toEqual(['evil.txt', 'keep/me.txt']);
    expect(names.some((name) => name.includes('..'))).toBe(false);
    expect(opened.warnings.join(' ')).toMatch(/Renamed "\.\.\/\.\.\/evil\.txt"/);
    expect([...opened.entries[0].data]).toEqual([1, 2, 3]);
  });

  it('drops duplicate names instead of overwriting silently', async () => {
    const archive = makeZipWithDuplicateName('dup.txt', ['one', 'two']);
    const opened = await readZip(blobOf(archive));
    expect(opened.entries).toHaveLength(1);
    expect(opened.warnings.join(' ')).toMatch(/duplicate/i);
  });

  it('enforces the budget when the caller tightens it', async () => {
    const archive = makeZip([
      ['a.bin', new Uint8Array(300)],
      ['b.bin', new Uint8Array(300)],
    ]);
    await expect(
      readZip(blobOf(archive), { maxEntries: 10, maxTotalBytes: 400, maxEntryBytes: 350 }),
    ).rejects.toSatisfy((error) => code(error) === 'limit-exceeded');
  });

  it('exposes default limits that match the documented numbers', () => {
    expect(DEFAULT_LIMITS.maxEntries).toBe(5_000);
    expect(DEFAULT_LIMITS.maxTotalBytes).toBe(512 * MB);
    expect(DEFAULT_LIMITS.maxEntryBytes).toBe(256 * MB);
  });

  it('reports progress as entries are produced', async () => {
    const archive = makeZip(Array.from({ length: 4 }, (_, i) => [`f${i}.txt`, new Uint8Array([i])]));
    const seen: number[] = [];
    await readZip(blobOf(archive), DEFAULT_LIMITS, (ratio) => seen.push(ratio));
    expect(seen).toHaveLength(4);
    expect(seen.at(-1)).toBe(1);
  });
});

describe('createZip — cumulative budget, before any allocation', () => {
  it('rejects an oversized total without reading a single byte', async () => {
    const first = unreadableBlob(300 * MB);
    const second = unreadableBlob(300 * MB);
    const error = await createZip([
      { name: 'a.bin', blob: first },
      { name: 'b.bin', blob: second },
    ]).catch((err: unknown) => err);

    expect(code(error)).toBe('limit-exceeded');
    expect((error as ToolError).message).toMatch(/total 600 MB together/);
    expect(first.reads).toBe(0);
    expect(second.reads).toBe(0);
  });

  it('rejects too many files', async () => {
    const files = Array.from({ length: CREATE_BUDGET.maxItems! + 1 }, (_, i) => ({
      name: `f${i}.txt`,
      blob: unreadableBlob(1),
    }));
    // Locale-independent: the message uses the runtime's number formatting.
    await expect(createZip(files)).rejects.toThrow(/at most 2.?000 files/);
    expect(files.every((file) => (file.blob as unknown as { reads: number }).reads === 0)).toBe(true);
  });

  it('rejects an empty list', async () => {
    await expect(createZip([])).rejects.toSatisfy((error) => code(error) === 'empty-input');
  });

  it('produces an archive that reads back with the same bytes', async () => {
    const payload = bytes(64, 7);
    const blob = await createZip([{ name: 'note.txt', blob: blobOf(payload) }]);
    const opened = await readZip(blob);
    expect(opened.entries).toHaveLength(1);
    expect([...opened.entries[0].data]).toEqual([...payload]);
  });

  it('disambiguates duplicate names and unsafe names', async () => {
    const blob = await createZip([
      { name: 'same.txt', blob: new Blob(['one']) },
      { name: 'same.txt', blob: new Blob(['two']) },
      { name: '../../escape.txt', blob: new Blob(['three']) },
    ]);
    const opened = await readZip(blob);
    const names = opened.entries.map((entry) => entry.meta.name).sort();
    expect(names).toEqual(['escape.txt', 'same (1).txt', 'same.txt']);
  });
});
