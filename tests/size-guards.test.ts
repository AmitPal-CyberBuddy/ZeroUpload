import { describe, expect, it } from 'vitest';
import { ToolError, assertWithinSize, toToolError } from '../src/lib/files/errors';
import { MB } from './helpers';

/** `assertWithinSize` only reads `.name` and `.size`, so metadata objects suffice. */
const file = (size: number, name = 'file.bin') => ({ name, size }) as unknown as File;

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
    return 'no-throw';
  } catch (error) {
    return (error as ToolError).code;
  }
};

describe('assertWithinSize', () => {
  it('accepts a file under each category limit', () => {
    expect(() => assertWithinSize(file(10 * MB), 'image')).not.toThrow();
    expect(() => assertWithinSize(file(10 * MB), 'pdf')).not.toThrow();
    expect(() => assertWithinSize(file(10 * MB), 'zip')).not.toThrow();
    expect(() => assertWithinSize(file(10 * MB), 'text')).not.toThrow();
  });

  it('rejects a file over the per-category limit with too-large', () => {
    expect(codeOf(() => assertWithinSize(file(121 * MB), 'image'))).toBe('too-large');
    expect(codeOf(() => assertWithinSize(file(201 * MB), 'pdf'))).toBe('too-large');
    expect(codeOf(() => assertWithinSize(file(401 * MB), 'zip'))).toBe('too-large');
    expect(codeOf(() => assertWithinSize(file(26 * MB), 'text'))).toBe('too-large');
  });

  it('names the file and its category limit in the message', () => {
    const error = (() => {
      try {
        assertWithinSize(file(500 * MB, 'scan.pdf'), 'pdf');
      } catch (err) {
        return err as ToolError;
      }
      return null;
    })();
    expect(error?.message).toContain('scan.pdf');
    expect(error?.message).toContain('200 MB');
    expect(error?.hint).toBeTruthy();
  });

  it('rejects a zero-byte file with empty-input', () => {
    expect(codeOf(() => assertWithinSize(file(0), 'image'))).toBe('empty-input');
  });

  it('treats the limit itself as allowed', () => {
    expect(() => assertWithinSize(file(200 * MB), 'pdf')).not.toThrow();
  });
});

describe('ToolError', () => {
  it('carries a machine-readable code and an optional hint', () => {
    const error = new ToolError('corrupt-file', 'bad', 'try again');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ToolError');
    expect(error.code).toBe('corrupt-file');
    expect(error.hint).toBe('try again');
    expect(error.message).toBe('bad');
  });

  it('passes existing ToolErrors through unchanged', () => {
    const original = new ToolError('encrypted', 'locked');
    expect(toToolError(original)).toBe(original);
  });

  it('maps quota failures to limit-exceeded', () => {
    const quota = new DOMException('quota', 'QuotaExceededError');
    expect(toToolError(quota).code).toBe('limit-exceeded');
  });

  it('wraps unknown errors without losing the message', () => {
    const wrapped = toToolError(new Error('boom'));
    expect(wrapped.code).toBe('unknown');
    expect(wrapped.message).toBe('boom');
    expect(toToolError('a string').code).toBe('unknown');
  });
});
