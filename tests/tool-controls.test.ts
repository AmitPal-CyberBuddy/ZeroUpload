import { describe, expect, it, vi } from 'vitest';
import { checkDigest } from '../src/lib/hash/hash';
import { decodeBase64Bytes, looksLikeText, offsetForLineColumn } from '../src/lib/dev/text';
import type { ImageJobResult } from '../src/lib/image/types';

/**
 * Controls that belong to one tool, checked where they can be checked without a
 * browser: the logic they depend on.
 *
 * Each of these exists because the tool's actual job was not the one its UI
 * implied — a hash tool you could only feed text, a compressor that asked for a
 * quality number instead of the file size people actually have to hit, a JSON
 * error reported as a line number the reader still had to go and find.
 */

describe('checksum verification', () => {
  const digest = 'a'.repeat(64);

  it('accepts the shapes published checksums arrive in', () => {
    expect(checkDigest(digest, digest, 'SHA-256').match).toBe(true);
    expect(checkDigest(digest.toUpperCase(), digest, 'SHA-256').match).toBe(true);
    expect(checkDigest(`  ${digest}  `, digest, 'SHA-256').match).toBe(true);
    expect(checkDigest(`sha256:${digest}`, digest, 'SHA-256').match).toBe(true);
    expect(checkDigest(`SHA256 (file.iso) = ${digest}`, digest, 'SHA-256').match).toBe(true);
    expect(checkDigest(`sha256sum: ${digest}`, digest, 'SHA-256').match).toBe(true);
    // Spaced in groups of eight, as many release pages print it.
    expect(checkDigest(digest.match(/.{8}/g)!.join(' '), digest, 'SHA-256').match).toBe(true);
    expect(checkDigest(`\\${digest}`, digest, 'SHA-256').match).toBe(true);
  });

  it('reports a genuinely different digest as a mismatch', () => {
    expect(checkDigest('b'.repeat(64), digest, 'SHA-256')).toMatchObject({ match: false });
  });

  it('distinguishes "not a digest" from "does not match"', () => {
    // A wrong-length or non-hex value is a paste problem, not a corrupted download;
    // calling it a mismatch sends someone hunting for the wrong bug.
    expect(checkDigest('hello world', digest, 'SHA-256').problem).toBe('not-hex');
    // Right alphabet, wrong length — almost always a truncated paste.
    expect(checkDigest('a'.repeat(40), digest, 'SHA-256').problem).toBe('wrong-length');
    expect(checkDigest('', digest, 'SHA-256').problem).toBe('empty');
  });

  it('knows the length each algorithm produces', () => {
    expect(checkDigest('a'.repeat(40), 'a'.repeat(40), 'SHA-1').match).toBe(true);
    expect(checkDigest('a'.repeat(64), 'a'.repeat(64), 'SHA-1').problem).toBe('wrong-length');
    expect(checkDigest('a'.repeat(128), 'a'.repeat(128), 'SHA-512').match).toBe(true);
  });
});

describe('target-size compression', () => {
  /** A fake encoder whose size falls with quality, as a real one does. */
  const fakeProcess = (sizes: (quality: number) => number) =>
    vi.fn(async (job: { quality?: number }): Promise<ImageJobResult> => {
      const quality = job.quality ?? 0.8;
      return {
        blob: { size: sizes(quality) } as Blob,
        width: 100,
        height: 100,
        durationMs: 1,
        format: 'image/webp',
      };
    });

  it('lands under the target when the target is reachable', async () => {
    vi.resetModules();
    vi.doMock('../src/lib/image/processor', () => ({
      processImage: fakeProcess((quality) => Math.round(2_000_000 * quality * quality)),
    }));
    const { compressToTarget: search } = await import('../src/lib/image/targetSize');
    const found = await search({ format: 'image/webp', quality: 0.8 }, new Blob(), { targetBytes: 500_000 });

    expect(found.met).toBe(true);
    expect(found.result.blob.size).toBeLessThanOrEqual(500_000);
    expect(found.quality).toBeGreaterThanOrEqual(20);
    expect(found.quality).toBeLessThanOrEqual(95);
    vi.doUnmock('../src/lib/image/processor');
  });

  it('returns the smallest it found when the target is impossible', async () => {
    vi.resetModules();
    vi.doMock('../src/lib/image/processor', () => ({
      processImage: fakeProcess((quality) => Math.round(2_000_000 * quality * quality)),
    }));
    const { compressToTarget: search } = await import('../src/lib/image/targetSize');
    // Even 20% quality is ~80 kB in this model, so 1 kB cannot be reached.
    const found = await search({ format: 'image/webp', quality: 0.8 }, new Blob(), { targetBytes: 1_000 });

    expect(found.met).toBe(false);
    // The alternative — throwing — would leave the user with nothing.
    expect(found.result.blob.size).toBeGreaterThan(0);
    vi.doUnmock('../src/lib/image/processor');
  });

  it('stops probing when the run is cancelled', async () => {
    vi.resetModules();
    vi.doMock('../src/lib/image/processor', () => ({
      processImage: fakeProcess((quality) => Math.round(2_000_000 * quality * quality)),
    }));
    const { compressToTarget: search } = await import('../src/lib/image/targetSize');
    await expect(
      search({ format: 'image/webp', quality: 0.8 }, new Blob(), {
        targetBytes: 500_000,
        shouldAbort: () => true,
      }),
    ).rejects.toThrow(/cancel/i);
    vi.doUnmock('../src/lib/image/processor');
  });

  it('caps the number of encodes', async () => {
    // Each probe is a full encode of the user's file; an unbounded search would be
    // a hot CPU for no better answer.
    const encode = fakeProcess((quality) => Math.round(2_000_000 * quality * quality));
    vi.resetModules();
    vi.doMock('../src/lib/image/processor', () => ({ processImage: encode }));
    const { compressToTarget: search } = await import('../src/lib/image/targetSize');
    await search({ format: 'image/webp', quality: 0.8 }, new Blob(), { targetBytes: 400_000 });
    expect(encode.mock.calls.length).toBeLessThanOrEqual(8);
    vi.doUnmock('../src/lib/image/processor');
  });

  it('actually narrows towards the best fit rather than guessing once', async () => {
    const encode = fakeProcess((quality) => Math.round(1_000_000 * quality));
    vi.resetModules();
    vi.doMock('../src/lib/image/processor', () => ({ processImage: encode }));
    const { compressToTarget: search } = await import('../src/lib/image/targetSize');
    const found = await search({ format: 'image/webp', quality: 0.8 }, new Blob(), { targetBytes: 500_000 });
    // 500 kB at 1 MB per unit of quality → quality ≈ 0.5, i.e. ~50 on the dial.
    expect(found.quality).toBeGreaterThan(40);
    expect(found.quality).toBeLessThan(60);
    expect(encode.mock.calls.length).toBeGreaterThan(1);
    vi.doUnmock('../src/lib/image/processor');
  });
});

describe('base64 binary payloads', () => {
  it('decodes bytes that are not text, instead of refusing them', () => {
    // 0xFF 0xFE is not UTF-8; the old path threw and the user got nothing.
    const bytes = decodeBase64Bytes('//4=');
    expect(Array.from(bytes)).toEqual([0xff, 0xfe]);
    expect(looksLikeText(bytes)).toBe(false);
  });

  it('still recognises text', () => {
    const bytes = decodeBase64Bytes('aGVsbG8=');
    expect(looksLikeText(bytes)).toBe(true);
  });

  it('tolerates the whitespace and url-safe alphabet that arrive in practice', () => {
    expect(Array.from(decodeBase64Bytes('aGVs\nbG8='))).toEqual(Array.from(decodeBase64Bytes('aGVsbG8=')));
    expect(Array.from(decodeBase64Bytes('-_8='))).toEqual([0xfb, 0xff]);
  });
});

describe('json error position', () => {
  it('turns a line and column into a caret offset', () => {
    const text = '{\n  "a": 1,\n  "b" 2\n}';
    // Line 3, column 3 is the opening quote of "b".
    const offset = offsetForLineColumn(text, 3, 3);
    expect(text[offset]).toBe('"');
  });

  it('clamps rather than throwing on a nonsense position', () => {
    const text = '{}';
    expect(offsetForLineColumn(text, 99, 99)).toBe(text.length);
    expect(offsetForLineColumn(text, 0, 1)).toBe(0);
  });
});
