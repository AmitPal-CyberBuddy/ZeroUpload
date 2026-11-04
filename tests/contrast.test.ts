import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Contrast, computed from the tokens themselves.
 *
 * The earlier manual pass measured *resting* states and therefore missed the
 * primary button's hover colour, which mixed the light accent toward white and
 * landed at 4.0:1 under a white label. Reading the values out of `tokens.css` and
 * doing the WCAG arithmetic here means every theme/state pair that can be
 * expressed as two hex values is checked on every run, in both themes.
 *
 * Only literal hex tokens can be checked this way, which is the point: it keeps
 * the palette answerable. Derived colours (`color-mix`, `rgba`) are not ratios
 * anyone can guarantee, and the fix for the button was to name the value.
 */

const tokens = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');

/** Split the file into the dark (`:root`) and light (`[data-theme='light']`) blocks. */
function themeBlocks(): { dark: Record<string, string>; light: Record<string, string> } {
  const darkStart = tokens.indexOf(':root {');
  const lightStart = tokens.indexOf(":root[data-theme='light']");
  const darkBlock = tokens.slice(darkStart, lightStart);
  const lightBlock = tokens.slice(lightStart);

  const collect = (block: string): Record<string, string> => {
    const found: Record<string, string> = {};
    for (const match of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) {
      found[match[1]] = match[2];
    }
    return found;
  };

  return { dark: collect(darkBlock), light: collect(lightBlock) };
}

const channel = (value: number): number => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Body-size text needs 4.5:1; large text and UI edges need 3:1. */
const AA_TEXT = 4.5;

interface Pair {
  name: string;
  fg: string;
  bg: string;
  min?: number;
}

function pairsFor(theme: Record<string, string>): Pair[] {
  return [
    // Body text on the three surfaces it actually sits on.
    { name: 'text on bg', fg: theme.text, bg: theme.bg },
    { name: 'text on surface', fg: theme.text, bg: theme.surface },
    { name: 'text-secondary on bg', fg: theme['text-secondary'], bg: theme.bg },
    { name: 'text-secondary on surface', fg: theme['text-secondary'], bg: theme.surface },
    { name: 'text-secondary on surface-2', fg: theme['text-secondary'], bg: theme['surface-2'] },
    { name: 'text-muted on surface-2', fg: theme['text-muted'], bg: theme['surface-2'] },

    // The primary button, at rest *and* on hover — the state that regressed.
    { name: 'on-accent on accent', fg: theme['on-accent'], bg: theme.accent },
    { name: 'on-accent on accent-hover', fg: theme['on-accent'], bg: theme['accent-hover'] },

    // Accent text (links, values) on the surfaces it is used on.
    { name: 'accent on bg', fg: theme.accent, bg: theme.bg },
    { name: 'accent on surface', fg: theme.accent, bg: theme.surface },

    // Status colours carry meaning, so they have to be readable.
    { name: 'danger on surface', fg: theme.danger, bg: theme.surface },
    { name: 'warn on surface', fg: theme.warn, bg: theme.surface },
  ];
}

describe('contrast', () => {
  const { dark, light } = themeBlocks();

  it('reads both theme blocks', () => {
    for (const key of ['text', 'bg', 'surface', 'accent', 'accent-hover', 'on-accent']) {
      expect(dark[key], `dark --${key}`).toBeTruthy();
      expect(light[key], `light --${key}`).toBeTruthy();
    }
  });

  for (const [name, theme] of Object.entries({ dark, light })) {
    it(`meets WCAG AA in the ${name} theme`, () => {
      const failures = pairsFor(theme)
        .map((pair) => ({ ...pair, ratio: contrast(pair.fg, pair.bg) }))
        .filter((pair) => pair.ratio < (pair.min ?? AA_TEXT))
        .map((pair) => `${pair.name}: ${pair.ratio.toFixed(2)}:1 (needs ${pair.min ?? AA_TEXT})`);

      expect(failures).toEqual([]);
    });
  }

  it('keeps hover distinct enough to be visible but not a contrast regression', () => {
    // A hover that is identical to rest is not a hover; one that moves the ratio
    // by more than a few tenths is usually one theme borrowing the other's maths.
    for (const [name, theme] of Object.entries({ dark, light })) {
      const rest = contrast(theme['on-accent'], theme.accent);
      const hover = contrast(theme['on-accent'], theme['accent-hover']);
      expect(theme['accent-hover'], `${name} hover colour`).not.toBe(theme.accent);
      expect(hover, `${name} hover`).toBeGreaterThanOrEqual(AA_TEXT);
      expect(Math.abs(hover - rest), `${name} hover shift`).toBeLessThan(2);
    }
  });
});
