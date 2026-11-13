import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration, middleTruncate } from '../src/lib/files/format';

/**
 * These expectations are **hand-written**, not produced by calling the function.
 *
 * `tests/copy.test.ts` already imports `formatBytes` — to build the string it then
 * asserts the prose contains. That is a tautology: it agrees with whatever the
 * formatter returns, including "1024 KB" and "59m 60s", which the code emitted
 * until this file existed. Every value below was decided before the function was
 * run, so a regression has to disagree with a human.
 */

describe('formatBytes', () => {
  it('uses plain bytes below a kilobyte', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1)).toBe('1 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('promotes on a rounding carry instead of printing 1024 of the smaller unit', () => {
    // 1023.6 rounds to 1024 — that is 1 KB, not "1024 B".
    expect(formatBytes(1023.6)).toBe('1 KB');
    // 1 MiB − 1 byte is the classic case: it must not read "1024 KB".
    expect(formatBytes(1024 * 1024 - 1)).toBe('1 MB');
    expect(formatBytes(1024 * 1024 - 0.1)).toBe('1 MB');
  });

  it('switches unit exactly at the boundary', () => {
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1024 * 1024)).toBe('1 MB');
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
  });

  it('keeps meaningful precision at each scale', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(4823401)).toBe('4.6 MB');
    expect(formatBytes(120 * 1024 * 1024)).toBe('120 MB');
  });

  it('refuses values that are not a size', () => {
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatDuration', () => {
  it('uses milliseconds under a second', () => {
    expect(formatDuration(0)).toBe('0 ms');
    expect(formatDuration(999)).toBe('999 ms');
  });

  it('uses seconds under a minute, without ever printing a 60th second', () => {
    expect(formatDuration(1000)).toBe('1.00 s');
    expect(formatDuration(9999)).toBe('10.00 s');
    expect(formatDuration(59_000)).toBe('59.0 s');
    // 59.999 s rounds to 60 s, which is 1m 0s — not "60.0 s".
    expect(formatDuration(59_999)).toBe('1m 0s');
    expect(formatDuration(60_000)).toBe('1m 0s');
  });

  it('carries seconds into minutes instead of printing "59m 60s"', () => {
    expect(formatDuration(3_599_999)).toBe('1h 0m');
    expect(formatDuration(3_540_000)).toBe('59m 0s');
  });

  it('promotes minutes to hours', () => {
    expect(formatDuration(3_600_000)).toBe('1h 0m');
    expect(formatDuration(7_200_000)).toBe('2h 0m');
    expect(formatDuration(5_400_000)).toBe('1h 30m');
  });

  it('refuses values that are not a duration', () => {
    expect(formatDuration(-5)).toBe('—');
    expect(formatDuration(Number.NaN)).toBe('—');
  });
});

describe('middleTruncate', () => {
  it('leaves short names alone', () => {
    expect(middleTruncate('x', 34)).toBe('x');
    expect(middleTruncate('abcd.md', 7)).toBe('abcd.md');
  });

  it('never returns a string longer than the limit it was given', () => {
    const names = ['a.png', 'photo.jpg', 'a'.repeat(80) + '.jpeg', 'x.tar.gz', '.gitignore'];
    for (const max of [1, 2, 4, 7, 8, 10, 20, 34, 52]) {
      for (const name of names) {
        expect(
          middleTruncate(name, max).length,
          `middleTruncate(${JSON.stringify(name)}, ${max}) exceeded ${max}`,
        ).toBeLessThanOrEqual(Math.max(max, 1));
      }
    }
  });

  it('does not repeat a character at both ends', () => {
    // The old implementation emitted "a…a.png": head and tail overlapped.
    expect(middleTruncate('a.png', 4)).not.toBe('a…a.png');
    expect(middleTruncate('ab', 1)).not.toBe('ab…b');
  });

  it('keeps the extension visible when it fits', () => {
    const out = middleTruncate('a-very-long-photograph-name-here.jpeg', 24);
    expect(out.endsWith('.jpeg')).toBe(true);
    expect(out).toContain('…');
    expect(out.length).toBeLessThanOrEqual(24);
  });

  it('keeps a hidden file name recognisable', () => {
    expect(middleTruncate('.gitignore', 34)).toBe('.gitignore');
  });
});
