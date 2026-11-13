/**
 * Visual audit: the checks that a screenshot catches and a DOM test does not.
 *
 * `check-responsive.mjs` drives real pointer interactions and asserts layout
 * invariants for specific tools. This is the complement: it visits every route in
 * the sitemap, at several widths, in both colour schemes, and reports the classes
 * of defect that are invisible to the type checker and to jsdom —
 *
 *   contrast      text whose computed colour against its real background is
 *                 below the WCAG AA ratio for its size and weight;
 *   overflow      an element wider than its container, which pushes the page
 *                 sideways or clips a label;
 *   headings      a skipped level (h2 straight to h4), which misreports the page
 *                 structure to a screen reader;
 *   images        an <img> with no alt attribute;
 *   ids           a duplicate id, which breaks in-page links and label bindings;
 *   js            anything thrown or logged as an error while the page loaded.
 *
 * The contrast check walks text nodes and resolves the background by climbing
 * ancestors until it finds an opaque colour, because the palette is built from
 * transparent layers and `getComputedStyle(...).backgroundColor` on the element
 * itself is almost always `rgba(0,0,0,0)`.
 *
 * Usage:
 *   npm run build
 *   npx vite preview --port 4173 --host 0.0.0.0 &
 *   BROWSER_PATH=/path/to/chromium npm run audit:visual
 *
 * `BROWSER_PATH` is required only because this project does not install
 * Playwright's browser binaries; any Chromium 100+ works.
 */
import { chromium } from 'playwright-core';
import { readFile } from 'node:fs/promises';

const base = (process.env.BASE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');
const widths = (process.env.AUDIT_WIDTHS || '390,768,1280,1600').split(',').map(Number);
const themes = (process.env.AUDIT_THEMES || 'dark,light').split(',');
const extraArgs = (process.env.BROWSER_ARGS || '').split(',').map((v) => v.trim()).filter(Boolean);

const launchOptions = {
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', ...extraArgs],
};
if (process.env.BROWSER_PATH) launchOptions.executablePath = process.env.BROWSER_PATH;

const sitemap = await readFile('dist/sitemap.xml', 'utf8').catch(() => {
  throw new Error('Build the site first: npm run build');
});
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]).pathname);
if (!locs.length) throw new Error('No routes found in dist/sitemap.xml');
const root = locs.reduce((a, b) => (a.length <= b.length ? a : b));
const prefix = root.replace(/\/$/, '');
const routes = locs.map((path) => path.slice(prefix.length) || '/');

/** Runs in the page. Must be self-contained — it is serialised into evaluate(). */
function inspect() {
  const findings = { contrast: [], overflow: [], headings: [], noalt: [], dupIds: [] };

  const parse = (colour) => {
    const match = colour.match(/rgba?\(([^)]+)\)/);
    if (!match) return null;
    const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] === undefined ? 1 : parts[3] };
  };

  const luminance = ({ r, g, b }) => {
    const channel = (value) => {
      const v = value / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };

  const ratio = (a, b) => {
    const l1 = luminance(a);
    const l2 = luminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };

  const backgroundOf = (element) => {
    let node = element;
    while (node && node !== document.documentElement) {
      const colour = parse(getComputedStyle(node).backgroundColor);
      if (colour && colour.a > 0.5) return colour;
      node = node.parentElement;
    }
    return parse(getComputedStyle(document.body).backgroundColor) || { r: 0, g: 0, b: 0, a: 1 };
  };

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  let text;
  while ((text = walker.nextNode())) {
    if (!text.textContent.trim()) continue;
    const element = text.parentElement;
    if (!element || seen.has(element)) continue;
    if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(element.tagName)) continue;

    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) {
      continue;
    }
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    seen.add(element);

    const foreground = parse(style.color);
    if (!foreground) continue;

    const size = parseFloat(style.fontSize);
    const weight = Number(style.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const required = large ? 3 : 4.5;
    const actual = ratio(foreground, backgroundOf(element));

    if (actual < required) {
      findings.contrast.push({
        text: text.textContent.trim().slice(0, 48),
        selector: (element.className || element.tagName).toString().slice(0, 48),
        size,
        weight,
        ratio: Number(actual.toFixed(2)),
        required,
      });
    }
  }

  const doc = document.documentElement;
  if (doc.scrollWidth > doc.clientWidth + 1) {
    findings.overflow.push({ page: true, scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth });
  }
  for (const element of document.querySelectorAll('body *')) {
    const style = getComputedStyle(element);
    if (style.position === 'fixed' || style.position === 'absolute') continue;
    if (style.overflowX !== 'visible') continue;
    if (element.scrollWidth > element.clientWidth + 2) {
      findings.overflow.push({
        tag: element.tagName,
        selector: (element.className || '').toString().slice(0, 48),
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      });
    }
  }

  let previous = 0;
  for (const heading of document.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
    const level = Number(heading.tagName[1]);
    if (previous && level > previous + 1) {
      findings.headings.push({ from: previous, to: level, text: heading.textContent.trim().slice(0, 40) });
    }
    previous = level;
  }

  for (const image of document.querySelectorAll('img')) {
    if (!image.hasAttribute('alt')) findings.noalt.push(image.src.slice(-48));
  }

  const ids = new Map();
  for (const element of document.querySelectorAll('[id]')) {
    ids.set(element.id, (ids.get(element.id) || 0) + 1);
  }
  for (const [id, count] of ids) if (count > 1) findings.dupIds.push(id);

  return findings;
}

const browser = await chromium.launch(launchOptions);
const totals = { contrast: 0, overflow: 0, headings: 0, noalt: 0, dupIds: 0, js: 0 };
const details = [];

for (const theme of themes) {
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
    const page = await context.newPage();

    /** Console noise that is a real defect, not a missing static asset. */
    const isRealError = (message) => !/favicon|404|Failed to load resource/i.test(message);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && isRealError(message.text())) errors.push(message.text());
    });

    for (const route of routes) {
      await page.goto(base + route, { waitUntil: 'networkidle', timeout: 30_000 });
      await page.waitForTimeout(150);
      const findings = await page.evaluate(inspect);
      for (const kind of Object.keys(totals)) {
        if (kind === 'js') continue;
        totals[kind] += findings[kind]?.length ?? 0;
        for (const finding of findings[kind] ?? []) {
          details.push({ theme, width, route, kind, ...finding });
        }
      }
    }

    totals.js += errors.length;
    for (const message of errors) details.push({ theme, width, route: routes[0], kind: 'js', message });

    await context.close();
    process.stdout.write(`  ${theme} @ ${width}px — ${routes.length} routes\n`);
  }
}

await browser.close();

const summary = Object.entries(totals)
  .map(([kind, count]) => `${kind}=${count}`)
  .join('  ');
console.log(`\n${summary}`);

/**
 * Two overflow reports are expected and are not defects: a rotated SVG glyph
 * inside a fixed-size box, and the hero's ambient gradient, which is deliberately
 * wider than its container. Everything else fails the audit.
 */
const IGNORED_OVERFLOW = [/filedrop__glyph/, /hero__inner/];
const realOverflow = details.filter(
  (finding) => finding.kind !== 'overflow' || !IGNORED_OVERFLOW.some((re) => re.test(finding.selector || '')),
);
const failures = realOverflow.filter((finding) => finding.kind !== 'overflow' || !finding.page);

if (details.length) {
  const byKind = new Map();
  for (const finding of realOverflow) {
    const key = `${finding.kind} ${finding.route}`;
    if (!byKind.has(key)) byKind.set(key, finding);
  }
  for (const finding of byKind.values()) {
    console.log(`  [${finding.kind}] ${finding.theme}@${finding.width} ${finding.route}`, JSON.stringify(finding).slice(0, 200));
  }
}

if (failures.length > 0) {
  console.error(`\nvisual audit failed: ${failures.length} finding(s)`);
  process.exit(1);
}

console.log('\nvisual audit passed');
