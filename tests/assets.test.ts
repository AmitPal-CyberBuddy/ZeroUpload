import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The web app manifest is referenced from every page's `<head>` and nothing in the
 * build verifies it: a wrong path or a mismatched `sizes` value fails silently, and
 * the only symptom is a blurry home-screen icon on someone's phone.
 *
 * These checks are possible because the icons are generated (`scripts/make-icons.mjs`)
 * and the manifest is a static file — so the two can be compared as data.
 */

const root = process.cwd();
const publicDir = join(root, 'public');
const manifestPath = join(publicDir, 'site.webmanifest');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
  start_url: string;
  scope: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
  theme_color: string;
  display: string;
};

/** Width and height from an IHDR chunk. */
function pngSize(file: string): { width: number; height: number } {
  const buffer = readFileSync(file);
  const signature = buffer.subarray(0, 8).toString('hex');
  expect(signature, `${file} should be a PNG`).toBe('89504e470d0a1a0a');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

describe('web app manifest', () => {
  it('uses relative URLs so it works from a project subpath', () => {
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
    for (const icon of manifest.icons) expect(icon.src.startsWith('./')).toBe(true);
  });

  it('points at icons that exist and are the size it claims', () => {
    for (const icon of manifest.icons) {
      const file = join(publicDir, icon.src.replace('./', ''));
      expect(existsSync(file), icon.src).toBe(true);

      const [width, height] = icon.sizes.split('x').map(Number);
      const actual = pngSize(file);
      expect(actual, icon.src).toEqual({ width, height });
    }
  });

  it('offers the two sizes Android asks for, and a maskable variant', () => {
    const sizes = manifest.icons.map((icon) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });

  it('keeps the splash and theme colour on the product ink', () => {
    expect(manifest.theme_color).toBe('#08090b');
    expect(manifest.display).toBe('standalone');
  });

  it('ships an apple-touch-icon at the size iOS wants', () => {
    // It used to be `og.png` — a 1200×630 social card, which iOS letterboxes.
    const touch = join(publicDir, 'apple-touch-icon.png');
    expect(existsSync(touch)).toBe(true);
    expect(pngSize(touch)).toEqual({ width: 180, height: 180 });
  });

  it('links the manifest and the touch icon from the shell', () => {
    const shell = readFileSync(join(root, 'index.html'), 'utf8');
    expect(shell).toContain('<link rel="manifest" href="./site.webmanifest" />');
    expect(shell).toContain('rel="apple-touch-icon"');
    expect(shell).not.toMatch(/apple-touch-icon"[^>]*og\.png/);
  });
});
