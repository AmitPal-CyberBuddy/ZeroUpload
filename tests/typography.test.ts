import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Two rules from the UX audit that are cheap to state and easy to regress:
 *
 *  1. Mono is for values. Any rule that sets Geist Mono below 12 px must be a
 *     value-only selector (a key cap, a raw `.mono` span), never a label or a
 *     sentence. Labels are sans at 12 px or above.
 *  2. No literal white overlay outside `tokens.css`. Those are the bug that made
 *     light mode inherit dark-mode shading; themes answer each other through
 *     named tokens, not through `rgba(255,255,255,…)` sprinkled in components.
 *
 * This parses the stylesheets as text — no browser, no CSS engine — so it holds
 * in CI regardless of which framework renders the mark-up.
 */

const STYLES = join(process.cwd(), 'src/styles');

interface Rule {
  file: string;
  selectors: string[];
  body: string;
}

function readRules(): Rule[] {
  const rules: Rule[] = [];
  for (const file of readdirSync(STYLES).filter((name) => name.endsWith('.css'))) {
    const css = readFileSync(join(STYLES, file), 'utf8');
    // Strip comments first so selector text inside a comment cannot match.
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      rules.push({
        file,
        selectors: match[1]
          .split(',')
          .map((selector) => selector.trim())
          .filter(Boolean),
        body: match[2],
      });
    }
  }
  return rules;
}

/** Selectors whose entire job is to show a value the user compares or copies. */
const MONO_BELOW_12_ALLOWED = new Set(['.kbd', '.mono', '.numeric']);

const sizeInPx = (value: string): number | null => {
  const trimmed = value.trim();
  if (trimmed.endsWith('px')) return Number.parseFloat(trimmed);
  if (trimmed === 'var(--text-2xs)') return 12;
  if (trimmed === 'var(--text-xs)') return 11;
  if (trimmed === 'var(--text-sm)') return 13;
  return null;
};

describe('typography rules', () => {
  const rules = readRules();

  it('never sets mono text below 12px outside value-only selectors', () => {
    const offenders = rules.flatMap((rule) => {
      if (!rule.body.includes('font-family: var(--font-mono)')) return [];
      const size = rule.body.match(/font-size:\s*([^;]+);/);
      if (!size) return [];
      const px = sizeInPx(size[1]);
      if (px === null || px >= 12) return [];
      return rule.selectors.filter((selector) => !MONO_BELOW_12_ALLOWED.has(selector)).map(
        (selector) => `${rule.file} → ${selector} (${size[1].trim()})`,
      );
    });

    expect(offenders).toEqual([]);
  });

  it('keeps every label selector on the sans face', () => {
    // Labels share one visual language: sans, letterspaced caps, ≥12px.
    const labels = [
      '.eyebrow',
      '.badge',
      '.segmented__option',
      '.crumbs',
      '.section-title',
      '.settings__head',
      '.footer-col h4',
      '.compare__label',
      '.stat__label',
      '.kv__key',
      '.manifest__head',
      '.doc-table th',
    ];
    const offenders = rules.flatMap((rule) =>
      rule.selectors
        .filter((selector) => labels.includes(selector))
        .filter(() => rule.body.includes('font-family: var(--font-mono)'))
        .map((selector) => `${rule.file} → ${selector}`),
    );

    expect(offenders).toEqual([]);
  });

  it('has no literal white overlay outside the token layer', () => {
    const offenders = rules
      .filter((rule) => rule.file !== 'tokens.css')
      .filter((rule) => /rgba\(\s*255\s*,\s*255\s*,\s*255/.test(rule.body))
      .map((rule) => `${rule.file} → ${rule.selectors.join(', ')}`);

    expect(offenders).toEqual([]);
  });
});
