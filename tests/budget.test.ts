import { describe, expect, it } from 'vitest';
import {
  OPERATION_BUDGETS,
  assertCumulativeBudget,
  assertPageBudget,
  totalSize,
} from '../src/lib/files/budget';
import { ToolError } from '../src/lib/files/errors';
import { MB } from './helpers';

const inputs = (count: number, size: number) =>
  Array.from({ length: count }, (_, index) => ({ name: `f${index}`, size }));

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
    return 'no-throw';
  } catch (error) {
    return (error as ToolError).code;
  }
};

describe('totalSize', () => {
  it('sums metadata sizes', () => {
    expect(totalSize([{ name: 'a', size: 5 }, { name: 'b', size: 7 }])).toBe(12);
    expect(totalSize([])).toBe(0);
  });
});

describe('assertCumulativeBudget', () => {
  it('accepts a batch inside both limits', () => {
    expect(() => assertCumulativeBudget(inputs(3, MB), OPERATION_BUDGETS.pdfMerge)).not.toThrow();
  });

  it('rejects an empty batch with empty-input', () => {
    expect(codeOf(() => assertCumulativeBudget([], OPERATION_BUDGETS.pdfMerge))).toBe('empty-input');
  });

  it('rejects too many items with limit-exceeded', () => {
    const budget = OPERATION_BUDGETS.pdfMerge;
    const error = (() => {
      try {
        assertCumulativeBudget(inputs(budget.maxItems + 1, 1), budget);
      } catch (err) {
        return err as ToolError;
      }
      return null;
    })();
    expect(error?.code).toBe('limit-exceeded');
    expect(error?.message).toMatch(/at most 50 PDFs/);
    expect(error?.hint).toBeTruthy();
  });

  it('rejects a cumulative size over the ceiling, naming the total', () => {
    const error = (() => {
      try {
        assertCumulativeBudget(inputs(2, 150 * MB), OPERATION_BUDGETS.pdfMerge);
      } catch (err) {
        return err as ToolError;
      }
      return null;
    })();
    expect(error?.code).toBe('limit-exceeded');
    expect(error?.message).toMatch(/total 300 MB together/);
  });

  it('is exact at the boundary — equal to the limit passes, one byte over fails', () => {
    const budget = OPERATION_BUDGETS.imagesToPdf;
    expect(() => assertCumulativeBudget([{ name: 'a', size: budget.maxBytes }], budget)).not.toThrow();
    expect(codeOf(() => assertCumulativeBudget([{ name: 'a', size: budget.maxBytes + 1 }], budget))).toBe(
      'limit-exceeded',
    );
  });

  it('keeps the documented operation ceilings', () => {
    expect(OPERATION_BUDGETS.pdfMerge).toMatchObject({ maxItems: 50, maxBytes: 250 * MB, maxPages: 3_000 });
    expect(OPERATION_BUDGETS.imagesToPdf).toMatchObject({ maxItems: 200, maxBytes: 150 * MB });
    expect(OPERATION_BUDGETS.zipCreate).toMatchObject({ maxItems: 2_000, maxBytes: 512 * MB });
  });
});

describe('assertPageBudget', () => {
  it('allows a page count at the ceiling', () => {
    expect(() => assertPageBudget(3_000, OPERATION_BUDGETS.pdfMerge)).not.toThrow();
  });

  it('rejects one page over', () => {
    expect(codeOf(() => assertPageBudget(3_001, OPERATION_BUDGETS.pdfMerge))).toBe('limit-exceeded');
  });

  it('is a no-op for budgets without a page ceiling', () => {
    expect(() => assertPageBudget(1e9, OPERATION_BUDGETS.zipCreate)).not.toThrow();
  });
});
