/**
 * Turns the built client bundle into a set of real pages.
 *
 * `vite build` produces one shell (`dist/index.html`). This script asks the SSR
 * bundle for the HTML of every route and writes it to `dist/<route>/index.html`,
 * so a crawler that fetches `/tools/merge-pdf/` receives that tool's title,
 * description, heading and copy — not a shared shell.
 *
 * It also emits `sitemap.xml`, `robots.txt`, the redirect stub for the renamed
 * architecture page, and the 404 document.
 *
 * No file data is involved anywhere: this runs in CI, before anything is
 * deployed, and the output is static HTML.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const ssrEntry = join(dist, '..', 'dist-ssr', 'entry-server.js');

/** Absolute site root, without a trailing slash. Matches `src/seo/site.ts`. */
// An unset repository variable arrives as an empty string, which must fall back
// to the project Pages URL rather than produce canonical-less pages.
const SITE_URL = (process.env.SITE_URL || 'https://amitpal-cyberbuddy.github.io/ZeroUpload').replace(
  /\/+$/,
  '',
);

const staticBuild = await import(pathToFileURL(ssrEntry).href);

/** Directory depth of a canonical path: `/tools/x/` → 2. */
function depthOf(path) {
  return path.split('/').filter(Boolean).length;
}

/**
 * The shell uses relative asset URLs (`./assets/...`) so the artifact works at
 * any prefix. A nested page needs one `../` per directory level to reach them.
 */
function rewire(html, depth) {
  if (depth === 0) return html;
  const up = '../'.repeat(depth);
  return html
    .replaceAll('href="./', `href="${up}`)
    .replaceAll('src="./', `src="${up}`)
    .replaceAll('content="./', `content="${up}`);
}

const shell = await readFile(join(dist, 'index.html'), 'utf8');

/** Keep the shell's <head> skeleton, drop metadata this script replaces. */
function shellHead() {
  return shell
    .replace(/<title>[\s\S]*?<\/title>\s*/i, '')
    .replace(/<meta\s+name="description"[\s\S]*?>\s*/gi, '')
    .replace(/<meta\s+name="robots"[\s\S]*?>\s*/gi, '')
    .replace(/<link\s+rel="canonical"[\s\S]*?>\s*/gi, '')
    .replace(/<meta\s+property="og:[^"]*"[\s\S]*?>\s*/gi, '')
    .replace(/<meta\s+name="twitter:[^"]*"[\s\S]*?>\s*/gi, '');
}

function documentFor({ head, body, depth }) {
  const headShell = shellHead();
  const withHead = headShell.replace('</head>', `  ${head}\n  </head>`);
  const withBody = withHead.replace('<div id="root"></div>', `<div id="root">${body}</div>`);
  return rewire(withBody, depth);
}

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/* ------------------------------- pages -------------------------------- */

const routes = staticBuild.prerenderRoutes();
const { headTags } = staticBuild;

for (const route of routes) {
  const depth = depthOf(route.path);
  const html = documentFor({
    head: headTags(route.meta, route.path, SITE_URL),
    body: staticBuild.renderRoute(route.path),
    depth,
  });
  const target = route.path === '/' ? join(dist, 'index.html') : join(dist, route.path, 'index.html');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, html, 'utf8');
}

/* ------------------------------ redirects ----------------------------- */

for (const route of staticBuild.REDIRECT_ROUTES) {
  // GitHub Pages cannot issue a 301 from a static file, so this is a real page
  // that forwards immediately, keeps the canonical on the destination and stays
  // out of the index.
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Moved · ZeroUpload</title>
    <meta name="robots" content="noindex, follow" />
    <link rel="canonical" href="${SITE_URL}${route.to}" />
    <meta http-equiv="refresh" content="0; url=${SITE_URL}${route.to}" />
  </head>
  <body>
    <p>This page has moved to <a href="${SITE_URL}${route.to}">${SITE_URL}${route.to}</a>.</p>
  </body>
</html>
`;
  const target = join(dist, route.path, 'index.html');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, html, 'utf8');
}

/* ------------------------------ 404 page ------------------------------ */

/**
 * Served with a real 404 status for any unknown path, at any depth, so its
 * links must be root-absolute. It stays out of the index and does not boot the
 * app — a wrong URL deserves a small page, not a 300 KB download.
 */
const notFound = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark light" />
    <meta name="robots" content="noindex, follow" />
    <title>Page not found · ZeroUpload</title>
    <link rel="icon" type="image/svg+xml" href="${SITE_URL}/favicon.svg" />
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #08090b;
        color: #a3aeb8;
        font: 15px/1.65 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
      }
      main { max-width: 34rem; padding: 2rem; text-align: center; }
      .mark { font: 600 13px/1 ui-monospace, monospace; letter-spacing: 0.16em; color: #5ff3d2; }
      h1 { margin: 1.25rem 0 0.75rem; font-size: 1.6rem; color: #e7edf3; letter-spacing: -0.02em; }
      p { margin: 0 0 1.75rem; }
      a { color: #5ff3d2; text-decoration: none; }
      a:hover { text-decoration: underline; }
      .links { display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap; }
      .links a {
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 10px;
        padding: 0.6rem 1rem;
        color: #e7edf3;
      }
      .links a.primary { border-color: #5ff3d2; color: #08090b; background: #5ff3d2; }
    </style>
  </head>
  <body>
    <main>
      <div class="mark">404</div>
      <h1>There is nothing at this address.</h1>
      <p>The page may have moved, or the tool may not exist yet. Nothing was uploaded, so there is nothing to clean up.</p>
      <div class="links">
        <a class="primary" href="${SITE_URL}/tools/">Browse tools</a>
        <a href="${SITE_URL}/">ZeroUpload home</a>
      </div>
    </main>
  </body>
</html>
`;
await writeFile(join(dist, '404.html'), notFound, 'utf8');

/* ------------------------------ sitemap ------------------------------- */

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes
  .map(
    (route) => `  <url>
    <loc>${escapeXml(`${SITE_URL}${route.path}`)}</loc>
  </url>`,
  )
  .join('\n')}
</urlset>
`;
await writeFile(join(dist, 'sitemap.xml'), sitemap, 'utf8');

/* ------------------------------ robots -------------------------------- */

/**
 * The crawler policy is a deliberate list, not a wildcard:
 *
 *  - search engines and answer engines that surface pages are welcome;
 *  - ChatGPT-User is a fetch on a person's behalf and is left alone;
 *  - crawlers that collect for model training are refused.
 *
 * Nothing here is about user files — those never leave a browser. The rules
 * describe what may be copied from this site, which is all a crawler can reach.
 */
const robots = `# ZeroUpload — a browser-only file toolkit. https://github.com/AmitPal-CyberBuddy/ZeroUpload
#
# Search and answer engines are welcome, including OAI-SearchBot, which reads
# pages to answer questions and cite sources.
# Crawlers that collect content for model training are refused.

User-agent: *
Allow: /

User-agent: Googlebot
Allow: /

User-agent: Bingbot
Allow: /

User-agent: DuckDuckBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: PerplexityBot
Allow: /

# Fetches a page because a person asked for it. Not a training crawl.
User-agent: ChatGPT-User
Allow: /

# Model-training crawlers.
User-agent: GPTBot
Disallow: /

User-agent: CCBot
Disallow: /

User-agent: Google-Extended
Disallow: /

Sitemap: ${SITE_URL}/sitemap.xml
`;
await writeFile(join(dist, 'robots.txt'), robots, 'utf8');

console.log(`prerendered ${routes.length} pages · sitemap · robots.txt · 404.html`);
