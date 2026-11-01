import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `FileDrop` used to be a `div role="button"` with a hidden input inside it: the
 * zone announced itself as a button, the real file control was removed from the
 * accessibility tree, and Enter/Space had to be re-implemented by hand.
 *
 * It is now a label for a real `<input type="file">`. That is a small change with
 * a large blast radius, so it is pinned here: no `role="button"`, the label is
 * bound to the input by id, and the input stays reachable by keyboard. The CSS
 * side (where the focus ring is drawn) is checked too, because a visually hidden
 * input with no ring anywhere would be a keyboard trap.
 */

const root = process.cwd();
// Comments describe the old markup on purpose; only the code is checked.
const source = readFileSync(join(root, 'src/components/file/FileDrop.tsx'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);
const css = readFileSync(join(root, 'src/styles/workspace.css'), 'utf8');

describe('FileDrop', () => {
  it('is a label for a real file input, not a fake button', () => {
    expect(source).not.toContain('role="button"');
    expect(source).toContain('<label');
    expect(source).toContain('htmlFor={inputId}');
    expect(source).toContain('id={inputId}');
    expect(source).toContain('type="file"');
  });

  it('keeps the input in the tab order and in the accessibility tree', () => {
    const input = source.slice(source.indexOf('<input'), source.indexOf('/>', source.indexOf('<input')));
    expect(input).not.toContain('tabIndex={-1}');
    expect(input).not.toContain('aria-hidden');
    expect(input).toContain('aria-describedby={describedBy}');
  });

  it('draws the focus ring on the zone, since the input is visually hidden', () => {
    expect(css).toContain('.filedrop:has(.filedrop__input:focus-visible)');
    // Older engines get a fallback rather than no ring at all.
    expect(css).toContain('@supports not selector(:has(*))');
    expect(css).toContain('.filedrop:focus-within');
  });

  it('covers the whole zone with the label so anywhere inside it is a click target', () => {
    expect(css).toMatch(/\.filedrop__label\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;/);
  });
});
