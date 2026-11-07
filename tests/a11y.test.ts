import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Accessibility rules that can be checked by reading the stylesheet — no browser,
 * no CSS engine, so they hold in CI and in any future framework.
 *
 * What this can assert: that the blocks exist, that they cover the things that
 * vanish under forced colours, and that nothing regresses silently. What it
 * cannot assert: that the result *looks* right. That still needs a person in
 * Windows High Contrast and a person at 320 px.
 */

const STYLES = join(process.cwd(), 'src/styles');

const css = (name: string) => readFileSync(join(STYLES, name), 'utf8');

/** Body of the first `@media <query> { … }` block, brace-matched. */
function mediaBlock(source: string, query: string): string | null {
  const start = source.indexOf(`@media ${query}`);
  if (start < 0) return null;
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

const a11y = css('a11y.css');
const forced = mediaBlock(a11y, '(forced-colors: active)');

describe('forced colours', () => {
  it('has a block at all', () => {
    expect(forced, 'no @media (forced-colors: active) in a11y.css').not.toBeNull();
    expect(forced!.length).toBeGreaterThan(400);
  });

  it('draws focus with an outline, because box-shadow rings disappear', () => {
    // This is the failure that matters: the default theme's focus ring is a
    // box-shadow, and forced colours removes shadows outright.
    expect(forced).toMatch(/:focus-visible\s*\{[^}]*outline:\s*3px solid Highlight/);
    expect(forced).toMatch(/:focus-visible\s*\{[^}]*box-shadow:\s*none/);
  });

  it('gives every bordered surface a real border', () => {
    for (const selector of ['.card', '.panel', '.input', '.notice', '.filedrop', '.manifest', '.result']) {
      expect(forced, `${selector} has no forced-colours rule`).toContain(selector);
    }
    expect(forced).toMatch(/border:\s*1px solid CanvasText/);
  });

  it('switches surfaces off blur and gradients', () => {
    expect(forced).toMatch(/backdrop-filter:\s*none !important/);
    expect(forced).toMatch(/background-image:\s*none !important/);
  });
});

describe('more contrast', () => {
  const tokens = css('tokens.css');
  const more = mediaBlock(tokens, '(prefers-contrast: more)');

  it('raises the separation tokens in the token layer, not in a component sheet', () => {
    expect(more, 'no @media (prefers-contrast: more) in tokens.css').not.toBeNull();
    expect(more).toMatch(/--line:/);
    expect(more).toMatch(/--line-strong:/);
    expect(more).toMatch(/--text-muted:/);
    // Both themes answer it; a light-mode user who asks for more contrast gets it.
    expect(more).toContain("[data-theme='light']");
  });

  it('makes the glass opaque and drops the blur', () => {
    const block = mediaBlock(a11y, '(prefers-contrast: more)');
    expect(block).not.toBeNull();
    expect(block).toMatch(/backdrop-filter:\s*none !important/);
    expect(block).toContain('.site-header');
    expect(block).toContain('.palette');
  });

  it('leaves no component redefining palette tokens outside tokens.css', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(STYLES).filter((name) => name.endsWith('.css') && name !== 'tokens.css')) {
      const source = css(file).replace(/\/\*[\s\S]*?\*\//g, '');
      const contrast = mediaBlock(source, '(prefers-contrast: more)');
      if (contrast && /--(text|line|bg|surface|accent)[\w-]*:\s/.test(contrast)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

describe('narrow viewports', () => {
  const narrow = mediaBlock(a11y, '(max-width: 400px)');

  it('has a block for the 320 px / 200 % zoom floor', () => {
    expect(narrow).not.toBeNull();
  });

  it('keeps the entry list to two flexible columns plus its controls', () => {
    expect(narrow).toMatch(/\.manifest__head[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) 62px auto/);
  });
});

describe('the crop frame is reachable without a pointer', () => {
  const tools = css('tools.css');

  it('has a focus indicator that is not a second scrim', () => {
    // The frame spends its box-shadow on the dimming scrim, so the ring is an
    // outline — asserted here so a refactor cannot quietly turn focus off.
    expect(tools).toMatch(/\.crop-rect:focus-visible\s*\{[^}]*outline:/);
  });

  it('is not hidden from the accessibility tree', () => {
    const source = readFileSync(join(process.cwd(), 'src/tools/transform/CropTool.tsx'), 'utf8');
    expect(source).toMatch(/className="crop-rect"[\s\S]{0,200}tabIndex=\{0\}/);
    expect(source).toMatch(/onKeyDown=\{nudge\}/);
    expect(source).toMatch(/aria-describedby="crop-keys"/);
  });
});
