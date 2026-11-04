import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The motion budget from the UX audit, as a test.
 *
 * Three rules, each of which used to be false:
 *
 *  1. Nothing that is not an indeterminate indicator may animate longer than
 *     `--dur-slow` (320 ms), and only those indicators may loop forever.
 *  2. Durations come from the token set. A raw `700ms` in a rule is how the hero
 *     drifted to a one-second entrance in the first place.
 *  3. The hero is a sequence, so its cost is the sum of its delays and the last
 *     duration. That sum is asserted, not eyeballed.
 *
 * It parses the stylesheets as text, so it holds whatever renders them.
 */

const STYLES = join(process.cwd(), 'src/styles');

const read = (file: string) => readFileSync(join(STYLES, file), 'utf8');
const tokens = read('tokens.css');

function tokenMs(name: string): number {
  const match = tokens.match(new RegExp(`--${name}:\\s*(\\d+)ms`));
  if (!match) throw new Error(`token --${name} is not defined in tokens.css`);
  return Number(match[1]);
}

interface Rule {
  file: string;
  selector: string;
  body: string;
}

function rules(file: string): Rule[] {
  const clean = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
  return [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    file,
    selector: match[1].trim().split(/\s+/).join(' '),
    body: match[2],
  }));
}

const allRules = readdirSync(STYLES)
  .filter((name) => name.endsWith('.css'))
  .flatMap(rules);

/**
 * Indicators are the one exception to both rules: they loop because their job is
 * to say "still working", and their timing is set by physics rather than by the
 * budget — a spinner at 320 ms per turn would look stopped.
 */
const INDICATORS = [
  '.spinner', // indeterminate progress
  '.progress--indeterminate .progress__bar', // indeterminate progress
  '.zero-ring--active', // the mark while a file is being processed
  '.skeleton', // placeholder while a chunk loads
];

const isIndicator = (selector: string) =>
  selector.split(',').some((part) => {
    const clean = part.trim().replace(/\s*[>]\s*/g, ' ');
    return INDICATORS.some((indicator) => clean === indicator || clean.endsWith(` ${indicator}`) || clean === indicator);
  });

describe('motion budget', () => {
  it('keeps the ceiling at or under 320ms of animation', () => {
    const ceiling = 320;
    for (const token of ['dur-fast', 'dur-base', 'dur-enter', 'dur-slow']) {
      expect(tokenMs(token)).toBeLessThanOrEqual(ceiling);
    }
  });

  it('only lets state indicators loop', () => {
    const offenders = allRules
      .filter((rule) => /animation:[^;]*infinite/.test(rule.body) && !isIndicator(rule.selector))
      .map((rule) => `${rule.file} → ${rule.selector}`);

    expect(offenders).toEqual([]);
  });

  it('takes every animation duration from a token or from an indicator', () => {
    const offenders = allRules
      .filter((rule) => /(^|[^-])animation:/.test(rule.body) && !isIndicator(rule.selector))
      .filter((rule) => /\b\d+(\.\d+)?m?s\b/.test(rule.body.split('animation:')[1]?.split(';')[0] ?? ''))
      .map((rule) => `${rule.file} → ${rule.selector}`);

    expect(offenders).toEqual([]);
  });

  it('finishes the whole hero sequence within the budget', () => {
    const enter = tokenMs('dur-enter');
    const step = tokenMs('stagger-step');

    /** Evaluate the delay slot of a hero `animation:` shorthand. */
    const delayOf = (body: string): number => {
      const value = body.match(/animation:([^;]+);/)?.[1] ?? '';
      const parts = value.trim().split(/\s+/);
      // fade-up <duration> <easing> [delay] both
      const delay = parts.slice(3, -1).join(' ');
      if (!delay) return 0;
      const multiplied = delay.match(/calc\(var\(--stagger-step\)\s*\*\s*([\d.]+)\)/);
      if (multiplied) return step * Number(multiplied[1]);
      if (delay.includes('var(--stagger-step)')) return step;
      const raw = delay.match(/^(\d+)ms$/);
      if (raw) return Number(raw[1]);
      throw new Error(`unparseable hero delay: ${delay}`);
    };

    const heroRules = rules('pages.css').filter(
      (rule) => rule.selector.startsWith('.hero') && /animation:/.test(rule.body),
    );

    expect(heroRules.length).toBeGreaterThan(0);

    const end = Math.max(...heroRules.map((rule) => delayOf(rule.body) + enter));
    expect(end).toBeLessThanOrEqual(320);
  });

  it('leaves no animation pending when the reader asks for reduced motion', () => {
    // With `both`, a pending delay pins an element at its `from` state, so zeroing
    // the duration alone would hide staggered content and then snap it in.
    const base = read('base.css');
    const block = base.slice(base.indexOf('@media (prefers-reduced-motion: reduce)'));

    expect(block).toContain('animation-duration: 0.001ms !important');
    expect(block).toContain('animation-delay: 0ms !important');
    expect(block).toContain('transition-delay: 0ms !important');
  });
});
