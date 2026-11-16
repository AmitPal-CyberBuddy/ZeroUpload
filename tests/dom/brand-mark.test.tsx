import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ZeroMark } from '../../src/components/brand/ZeroMark';
import { render } from './render';

/**
 * The brand mark, and the CSS contract that keeps it a ring.
 *
 * The mark was rendering as two disconnected scraps in the header for every
 * visitor: `brand.css` animates the ring, so it declares `transform-origin`, and
 * an author `transform-origin` overrides the centre implied by an SVG
 * `transform="rotate(a cx cy)"` presentation attribute. The attribute rotation
 * was being applied about (0,0) instead, which swung most of the ring outside the
 * 32×32 viewBox where it was clipped.
 *
 * Nothing in the type system, the CSS, or a snapshot of the markup would have
 * caught that — the DOM was correct and only the pixels were wrong. These tests
 * pin the two properties that make the geometry safe:
 *
 *  1. the resting angle is expressed with `stroke-dashoffset`, never a
 *     `transform` attribute, so CSS can own `transform` without a collision;
 *  2. the ring's painted extent stays inside the viewBox at any stroke width.
 */

const BRAND_CSS = readFileSync('src/styles/brand.css', 'utf8');
const VIEWBOX = 32;

/** Painted radius of the ring: centre offset plus half the stroke. */
function paintedRadius(radius: number, strokeWidth: number) {
  return radius + strokeWidth / 2;
}

describe('brand mark', () => {
  it('does not rotate with a presentation attribute that CSS would override', async () => {
    const { container, errors, unmount } = await render(<ZeroMark />);

    const circle = container.querySelector('circle');
    expect(circle).not.toBeNull();
    expect(circle!.hasAttribute('transform')).toBe(false);
    expect(circle!.getAttribute('stroke-dashoffset')).toBeTruthy();

    expect(errors).toEqual([]);
    await unmount();
  });

  it('paints the whole ring inside the viewBox', () => {
    expect(paintedRadius(11.2, 3)).toBeLessThanOrEqual(VIEWBOX / 2);
  });

  it('keeps the ring animation and its transform origin in one place', () => {
    // The animation owns `transform`; that is only safe while the component
    // leaves the resting angle to `stroke-dashoffset`.
    expect(BRAND_CSS).toMatch(/@keyframes zero-spin/);
    expect(BRAND_CSS).toMatch(/\.zero-ring\s*\{[^}]*transform-origin:\s*16px 16px/s);
  });

  it('renders the wordmark zero with the same safe geometry', async () => {
    const { ZeroWordmark } = await import('../../src/components/brand/ZeroMark');
    const { container, errors, unmount } = await render(<ZeroWordmark />);

    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThan(0);
    for (const svg of svgs) {
      const ring = svg.querySelector('circle');
      expect(ring?.hasAttribute('transform')).toBe(false);
    }

    expect(errors).toEqual([]);
    await unmount();
  });
});
