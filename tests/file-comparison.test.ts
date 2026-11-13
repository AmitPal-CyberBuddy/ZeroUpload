import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { compareFiles } from '../src/lib/inspect/compare';
const blob = (s: string) => new Blob([s]);
const digest = (s: string) => createHash('sha256').update(s).digest('hex');

describe('two file comparison', () => {
  it('matches exact bytes across chunk boundaries and computes standard SHA-256', async () => {
    const result = await compareFiles(blob('same content'), blob('same content'), { chunkSize: 3 });
    expect(result).toEqual({ identical: true, firstDifference: null, firstHash: digest('same content'), secondHash: digest('same content') });
  });
  it('detects same-length modifications and different sizes, hashing both fully', async () => {
    for (const [a,b] of [['abcd','abXd'], ['longer','short'], ['x',''], ['', 'x']]) {
      const result = await compareFiles(blob(a), blob(b), { chunkSize: 2 });
      expect(result.identical).toBe(false);
      expect(result.firstHash).toBe(digest(a)); expect(result.secondHash).toBe(digest(b));
    }
    expect((await compareFiles(blob('abcd'), blob('abXd'), { chunkSize: 2 })).firstDifference).toBe(2);
    expect((await compareFiles(blob('abc'), blob('abcde'), { chunkSize: 2 })).firstDifference).toBe(3);
  });
  it('supports empty blobs, progress and cancellation', async () => {
    expect((await compareFiles(blob(''), blob(''))).identical).toBe(true);
    const controller = new AbortController(); const progress: number[] = [];
    await expect(compareFiles(blob('abcdefgh'), blob('abcdefgh'), { chunkSize: 2, signal: controller.signal, onProgress: n => { progress.push(n); controller.abort(); } })).rejects.toMatchObject({code: 'cancelled'});
    expect(progress).toEqual([0.25]);
  });
  it('refuses invalid or excessive chunks and oversized files before reading', async () => {
    await expect(compareFiles(blob('a'), blob('b'), {chunkSize: 0})).rejects.toThrow();
    const tooBig = { size: 512 * 1024 * 1024 + 1 } as Blob;
    await expect(compareFiles(tooBig, blob('x'))).rejects.toMatchObject({code: 'too-large'});
  });
});
