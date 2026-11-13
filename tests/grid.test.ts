import { describe, expect, it } from 'vitest';
import { gridColumnsClass, gridColumnsFor } from '../src/lib/grid';
import { TOOLS_BY_CATEGORY } from '../src/registry/tools';
import { HUB_MAP } from '../src/registry/groups';

/**
 * Card grid column counts.
 *
 * The category pages render their cards into a grid whose column count used to
 * come from the viewport width, which left the last row looking thrown together:
 * six image tools at four across stranded two cards, seven PDF tools at three
 * across stranded one. The pages now ask for a count based on how many cards they
 * have. For an odd count more than one row deep, no column count avoids a lone
 * card — `gridColumnsFor` picks the tidiest and the stylesheet spans that card
 * across the row — so `gridColumnsClass` also emits the `--even` marker.
 */

describe('gridColumnsFor', () => {
  it('has no opinion about zero or one card', () => {
    expect(gridColumnsFor(0)).toBeNull();
    expect(gridColumnsFor(1)).toBeNull();
  });

  it.each([
    [2, 2],
    [3, 3],
    [4, 4],
    [5, 3],
    [6, 3],
    [7, 4],
    [8, 4],
    [9, 3],
    [12, 4],
  ])('%i cards -> %i columns', (count, expected) => {
    expect(gridColumnsFor(count)).toBe(expected);
  });

  it('leaves no empty tracks when the count divides cleanly', () => {
    for (const count of [2, 3, 4, 6, 8, 9, 12]) {
      const columns = gridColumnsFor(count)!;
      expect(count % columns, `${count} at ${columns} across`).toBe(0);
    }
  });

  it('minimises how much of the last row is left empty', () => {
    // The count is chosen to leave the least empty space available, so no other
    // candidate may beat it. A lone card is handled by the spanning rule; this is
    // about the layout, not the straggler.
    for (let count = 2; count <= 40; count += 1) {
      const columns = gridColumnsFor(count)!;
      const empty = count % columns === 0 ? 0 : columns - (count % columns);
      for (const other of [2, 3, 4]) {
        const otherEmpty = count % other === 0 ? 0 : other - (count % other);
        expect(empty, `${count} cards: ${columns} beats ${other}`).toBeLessThanOrEqual(otherEmpty);
      }
    }
  });

  it('asks for the straggler rule only when there is a grid to apply it to', () => {
    expect(gridColumnsClass(1)).toBe('');
    expect(gridColumnsClass(6)).toBe('tool-grid--cols-3 tool-grid--even');
  });
});

describe('the catalogue has card counts the grid can lay out', () => {
  it('has no category that would render a single card in a grid', () => {
    // `inspect` genuinely has one tool. A one-card grid is not a layout problem,
    // it is a category that should not be presenting itself as a grid, and the
    // page is allowed to fall back to the default single column for it.
    for (const [category, tools] of Object.entries(TOOLS_BY_CATEGORY)) {
      if (tools.length < 2) continue;
      expect(gridColumnsFor(tools.length), `${category} has no layout`).not.toBeNull();
    }
  });

  it('gives every populated capability hub a column count', () => {
    for (const [id, hub] of Object.entries(HUB_MAP)) {
      if (hub.tools.length < 2) continue;
      expect(gridColumnsFor(hub.tools.length), `${id} has no layout`).not.toBeNull();
    }
  });
});
