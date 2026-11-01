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

/** Path the site is served from: '' at a domain root, '/ZeroUpload' on Pages. */
const SITE_BASE = new URL(SITE_URL).pathname.replace(/\/+$/, '');

/** Directory depth of a canonical path: `/tools/x/` → 2. */
function depthOf(path) {
  return path.split('/').filter(Boolean).length;
}

/**
 * The shell uses relative asset URLs (`./assets/...`) so the artifact works at
 * any prefix. A nested page needs one `../` per directory level to reach them.
 */
function rewire(html, depth) {
  // Links rendered by the app are root-absolute. On a GitHub project URL the
  // site is not at the domain root, so they need the deploy prefix — the same
  // prefix the browser router derives from the bundle URL at runtime.
  const prefixed = SITE_BASE
    ? html.replaceAll('href="/', `href="${SITE_BASE}/`).replaceAll('src="/', `src="${SITE_BASE}/`)
    : html;

  if (depth === 0) return prefixed;

  const up = '../'.repeat(depth);
  return prefixed
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
    .replace(/<meta\s+name="twitter:[^"]*"[\s\S]*?>\s*/gi, '')
    // A second run of this script would otherwise treat the homepage's
    // structured data (already written into dist/index.html) as part of the
    // shell and copy it into every page.
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>\s*/gi, '');
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

/** Page metadata plus the structured data for that page, as one head block. */
function headFor(route) {
  const tags = headTags(route.meta, route.path, SITE_URL);
  const json = staticBuild.structuredDataFor(route.path, SITE_URL);
  return json ? `${tags}\n    ${staticBuild.jsonLdScript(json)}` : tags;
}

for (const route of routes) {
  const depth = depthOf(route.path);
  const html = documentFor({
    head: headFor(route),
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
 *
 * It is deliberately the *same* page as the in-app route (`NotFoundPage.tsx`):
 * the mark, the eyebrow, the heading, the copy and the two buttons. Two 404
 * designs for one site was a finding in the UX audit; a visitor who mistypes a
 * URL should not be able to tell which renderer answered. The theme is resolved
 * from the same storage key the app uses, so light mode stays light here too.
 */
const notFound = `<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark light" />
    <meta name="theme-color" content="#08090b" />
    <meta name="robots" content="noindex, follow" />
    <title>Page not found · ZeroUpload</title>
    <link rel="icon" type="image/svg+xml" href="${SITE_URL}/favicon.svg" />
    <script>
      // Same rule as index.html: stored choice first, system preference second.
      (function () {
        try {
          var stored = localStorage.getItem('zeroupload.theme');
          var theme =
            stored === 'light' || stored === 'dark'
              ? stored
              : window.matchMedia('(prefers-color-scheme: light)').matches
                ? 'light'
                : 'dark';
          document.documentElement.dataset.theme = theme;
          var meta = document.querySelector('meta[name="theme-color"]');
          if (meta) meta.setAttribute('content', theme === 'light' ? '#f5f6f8' : '#08090b');
        } catch (e) {}
      })();
    </script>
    <style>
      :root {
        --bg: #08090b;
        --surface: #0e1114;
        --line: rgba(235, 245, 255, 0.08);
        --text: #eef2f5;
        --text-secondary: #a3aeb8;
        --text-muted: #7c8792;
        --accent: #5ff3d2;
        --violet: #8b7bff;
        --on-accent: #04120f;
      }
      :root[data-theme='light'] {
        --bg: #f5f6f8;
        --surface: #ffffff;
        --line: rgba(11, 20, 28, 0.09);
        --text: #0b1216;
        --text-secondary: #48545e;
        --text-muted: #626d78;
        --accent: #0b7f6b;
        --violet: #6c5ce7;
        --on-accent: #ffffff;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: var(--bg);
        color: var(--text-secondary);
        font: 15px/1.65 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      main {
        display: grid;
        justify-items: center;
        gap: 1rem;
        max-width: 34rem;
        padding: 2rem;
        text-align: center;
      }
      .mark { display: block; }
      .eyebrow {
        font-size: 0.75rem;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--text-muted);
      }
      h1 {
        margin: 0;
        font-size: clamp(1.6rem, 4vw, 2.3rem);
        line-height: 1.15;
        letter-spacing: -0.03em;
        color: var(--text);
      }
      p { margin: 0; max-width: 48ch; }
      .actions { display: flex; gap: 0.75rem; flex-wrap: wrap; justify-content: center; }
      a {
        display: inline-flex;
        align-items: center;
        gap: 0.45rem;
        height: 40px;
        padding: 0 1rem;
        border-radius: 8px;
        border: 1px solid var(--line);
        background: var(--surface);
        color: var(--text);
        font-size: 13px;
        font-weight: 520;
        text-decoration: none;
      }
      a.primary { background: var(--accent); border-color: transparent; color: var(--on-accent); font-weight: 560; }
      a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      @media (prefers-reduced-motion: no-preference) {
        a { transition: border-color 200ms ease, transform 200ms ease; }
        a:hover { transform: translateY(-1px); }
      }
    </style>
  </head>
  <body>
    <main>
      <svg class="mark" viewBox="0 0 32 32" width="72" height="72" aria-hidden="true">
        <defs>
          <linearGradient id="zu-404" x1="4" y1="28" x2="28" y2="4" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="var(--accent)" />
            <stop offset="60%" stop-color="var(--accent)" />
            <stop offset="100%" stop-color="var(--violet)" />
          </linearGradient>
        </defs>
        <circle cx="16" cy="16" r="11.2" fill="none" stroke="url(#zu-404)" stroke-width="3" stroke-linecap="round" stroke-dasharray="55 15" transform="rotate(-46 16 16)" />
        <path d="M16 7.4a8.6 8.6 0 0 1 0 17.2" fill="none" stroke="var(--accent)" stroke-opacity="0.32" stroke-width="1.2" stroke-linecap="round" />
        <circle cx="16" cy="16" r="1.6" fill="var(--accent)" />
      </svg>
      <span class="eyebrow">404 · page not found</span>
      <h1>There is nothing at this address.</h1>
      <p>The page may have moved, or the tool may not exist yet. Nothing was uploaded, so there is nothing to clean up.</p>
      <div class="actions">
        <a href="${SITE_URL}/">Home</a>
        <a class="primary" href="${SITE_URL}/tools/">Browse tools</a>
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
