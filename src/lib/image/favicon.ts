/**
 * Favicon set definition: which sizes are generated, how the files are named,
 * and the two text files that make the set usable (`site.webmanifest` and the
 * `<head>` snippet).
 *
 * Pure and DOM-free, like `ico.ts`, so the exact snippets shipped to users are
 * asserted in the test suite rather than trusted.
 */

/** Sizes embedded in `favicon.ico` — browser tabs, bookmarks, Windows shell. */
export const ICO_SIZES = [16, 32, 48, 256] as const;

/** Standalone PNG links for modern browsers that prefer them over `.ico`. */
export const PNG_SIZES = [16, 32] as const;

/** iOS home-screen icon. 180 is what Safari actually asks for. */
export const APPLE_TOUCH_SIZE = 180;

/** Manifest icons. 192 and 512 are the two sizes installability requires. */
export const MANIFEST_SIZES = [192, 512] as const;

/**
 * The largest edge rendered from the source. Everything smaller is derived from
 * this one decode, so a 20 MP photo is decoded once instead of seven times.
 */
export const BASE_SIZE = 512;

/** Matches the app's own dark base; a neutral default for someone else's site. */
export const DEFAULT_THEME_COLOR = '#08090b';

/** Every size the generator needs, ascending and de-duplicated. */
export function iconSizes(): number[] {
  return [...new Set<number>([...ICO_SIZES, ...PNG_SIZES, APPLE_TOUCH_SIZE, ...MANIFEST_SIZES, BASE_SIZE])].sort(
    (a, b) => a - b,
  );
}

/**
 * Sizes written as their own PNG file. `favicon.ico` already carries 16/32/48/256,
 * so only the sizes something else links to get a separate file.
 */
export function standaloneIconSizes(): number[] {
  return [...new Set<number>([...PNG_SIZES, APPLE_TOUCH_SIZE, ...MANIFEST_SIZES])].sort((a, b) => a - b);
}

export function pngFileName(size: number): string {
  return `icon-${size}.png`;
}

export function icoFileName(): string {
  return 'favicon.ico';
}

export function appleTouchFileName(): string {
  return 'apple-touch-icon.png';
}

export function manifestFileName(): string {
  return 'site.webmanifest';
}

export interface ManifestOptions {
  name?: string;
  shortName?: string;
  themeColor?: string;
}

/**
 * A minimal, valid web app manifest.
 *
 * `start_url` is `./` rather than `/` on purpose: the same file then works when
 * the site lives under a project path (GitHub Pages does exactly that).
 */
export function buildWebManifest(options: ManifestOptions = {}): string {
  const name = options.name?.trim() || 'My site';
  const shortName = options.shortName?.trim() || name;
  const themeColor = options.themeColor?.trim() || DEFAULT_THEME_COLOR;

  return `${JSON.stringify(
    {
      name,
      short_name: shortName,
      start_url: './',
      display: 'standalone',
      background_color: themeColor,
      theme_color: themeColor,
      icons: MANIFEST_SIZES.map((size) => ({
        src: pngFileName(size),
        sizes: `${size}x${size}`,
        type: 'image/png',
      })),
    },
    null,
    2,
  )}\n`;
}

/**
 * The `<head>` markup for the generated set. Relative paths, so it works under a
 * subdirectory. PNG links come first because browsers prefer a PNG `rel=icon`
 * at the size they need, and `.ico` stays as the fallback for older browsers.
 */
export function buildHeadSnippet(options: ManifestOptions = {}): string {
  const themeColor = options.themeColor?.trim() || DEFAULT_THEME_COLOR;
  return [
    ...PNG_SIZES.map(
      (size) => `<link rel="icon" type="image/png" sizes="${size}x${size}" href="${pngFileName(size)}" />`,
    ),
    `<link rel="icon" href="${icoFileName()}" sizes="any" />`,
    `<link rel="apple-touch-icon" sizes="${APPLE_TOUCH_SIZE}x${APPLE_TOUCH_SIZE}" href="${appleTouchFileName()}" />`,
    `<link rel="manifest" href="${manifestFileName()}" />`,
    `<meta name="theme-color" content="${themeColor}" />`,
  ].join('\n');
}
