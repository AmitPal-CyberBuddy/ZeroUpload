import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toolSlugFromPath } from '../src/registry/toolComponents';

/**
 * Navigation and intent.
 *
 * Two behaviours are pinned here because both are easy to delete by accident and
 * neither shows up in a type-check:
 *
 *  1. Coming back to a page should land where you left it. The app used to scroll
 *     to the top on *every* pathname change, which is right for a new page and
 *     wrong for the one you just pressed Back out of.
 *  2. Opening a tool used to mean staring at "Opening workspace…" while 240 kB of
 *     pdf-lib arrived. The chunk can be fetched on intent instead.
 */

const root = process.cwd();
const app = readFileSync(join(root, 'src/App.tsx'), 'utf8');
const scroll = readFileSync(join(root, 'src/hooks/useScrollRestoration.ts'), 'utf8');
const card = readFileSync(join(root, 'src/components/tool/ToolCard.tsx'), 'utf8');
const palette = readFileSync(join(root, 'src/components/layout/CommandPalette.tsx'), 'utf8');
const registry = readFileSync(join(root, 'src/registry/toolComponents.ts'), 'utf8');

describe('scroll restoration', () => {
  it('replaces the unconditional scroll-to-top', () => {
    // One owner for the viewport. Two effects scrolling on every route change fight
    // each other, and the loser is whichever runs second.
    expect(app).not.toMatch(/window\.scrollTo\(\)/);
    expect(app).toContain('useScrollRestoration()');
  });

  it('keys positions by history entry, not by pathname', () => {
    // Two visits to /tools/ are two different places to come back to.
    expect(scroll).toContain('location.key');
    expect(scroll).toContain("navigation === 'POP'");
  });

  it('restores instantly, and only on real back/forward', () => {
    expect(scroll).toMatch(/behavior: 'instant'/);
    expect(scroll).toContain('useNavigationType');
  });

  it('uses per-tab storage and survives a corrupt value', () => {
    expect(scroll).toContain('sessionStorage');
    expect(scroll).toMatch(/catch\s*\{/);
  });

  it('caps the number of stored entries', () => {
    expect(scroll).toMatch(/<= 30/);
  });
});

describe('tool prefetch', () => {
  it('derives every lazy component from a preloadable loader', () => {
    // If a tool is registered with a bare `lazy()` it becomes invisible to
    // preloading — and to `toolSlugFromPath` — without any error.
    expect(registry).toContain('TOOL_LOADERS');
    expect(registry).toMatch(/lazy\(load\)/);
    expect(registry).not.toMatch(/lazy\(\(\) => import\(/);
  });

  it('warms on intent from both the cards and the palette', () => {
    expect(card).toContain('preloadTool');
    expect(card).toMatch(/onPointerEnter=\{warm\}/);
    expect(card).toMatch(/onFocus=\{warm\}/);
    expect(palette).toContain('preloadTool');
  });

  it('respects Save-Data and 2G', () => {
    // A cursor crossing a card is not consent to a 240 kB download on a metered link.
    expect(registry).toContain('saveData');
    expect(registry).toContain('effectiveType');
  });
});

describe('toolSlugFromPath', () => {
  it('reads the slug out of a tool route', () => {
    expect(toolSlugFromPath('/tools/merge-pdf/')).toBe('merge-pdf');
    expect(toolSlugFromPath('/tools/merge-pdf')).toBe('merge-pdf');
    expect(toolSlugFromPath('/tools/merge-pdf/?x=1#y')).toBe('merge-pdf');
  });

  it('refuses anything that is not a registered tool', () => {
    expect(toolSlugFromPath('/tools/')).toBeUndefined();
    expect(toolSlugFromPath('/tools/pdf/')).toBeUndefined();
    expect(toolSlugFromPath('/how-it-works/')).toBeUndefined();
    expect(toolSlugFromPath('/')).toBeUndefined();
    expect(toolSlugFromPath('/tools/not-a-tool/')).toBeUndefined();
  });
});
