import { describe, expect, it } from 'vitest';
import {
  MAX_PAGES_FOR_PER_PAGE_SPLIT,
  chunkPageIndices,
  everyPageIndices,
  parsePageRanges,
  summarisePageSelection,
} from '../src/lib/pdf/ranges';
import { ToolError } from '../src/lib/files/errors';

const errorFrom = (fn: () => unknown): ToolError | null => {
  try {
    fn();
    return null;
  } catch (error) {
    return error as ToolError;
  }
};

describe('parsePageRanges', () => {
  it('parses a mixed list into sorted zero-based indices', () => {
    expect(parsePageRanges('1-3, 5, 8-', 10)).toEqual([0, 1, 2, 4, 7, 8, 9]);
  });

  it('handles open start and open end ranges', () => {
    expect(parsePageRanges('-2', 5)).toEqual([0, 1]);
    expect(parsePageRanges('4-', 5)).toEqual([3, 4]);
  });

  it('deduplicates and sorts overlapping input', () => {
    expect(parsePageRanges('3, 1-2, 2', 5)).toEqual([0, 1, 2]);
  });

  it('clamps a range that runs past the last page', () => {
    expect(parsePageRanges('1-99', 5)).toEqual([0, 1, 2, 3, 4]);
  });

  it('tolerates odd spacing', () => {
    expect(parsePageRanges('  1 - 2 ,   4  ', 5)).toEqual([0, 1, 3]);
  });

  it('rejects an empty expression', () => {
    const error = errorFrom(() => parsePageRanges('   ', 5));
    expect(error?.code).toBe('invalid-input');
  });

  it('rejects backwards ranges', () => {
    expect(errorFrom(() => parsePageRanges('5-3', 10))?.code).toBe('invalid-input');
  });

  it('rejects page zero and negative pages', () => {
    expect(errorFrom(() => parsePageRanges('0', 5))?.code).toBe('invalid-input');
    expect(errorFrom(() => parsePageRanges('0-2', 5))?.code).toBe('invalid-input');
  });

  it('rejects a page that does not exist, and says how many there are', () => {
    const error = errorFrom(() => parsePageRanges('11', 10));
    expect(error?.code).toBe('invalid-input');
    expect(error?.hint).toContain('10 pages');
  });

  it('rejects junk', () => {
    expect(errorFrom(() => parsePageRanges('abc', 5))?.code).toBe('invalid-input');
    expect(errorFrom(() => parsePageRanges('1;2', 5))?.code).toBe('invalid-input');
    expect(errorFrom(() => parsePageRanges('-', 5))?.code).toBe('invalid-input');
  });
});

describe('summarisePageSelection', () => {
  it('never throws, even for junk', () => {
    expect(summarisePageSelection('abc', 5)).toEqual([]);
    expect(summarisePageSelection('', 5)).toEqual([]);
  });

  it('ignores out-of-range pages instead of failing the preview', () => {
    expect(summarisePageSelection('1, 99', 5)).toEqual([0]);
  });

  it('agrees with parsePageRanges on valid input', () => {
    for (const input of ['1-3, 5', '2', '4-', '-2', '1 - 3', '3, 1-2, 2']) {
      expect(summarisePageSelection(input, 10)).toEqual(parsePageRanges(input, 10));
    }
  });
});

describe('chunkPageIndices', () => {
  it('splits evenly with a remainder', () => {
    expect(chunkPageIndices(7, 3)).toEqual([[0, 1, 2], [3, 4, 5], [6]]);
  });

  it('handles an exact division', () => {
    expect(chunkPageIndices(6, 3)).toEqual([[0, 1, 2], [3, 4, 5]]);
  });

  it('returns nothing for an empty document', () => {
    expect(chunkPageIndices(0, 3)).toEqual([]);
  });

  it('never produces an empty group, even for size 0 or a fraction', () => {
    expect(chunkPageIndices(3, 0)).toEqual([[0], [1], [2]]);
    expect(chunkPageIndices(3, 2.9)).toEqual([[0, 1], [2]]);
  });

  it('covers every page exactly once', () => {
    const groups = chunkPageIndices(101, 10);
    expect(groups.flat()).toEqual(Array.from({ length: 101 }, (_, i) => i));
  });
});

describe('everyPageIndices', () => {
  it('produces one single-page group per page', () => {
    expect(everyPageIndices(3)).toEqual([[0], [1], [2]]);
    expect(everyPageIndices(0)).toEqual([]);
  });
});

describe('per-page split cap', () => {
  it('stays at the documented 500 pages', () => {
    expect(MAX_PAGES_FOR_PER_PAGE_SPLIT).toBe(500);
  });
});
