/**
 * Head-tag generation, shared by the prerenderer and the running app.
 *
 * The same functions produce the static `<head>` at build time and patch it
 * during client-side navigation, so a crawler and a visitor who clicks through
 * the site see identical metadata.
 */
import { canonicalPath, deployBase, siteUrl } from './site';
import type { PageMeta } from './pages';

const SITE_NAME = 'ZeroUpload';
const OG_IMAGE_PATH = '/og.png';
const OG_IMAGE_ALT =
  'ZeroUpload — a private file toolkit. Convert, compress, transform, protect and inspect files in the browser.';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Origin plus deploy root, without a trailing slash. */
export function siteRoot(): string {
  const base = typeof siteUrl === 'function' ? siteUrl() : '';
  return base.replace(/\/+$/, '');
}

/** Absolute URL used for canonicals and Open Graph tags. */
export function absoluteFor(path: string, root: string): string {
  const base = root.replace(/\/+$/, '');
  return `${base}${canonicalPath(path)}`;
}

/**
 * Canonical root as seen by the browser: whatever origin and subdirectory the
 * page was actually served from. Falls back to the configured site URL during
 * prerendering, where there is no `location`.
 */
export function currentRoot(): string {
  if (typeof location !== 'undefined' && location.origin) {
    return `${location.origin}${deployBase()}`.replace(/\/+$/, '');
  }
  return siteRoot();
}

/**
 * Full `<head>` metadata block for one page.
 *
 * `robots` is explicit on every page: indexable pages opt into large image
 * previews, and only pages that must stay out of the index are marked noindex.
 */
export function headTags(meta: PageMeta, path: string, root = currentRoot()): string {
  const url = absoluteFor(path, root);
  const image = `${root.replace(/\/+$/, '')}${OG_IMAGE_PATH}`;
  const robots = meta.noindex
    ? 'noindex, follow'
    : 'index, follow, max-image-preview:large, max-snippet:-1';

  return [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    `<meta name="robots" content="${robots}" />`,
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:locale" content="en" />`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta property="og:image" content="${escapeHtml(image)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${escapeHtml(OG_IMAGE_ALT)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(image)}" />`,
  ].join('\n    ');
}

/** Replace <head> metadata in place, for client-side navigation. */
export function applyMeta(meta: PageMeta, path: string): void {
  if (typeof document === 'undefined') return;
  const root = currentRoot();
  const url = absoluteFor(path, root);

  document.title = meta.title;
  setNamed('meta', 'description', meta.description);
  setNamed(
    'meta',
    'robots',
    meta.noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large, max-snippet:-1',
  );
  setProperty('og:title', meta.title);
  setProperty('og:description', meta.description);
  setProperty('og:url', url);
  setProperty('twitter:title', meta.title);
  setProperty('twitter:description', meta.description);

  let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.rel = 'canonical';
    document.head.appendChild(canonical);
  }
  canonical.href = url;
}

function setNamed(tag: 'meta', name: string, value: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`${tag}[name="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.name = name;
    document.head.appendChild(el);
  }
  el.content = value;
}

function setProperty(property: string, value: string): void {
  const isTwitter = property.startsWith('twitter:');
  const attr = isTwitter ? 'name' : 'property';
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${property}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, property);
    document.head.appendChild(el);
  }
  el.content = value;
}

/**
 * Replaces (or removes) the page's JSON-LD block.
 *
 * The prerendered document already carries the right markup; this keeps it
 * accurate when the visitor moves between pages without a reload, so the
 * structured data never describes a page that is no longer on screen.
 */
export function applyStructuredData(json: string | null): void {
  if (typeof document === 'undefined') return;
  const existing = document.head.querySelector('script[type="application/ld+json"]');

  if (!json) {
    existing?.remove();
    return;
  }

  if (existing) {
    existing.textContent = json;
    return;
  }

  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.textContent = json;
  document.head.appendChild(script);
}
