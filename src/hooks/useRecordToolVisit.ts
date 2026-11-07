import { useEffect } from 'react';
import { TOOLS } from '../registry/tools';
import { browserStore, recordRecent } from '../lib/recent/recentTools';

/** Slugs of every tool the catalogue currently lists, flags applied. */
export const TOOL_SLUGS: readonly string[] = TOOLS.map((tool) => tool.slug);

/**
 * Remembers that a tool was opened, for the palette's "Recent" row.
 *
 * Recording happens in the tool shell rather than at the click, so a page that
 * was bookmarked, opened from the catalogue or reached from a search result counts
 * the same way. Tools that are not available yet are skipped: a visit to a
 * "planned" page is not a tool you used, and suggesting it back would be noise.
 *
 * `enabled` is a dependency, not a condition around the call, because a component
 * cannot skip a hook — the early returns in `ToolLayout` for planned tools would
 * otherwise change the hook order.
 */
export function useRecordToolVisit(slug: string, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    recordRecent(browserStore(), slug, TOOL_SLUGS);
  }, [slug, enabled]);
}
