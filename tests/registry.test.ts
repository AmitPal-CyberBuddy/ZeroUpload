import { describe, expect, it } from 'vitest';
import { ALL_TOOLS, TOOLS, TOOL_MAP, TOOLS_BY_CATEGORY, getTool, getToolAny } from '../src/registry/tools';
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

  it('can still describe a hidden tool to its own component', () => {
    // The components for flagged tools are compiled in even when routing hides
    // the route. `getToolAny` is what they read, so their shell renders either
    // way; `getTool` remains the routing answer and stays undefined. Reading
    // `getTool(...)!` in a component instead turned a hidden tool into a null
    // dereference the moment anything mounted it outside the router.
    for (const tool of ALL_TOOLS) {
      expect(getToolAny(tool.slug), tool.slug).toBeDefined();
    }
    if (!OFFICE_ENCRYPTION_ENABLED) {
      expect(getToolAny('encrypt-office')).toBeDefined();
      expect(getTool('encrypt-office')).toBeUndefined();
    }
  });

  it('budgets encrypted archives below plain ones, because the writer costs ~3.8x', () => {
    const plain = OPERATION_BUDGETS.zipCreate;
    const encrypted = OPERATION_BUDGETS.zipCreateEncrypted;
    expect(encrypted.maxBytes).toBeLessThan(plain.maxBytes);
    expect(encrypted.maxItems).toBeLessThan(plain.maxItems ?? Number.POSITIVE_INFINITY);
  });
});
