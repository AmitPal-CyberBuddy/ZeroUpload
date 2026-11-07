import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Hover that *moves* something must be gated behind `@media (hover: hover)`.
 *
 * A touch screen sets `:hover` when you tap and leaves it there until you tap
 * something else. An unguarded `transform: translateY(-2px)` therefore leaves the
 * card you just visited stuck off the grid, looking permanently selected — the
 * "sticky hover" bug, which is invisible on a laptop and obvious on a phone.
 *
 * This walks the stylesheets with a tiny brace counter so it can tell *where* a
 * rule lives, rather than grepping for a string that happens to appear nearby.
 */

const styleDir = join(process.cwd(), 'src/styles');

interface Rule {
  selector: string;
  body: string;
  atRules: string[];
}

/** Split a stylesheet into top-level-ish rules, tracking the at-rule stack. */
function parse(css: string): Rule[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  const stack: string[] = [];
  let buffer = '';

  for (let i = 0; i < source.length; i++) {
    const char = source[i];

    if (char === '{') {
      const prelude = buffer.trim();
      buffer = '';
      // An at-rule (`@media …`) opens a context; anything else opens a rule body.
      if (prelude.startsWith('@')) {
        stack.push(prelude);
        continue;
      }
      // Read the declaration block.
      let depth = 1;
      let j = i + 1;
      while (j < source.length && depth > 0) {
        if (source[j] === '{') depth++;
        else if (source[j] === '}') depth--;
        j++;
      }
      rules.push({ selector: prelude, body: source.slice(i + 1, j - 1), atRules: [...stack] });
      i = j - 1;
      continue;
    }

    if (char === '}') {
      stack.pop();
      buffer = '';
      continue;
    }

    if (char === ';' && buffer.trim().startsWith('@')) {
      buffer = '';
      continue;
    }

    buffer += char;
  }

  return rules;
}

const MOVES = /transform:\s*(?!none)[^;]+;/;

describe('hover motion', () => {
  const files = readdirSync(styleDir).filter((file) => file.endsWith('.css'));

  it('finds stylesheets to check', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('only moves things on devices that can actually hover', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const css = readFileSync(join(styleDir, file), 'utf8');
      for (const rule of parse(css)) {
        if (!rule.selector.includes(':hover')) continue;
        if (!MOVES.test(rule.body)) continue;
        const guarded = rule.atRules.some((at) => /hover:\s*hover/.test(at));
        if (!guarded) offenders.push(`${file} → ${rule.selector.trim()}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('does not hide hover colour from anyone', () => {
    // The guard is for movement, not for feedback: a mouse user should still see
    // the border firm up on every card.
    const pages = readFileSync(join(styleDir, 'pages.css'), 'utf8');
    expect(pages).toMatch(/@media \(hover: none\)[\s\S]{0,200}border-color: var\(--line-strong\)/);
  });

  it('has a pressed state on the cards', () => {
    const pages = readFileSync(join(styleDir, 'pages.css'), 'utf8');
    expect(pages).toContain('.tool-card:active');
    expect(pages).toContain('.category-card:active');
  });
});
