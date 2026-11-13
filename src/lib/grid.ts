/**
 * How many columns to lay a card grid out in, given how many cards there are.
 *
 * A grid that lets the browser derive its column count from the viewport width
 * will happily leave a straggler: six tools at four across is four cards and then
 * two more beside half a row of empty space. The count is knowable, so the pages
 * that have a straggler ask for a count that divides their cards instead.
 *
 * Two cards are laid out side by side — the widest a card should get — and
 * everything else picks the count that leaves the fewest empty tracks, with ties
 * going to the wider layout because a shorter page reads as more finished.
 *
 * An odd count more than one row deep cannot be solved by choosing columns: five
 * cards leave one behind at two, three and four across. `gridColumnsFor` picks the
 * tidiest count it can and the stylesheet makes that last card span the row, which
 * is the only arrangement that does not look like a mistake.
 *
 * Worked through for the counts that exist in the catalogue:
 *
 *   4 cards → 4 across (one full row) rather than 2 × 2
 *   5 cards → 3 across (3 + 2) rather than 2 + 2 + 1
 *   6 cards → 3 across (3 + 3) rather than 4 + 2
 *   7 cards → 4 across (4 + 3), the last card spanning the row
 */
const CANDIDATES = [2, 3, 4] as const;

export type GridColumns = (typeof CANDIDATES)[number];

export function gridColumnsFor(count: number): GridColumns | null {
  // Nothing to align, and two cards side by side are already as even as a row
  // gets at a sensible card width.
  if (count <= 1) return null;
  if (count === 2) return 2;

  let best: GridColumns | null = null;
  let fewestEmpty = Number.POSITIVE_INFINITY;

  for (const columns of CANDIDATES) {
    const carried = count % columns;
    const empty = carried === 0 ? 0 : columns - carried;
    // `<=` so a later (wider) candidate wins a tie: a 5-card row of 3 + 2 reads
    // better than 2 + 2 + 1, and a 4-card row of 4 beats 2 x 2.
    if (empty <= fewestEmpty) {
      best = columns;
      fewestEmpty = empty;
    }
  }

  return best;
}

/** The class name that expresses `gridColumnsFor`, or an empty string. */
export function gridColumnsClass(count: number): string {
  const columns = gridColumnsFor(count);
  if (!columns) return '';
  // `--even` marks the grids that need the straggler-spanning rule; it is only
  // meaningful once there is more than one row.
  return `tool-grid--cols-${columns} tool-grid--even`;
}
