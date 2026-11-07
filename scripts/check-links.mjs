/**
 * Internal-link audit for the built site.
 *
 * Runs after prerendering, against the real `dist/` output rather than against
 * components, so it sees exactly what a crawler sees:
 *
 *   - every internal href resolves to a file that exists (no dead links, and no
 *     link that only works because GitHub Pages 404s to a fallback);
 *   - internal links use the canonical form (one trailing slash), so no crawl
 *     spends a 301 on every navigation;
 *   - anchors describe their destination ("merge PDFs", not "click here");
 *   - no page is orphaned — everything in the sitemap is reachable by links.
 *
 * Exits non-zero on any failure, so the build stops rather than shipping a site
 * with a broken link graph.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

const SITE_URL = (process.env.SITE_URL || 'https://amitpal-cyberbuddy.github.io/ZeroUpload').replace(
  /\/+$/,
  '',
);
const SITE_ORIGIN = new URL(SITE_URL).origin;
/** Path the site is served from: '' at a domain root, '/ZeroUpload' on Pages. */
const ROOT_PATH = new URL(SITE_URL).pathname.replace(/\/+$/, '');

const VAGUE_ANCHORS = new Set(['click here', 'here', 'read more', 'link', 'this', 'more', 'learn more']);

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

/** dist/tools/pdf/index.html → /tools/pdf/ */
function urlPathFor(file) {
  const rel = relative(dist, file).split(sep).join('/');
  if (rel === 'index.html') return '/';
  return `/${rel.replace(/(^|\/)index\.html$/, '$1')}`;
}

async function targetExists(urlPath) {
  const clean = urlPath.replace(/^\/+|\/+$/g, '');
  const candidates = clean === '' ? ['index.html'] : [`${clean}/index.html`, clean, `${clean}.html`];
  for (const candidate of candidates) {
    try {
      const info = await stat(join(dist, candidate));
      if (info.isFile()) return true;
    } catch {
      /* try the next shape */
    }
  }
  return false;
}

const files = await walk(dist);
const pages = files.map((file) => ({ file, path: urlPathFor(file) }));
const inbound = new Map(pages.map((page) => [page.path, new Set()]));

const errors = [];
const warnings = [];
let links = 0;

for (const page of pages) {
  const html = await readFile(page.file, 'utf8');
  const anchors = [...html.matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];

  for (const [, rawHref, inner] of anchors) {
    const href = rawHref.replace(/&amp;/g, '&');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;

    const text = inner
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();

    let url;
    try {
      url = new URL(href, `${SITE_ORIGIN}${ROOT_PATH}${page.path}`);
    } catch {
      errors.push(`${page.path}: unparseable href "${href}"`);
      continue;
    }

    if (url.origin !== SITE_ORIGIN) continue; // external link, not our graph

    links += 1;

    if (!url.pathname.startsWith(`${ROOT_PATH}/`) && url.pathname !== `${ROOT_PATH}/`) {
      errors.push(`${page.path}: "${href}" points outside the deploy root ${ROOT_PATH}/`);
      continue;
    }

    const target = url.pathname.slice(ROOT_PATH.length) || '/';
    const hasCanonicalShape = target === '/' || target.endsWith('/');

    if (!hasCanonicalShape && !target.includes('.')) {
      warnings.push(`${page.path}: "${href}" is missing its trailing slash (GitHub Pages would 301)`);
    }

    if (!(await targetExists(target))) {
      errors.push(`${page.path}: "${href}" → ${target} does not exist`);
      continue;
    }

    if (text && VAGUE_ANCHORS.has(text.toLowerCase())) {
      errors.push(`${page.path}: vague anchor text "${text}" for ${target}`);
    }

    if (!text) {
      errors.push(`${page.path}: link to ${target} has no anchor text`);
    }

    if (inbound.has(target) && target !== page.path) inbound.get(target).add(page.path);
  }
}

/* Orphans: an indexable page nobody links to is only reachable via the sitemap. */
let sitemapPages = [];
try {
  const sitemap = await readFile(join(dist, 'sitemap.xml'), 'utf8');
  sitemapPages = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    ([, loc]) => (new URL(loc).pathname.slice(ROOT_PATH.length) || '/'),
  );
} catch {
  errors.push('dist/sitemap.xml is missing');
}

for (const path of sitemapPages) {
  if (path === '/') continue;
  const sources = inbound.get(path);
  if (!sources || sources.size === 0) errors.push(`${path}: no internal links point at this page`);
}

/* Every HTML page except the redirect stub and the 404 should be in the sitemap. */
const notInSitemap = pages
  .map((page) => page.path)
  .filter((path) => path !== '/' && !sitemapPages.includes(path))
  .filter((path) => path !== '/404.html' && !path.startsWith('/architecture/'));

if (notInSitemap.length) {
  warnings.push(`pages not listed in sitemap.xml: ${notInSitemap.join(', ')}`);
}

for (const warning of warnings) console.warn(`warning: ${warning}`);

if (errors.length) {
  console.error(`\n${errors.length} broken link(s):`);
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}

console.log(
  `links ok · ${pages.length} pages · ${links} internal links · ${sitemapPages.length} sitemap urls · ${warnings.length} warning(s)`,
);
