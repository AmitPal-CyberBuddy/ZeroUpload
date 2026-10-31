/**
 * Where the site lives.
 *
 * Two audiences read this module:
 *
 *  - the build (prerendering, sitemap, canonical URLs), where an absolute origin
 *    is mandatory, and
 *  - the browser (SPA navigation), where the origin is whatever the page was
 *    actually served from.
 *
 * The build is told the origin through `SITE_URL`; the runtime derives it from
 * `location`. That way a custom domain or a project subpath never needs a code
 * change, and the prerendered canonical can be overridden by one environment
 * variable at deploy time.
 */

/** Repository Pages URL. Override with `SITE_URL` when deploying elsewhere. */
const DEFAULT_SITE_URL = 'https://amitpal-cyberbuddy.github.io/ZeroUpload';

/** Absolute origin + root path, without a trailing slash. */
export function siteUrl(): string {
  const fromEnv =
    typeof process !== 'undefined' && process.env && process.env.SITE_URL
      ? process.env.SITE_URL
      : undefined;
  return (fromEnv || DEFAULT_SITE_URL).replace(/\/+$/, '');
}

/**
 * Absolute URL for a canonical path such as `/tools/merge-pdf/`.
 * `siteUrl()` already carries the deploy root, so the path is appended as-is.
 */
export function absoluteUrl(path: string): string {
  return `${siteUrl()}${path}`;
}

/**
 * Path prefix the site is served from, with a trailing slash: `/` at a domain
 * root, `/ZeroUpload/` under a GitHub project URL.
 *
 * In a production build it is derived from the URL of the bundle itself, which
 * lands in `<root>/assets/`, so the same artifact works at any prefix. In dev
 * and in the SSR build it comes from Vite's BASE_URL.
 */
export function deployBase(): string {
  try {
    const own = new URL(import.meta.url).pathname;
    const marker = own.lastIndexOf('/assets/');
    if (marker >= 0) return own.slice(0, marker + 1);
  } catch {
    /* import.meta.url is not always available (older bundlers, tests) */
  }
  const base = import.meta.env?.BASE_URL ?? '/';
  return base.endsWith('/') ? base : `${base}/`;
}

/**
 * Canonical form of a route: leading and trailing slash, no duplicate slashes.
 * GitHub Pages 301s a directory URL without the trailing slash, so every
 * canonical, sitemap entry and internal link uses the slashed form.
 */
export function canonicalPath(path: string): string {
  const trimmed = path.replace(/\/{2,}/g, '/').replace(/^\/?/, '/').replace(/\/*$/, '/');
  return trimmed === '//' ? '/' : trimmed;
}

/** `/tools/x` → `/tools/x/`, `/` → `/`. */
export function toolPath(slug: string): string {
  return canonicalPath(`/tools/${slug}/`);
}
