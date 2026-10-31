import { describe, expect, it } from 'vitest';
import { TOOLS, TOOL_MAP, TOOLS_BY_CATEGORY, getTool } from '../src/registry/tools';
import { TOOL_COMPONENTS } from '../src/registry/toolComponents';
import { CATEGORIES } from '../src/registry/categories';
import { OFFICE_ENCRYPTION_ENABLED } from '../src/lib/office/features';
import { OPERATION_BUDGETS } from '../src/lib/files/budget';

/**
 * The registry is the extension point, so the invariants it must hold are worth
 * asserting: a tool without a component renders a dead route, a duplicated slug
 * silently shadows one of the two, and a flag that fails open would ship an
 * unverified encryption writer.
 */
describe('tool registry', () => {
  it('has a component for every tool', () => {
    const missing = TOOLS.filter((tool) => !TOOL_COMPONENTS[tool.slug]).map((tool) => tool.slug);
    expect(missing).toEqual([]);
  });

  it('has no duplicate slugs', () => {
    const slugs = TOOLS.map((tool) => tool.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('assigns every tool to a real category, and leaves no category empty', () => {
    for (const tool of TOOLS) {
      expect(CATEGORIES.map((category) => category.id)).toContain(tool.category);
    }
    for (const category of CATEGORIES) {
      expect(TOOLS_BY_CATEGORY[category.id]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('keeps the protection and inspection tools reachable', () => {
    for (const slug of ['protect-pdf', 'unlock-pdf', 'unlock-office', 'create-zip', 'extract-zip']) {
      expect(getTool(slug), slug).toBeDefined();
    }
  });

  it('hides Office encryption unless the interoperability flag is set', () => {
    if (OFFICE_ENCRYPTION_ENABLED) {
      expect(getTool('encrypt-office')).toBeDefined();
    } else {
      // Not merely "disabled": there is no route, no catalogue entry, no palette
      // entry. A tool that exists but refuses to work is worse than an absent one.
      expect(getTool('encrypt-office')).toBeUndefined();
      expect(TOOLS.some((tool) => tool.slug === 'encrypt-office')).toBe(false);
      expect(TOOL_MAP['encrypt-office']).toBeUndefined();
    }
  });

  it('budgets encrypted archives below plain ones, because the writer costs ~3.8x', () => {
    const plain = OPERATION_BUDGETS.zipCreate;
    const encrypted = OPERATION_BUDGETS.zipCreateEncrypted;
    expect(encrypted.maxBytes).toBeLessThan(plain.maxBytes);
    expect(encrypted.maxItems).toBeLessThan(plain.maxItems ?? Number.POSITIVE_INFINITY);
  });
});
