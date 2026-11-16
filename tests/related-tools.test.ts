/**
 * "Related tools" on every tool page.
 *
 * The map this replaced had three bare slugs per tool and a fallback that padded
 * from the stable list in declaration order — so a page could suggest a tool from
 * an unrelated category purely because it came first in the array. These tests
 * hold the properties that make a suggestion list useful: it always names real
 * registered tools, it never repeats or self-links, every entry explains itself,
 * and the curated order is preserved because the first entry is the strongest.
 */
import { describe, expect, it } from 'vitest';

import {
  ALL_TOOLS,
  TOOLS,
  getTool,
  relatedToolEntries,
  relatedTools,
  TOOL_MAP,
} from '../src/registry/tools';
import { CATEGORY_MAP } from '../src/registry/categories';

describe('related tool suggestions', () => {
  it('suggests three reachable tools on every page, including flagged ones', () => {
    for (const tool of ALL_TOOLS) {
      const entries = relatedToolEntries(tool, 3);
      expect(entries, tool.slug).toHaveLength(3);
      for (const entry of entries) {
        expect(TOOL_MAP[entry.slug], `${tool.slug} → ${entry.slug}`).toBeDefined();
      }
    }
  });

  it('never suggests the page you are on', () => {
    for (const tool of ALL_TOOLS) {
      expect(relatedToolEntries(tool, 3).map((entry) => entry.slug)).not.toContain(tool.slug);
    }
  });

  it('never repeats a suggestion', () => {
    for (const tool of ALL_TOOLS) {
      const slugs = relatedToolEntries(tool, 3).map((entry) => entry.slug);
      expect(new Set(slugs).size, tool.slug).toBe(slugs.length);
    }
  });

  it('explains every suggestion with a full sentence', () => {
    for (const tool of ALL_TOOLS) {
      for (const entry of relatedToolEntries(tool, 3)) {
        // The old map had no reason at all; a two-word label would be no better.
        expect(entry.why.length, `${tool.slug} → ${entry.slug}`).toBeGreaterThan(24);
        expect(entry.why.trim().endsWith('.')).toBe(true);
      }
    }
  });

  it('keeps the curated order, because the first entry is the strongest', () => {
    expect(relatedToolEntries(getTool('unlock-pdf')!, 3).map((entry) => entry.slug)).toEqual([
      'protect-pdf',
      'unlock-office',
      'file-inspector',
    ]);
    expect(relatedToolEntries(getTool('merge-pdf')!, 3).map((entry) => entry.slug)).toEqual([
      'split-pdf',
      'rotate-pdf',
      'protect-pdf',
    ]);
  });

  it('translates the one alias in the curated table rather than shipping a dead link', () => {
    // image-inspector is not a route; the inspector covers every family.
    const entries = relatedToolEntries(getTool('image-converter')!, 4);
    expect(entries.map((entry) => entry.slug)).not.toContain('image-inspector');
    expect(entries.every((entry) => Boolean(getTool(entry.slug)))).toBe(true);
  });

  it('falls back to the same category before anywhere else', () => {
    // A tool with no curated entry at all still gets relevant neighbours.
    const synthetic = { ...getTool('crop')!, slug: 'not-a-real-tool' };
    const entries = relatedToolEntries(synthetic, 3);
    for (const entry of entries) {
      expect(CATEGORY_MAP[getTool(entry.slug)!.category]).toBeDefined();
      expect(getTool(entry.slug)!.category).toBe(synthetic.category);
    }
  });

  it('respects the limit and returns definitions in the same order', () => {
    const entries = relatedToolEntries(getTool('split-pdf')!, 2);
    const tools = relatedTools(getTool('split-pdf')!, 2);
    expect(tools.map((tool) => tool.slug)).toEqual(entries.map((entry) => entry.slug));
  });

  it('is derivable for every registered tool without throwing', () => {
    for (const tool of TOOLS) {
      expect(() => relatedTools(tool, 3)).not.toThrow();
    }
  });

  it('does not point two different hubs at the same tool as their only suggestion', () => {
    // A regression guard for the padding bug: two unrelated pages used to end up
    // with the identical three cards because the fallback was list order.
    const signatures = new Map<string, string>();
    for (const tool of TOOLS) {
      const signature = relatedToolEntries(tool, 3).map((entry) => entry.slug).join('|');
      const clash = signatures.get(signature);
      expect(clash, `${tool.slug} shares its suggestions with ${clash}`).toBeUndefined();
      signatures.set(signature, tool.slug);
    }
  });
});
