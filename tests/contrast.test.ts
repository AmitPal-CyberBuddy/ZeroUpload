import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Contrast, computed from the tokens themselves.
 *
 * Two findings came out of the same blind spot: audits that sample *resting*
 * colours miss the states where the value actually changes.
 *
 *   1. The primary button's hover mixed the light accent toward white and landed
 *      at 4.0:1 under a white label. Hover is now its own token per theme.
 *   2. The focus ring was drawn with `--accent-line`, a 32%-opacity accent. Over
 *      the dark background that composites to 2.32:1, and over light mode's near
 *      white, 1.38:1 — under the 3:1 that WCAG 2.2 requires of a focus indicator
 *      (SC 1.4.11), for the one element that tells a keyboard user where they are.
 *
 * Both were arithmetic errors, not taste, so both are pinned here: the tokens are
 * read out of `tokens.css`, `var()` chains are resolved, translucent colours are
 * composited, and every text/surface and indicator/surface pair is checked.
 *
 * Only values that can be resolved to a colour are checked, which is the point:
 * it keeps the palette answerable instead of hiding meaning inside a `color-mix`.
 */

const tokens = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');

type Palette = Record<string, string>;

/** Split the file into the dark (`:root`) and light (`[data-theme='light']`) blocks. */
function themeBlocks(): { dark: Palette; light: Palette } {
  const lightStart = tokens.indexOf(":root[data-theme='light']");
  if (lightStart === -1) throw new Error('could not find the light theme block');

  const collect = (block: string): Palette => {
    const found: Palette = {};
    for (const match of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
      found[match[1]] = match[2].trim();
    }
    return found;
  };

  return {
    dark: collect(tokens.slice(tokens.indexOf(':root {'), lightStart)),
    light: collect(tokens.slice(lightStart)),
  };
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGBA = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i;

interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColour(value: string): Rgb | null {
  const hex = value.trim();
  if (HEX.test(hex)) {
    const h = hex.slice(1);
    const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
    return {
      r: Number.parseInt(full.slice(0, 2), 16),
      g: Number.parseInt(full.slice(2, 4), 16),
      b: Number.parseInt(full.slice(4, 6), 16),
      a: 1,
    };
  }
  const rgba = RGBA.exec(hex);
  if (!rgba) return null;
  return {
    r: Number(rgba[1]),
    g: Number(rgba[2]),
    b: Number(rgba[3]),
    a: rgba[4] === undefined ? 1 : Number(rgba[4]),
  };
}

/** Follow `var(--x)` chains until something colour-shaped appears. */
function resolve(palette: Palette, name: string, depth = 0): Rgb | null {
  if (depth > 8) return null;
  const raw = palette[name];
  if (!raw) return null;

  const varRef = /^var\(--([\w-]+)\)$/.exec(raw.trim());
  if (varRef) return resolve(palette, varRef[1], depth + 1);

  return parseColour(raw);
}

/** Paint a possibly translucent colour onto an opaque one, the way a browser would. */
function over(fg: Rgb, bg: Rgb): Rgb {
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

const channel = (value: number): number => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

function luminance({ r, g, b }: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Body-size text needs 4.5:1; indicators and large text need 3:1. */
const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

interface Pair {
  name: string;
  fg: string;
  bg: string;
  min: number;
}

const TEXT_PAIRS: Pair[] = [
  { name: 'text on bg', fg: 'text', bg: 'bg', min: AA_TEXT },
  { name: 'text on surface', fg: 'text', bg: 'surface', min: AA_TEXT },
  { name: 'text-secondary on bg', fg: 'text-secondary', bg: 'bg', min: AA_TEXT },
  { name: 'text-secondary on surface', fg: 'text-secondary', bg: 'surface', min: AA_TEXT },
  { name: 'text-secondary on surface-2', fg: 'text-secondary', bg: 'surface-2', min: AA_TEXT },
  { name: 'text-muted on surface-2', fg: 'text-muted', bg: 'surface-2', min: AA_TEXT },

  // The primary button, at rest *and* on hover — the state that regressed.
  { name: 'on-accent on accent', fg: 'on-accent', bg: 'accent', min: AA_TEXT },
  { name: 'on-accent on accent-hover', fg: 'on-accent', bg: 'accent-hover', min: AA_TEXT },

  // Accent text (links, values) on the surfaces it is used on.
  { name: 'accent on bg', fg: 'accent', bg: 'bg', min: AA_TEXT },
  { name: 'accent on surface', fg: 'accent', bg: 'surface', min: AA_TEXT },

  // Status colours carry meaning, so they have to be readable.
  { name: 'danger on surface', fg: 'danger', bg: 'surface', min: AA_TEXT },
  { name: 'warn on surface', fg: 'warn', bg: 'surface', min: AA_TEXT },
];

const INDICATOR_PAIRS: Pair[] = [
  { name: 'focus ring on bg', fg: 'focus-ring-color', bg: 'bg', min: AA_NON_TEXT },
  { name: 'focus ring on surface', fg: 'focus-ring-color', bg: 'surface', min: AA_NON_TEXT },
  { name: 'focus ring on surface-2', fg: 'focus-ring-color', bg: 'surface-2', min: AA_NON_TEXT },
];

describe('contrast', () => {
  const { dark, light } = themeBlocks();
  const themes: [string, Palette][] = [
    ['dark', dark],
    ['light', light],
  ];

  it('reads both theme blocks', () => {
    for (const key of ['text', 'bg', 'surface', 'accent', 'accent-hover', 'on-accent', 'focus-ring-color']) {
      expect(dark[key], `dark --${key}`).toBeTruthy();
      expect(light[key], `light --${key}`).toBeTruthy();
    }
  });

  it('resolves every checked token to a colour', () => {
    for (const [theme, palette] of themes) {
      for (const pair of [...TEXT_PAIRS, ...INDICATOR_PAIRS]) {
        for (const key of [pair.fg, pair.bg]) {
          expect(resolve(palette, key), `${theme} --${key}`).not.toBeNull();
        }
      }
    }
  });

  for (const [theme, palette] of themes) {
    it(`meets WCAG AA in the ${theme} theme`, () => {
      const failures = [...TEXT_PAIRS, ...INDICATOR_PAIRS]
        .map((pair) => {
          const bg = resolve(palette, pair.bg)!;
          const fg = over(resolve(palette, pair.fg)!, bg);
          return { ...pair, ratio: ratio(fg, bg) };
        })
        .filter((pair) => pair.ratio < pair.min)
        .map((pair) => `${pair.name}: ${pair.ratio.toFixed(2)}:1 (needs ${pair.min}:1)`);

      expect(failures).toEqual([]);
    });
  }

  it('draws the focus ring with a solid colour, not the decorative accent line', () => {
    // `--accent-line` is a 32%-opacity accent meant for hairline borders. Reusing it
    // for focus is exactly how the 2.32:1 ring happened.
    for (const [theme, palette] of themes) {
      expect(palette['focus-ring'], `${theme} --focus-ring`).toContain('var(--focus-ring-color)');
    }
  });

  it('keeps hover distinct enough to be visible but not a contrast regression', () => {
    // A hover that is identical to rest is not a hover; one that moves the ratio
    // by more than a couple of tenths is usually one theme borrowing the other's maths.
    for (const [theme, palette] of themes) {
      const label = resolve(palette, 'on-accent')!;
      const rest = ratio(label, resolve(palette, 'accent')!);
      const hover = ratio(label, resolve(palette, 'accent-hover')!);
      expect(palette['accent-hover'], `${theme} hover colour`).not.toBe(palette.accent);
      expect(hover, `${theme} hover`).toBeGreaterThanOrEqual(AA_TEXT);
      expect(Math.abs(hover - rest), `${theme} hover shift`).toBeLessThan(2);
    }
  });
});
