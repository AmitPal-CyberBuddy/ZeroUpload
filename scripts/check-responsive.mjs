/**
 * Opt-in real-browser regression pass. Run `npm run build`, start the dev server,
 * then `BROWSER_PATH=/path/to/chromium npm run test:browser-layout`.
 * This checks initial routes and representative loaded states, not visual quality
 * or every possible state. Playwright's browser binaries are not installed by
 * this project; point BROWSER_PATH at a compatible local Chromium.
 */
import { chromium } from 'playwright-core';
import { PDFDocument } from '@cantoo/pdf-lib';
import { zipSync, strToU8 } from 'fflate';
import { readFile } from 'node:fs/promises';

const base = (process.env.BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const args = (process.env.BROWSER_ARGS || '').split(',').map((v) => v.trim()).filter(Boolean);
const launchOptions = { headless: true, args };
if (process.env.BROWSER_PATH) launchOptions.executablePath = process.env.BROWSER_PATH;

const sitemap = await readFile('dist/sitemap.xml', 'utf8').catch(() => {
  throw new Error('Build the site first: npm run build');
});
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]).pathname);
if (!locs.length) throw new Error('No routes found in dist/sitemap.xml');
// The first URL is the site root, which may include a deployment subpath.
const root = locs.reduce((a, b) => a.length <= b.length ? a : b);
const prefix = root.replace(/\/$/, '');
const routes = locs.map((path) => path.slice(prefix.length) || '/');
routes.push('/not-a-page/');

const pdf = await PDFDocument.create();
pdf.addPage([320, 480]);
pdf.addPage([320, 480]);
const payloads = {
  pdf: { mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) },
  zip: { mimeType: 'application/zip', buffer: Buffer.from(zipSync({ 'notes.txt': strToU8('hello') })) },
  txt: { mimeType: 'text/plain', buffer: Buffer.from('Hello from ZeroUpload') },
  docx: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await readFile('tests/fixtures/locked.docx') },
};
const fileRoutes = {
  'image-compressor': 'png', 'image-converter': 'png', favicon: 'png', resize: 'png', crop: 'png', rotate: 'png',
  'images-to-pdf': 'png', 'merge-pdf': 'pdf', 'split-pdf': 'pdf', 'rotate-pdf': 'pdf', 'protect-pdf': 'pdf',
  'unlock-pdf': 'pdf', 'create-zip': 'txt', 'extract-zip': 'zip', 'unlock-office': 'docx', 'file-inspector': 'txt', base64: 'txt',
};
// CSS viewport widths are what layout sees; device scale models common OS scaling.
const sizes = [[320, 568, 1], [390, 844, 1], [768, 1024, 1], [980, 600, 1], [1024, 768, 1], [1366, 768, 1],
  [1536, 864, 1.25], [1707, 960, 1.5], [1920, 1080, 1], [1920, 1080, 2], [2560, 1440, 1], [3440, 1440, 1], [3840, 2160, 1]];
const findings = [];

async function inspect(page, label) {
  const issues = await page.evaluate(() => {
    const problems = [];
    for (const el of document.querySelectorAll('body *')) {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (!rect.width || !rect.height || style.visibility === 'hidden' || el.namespaceURI.includes('svg')) continue;
      // These are intentional local scrollers, decoration, or fixed overlays.
      if (el.closest('.visually-hidden,.app-bg,.hero__ambient,.cta-band__glow,.doc-table-wrap,pre,.segmented,.stages,.settings__foot--docked,.result__preview')) continue;
      if (!['absolute', 'fixed'].includes(style.position) && (rect.right > innerWidth + 2 || rect.left < -2)) {
        problems.push(`Viewport overflow: ${el.tagName}.${String(el.className).replaceAll(' ', '.')} (${Math.round(rect.left)}–${Math.round(rect.right)}px)`);
      }
    }
    const shell = document.querySelector('main.page, main .page');
    if (shell) {
      const width = shell.getBoundingClientRect().width;
      if (width > 1441) problems.push(`Page shell exceeds readable cap: ${Math.round(width)}px`);
      if (innerWidth >= 1920 && width < 1360) problems.push(`Page shell does not use available monitor space: ${Math.round(width)}px`);
    }
    const doc = document.querySelector('.doc');
    if (doc && doc.getBoundingClientRect().width > 781) problems.push('Documentation text column exceeds its readable width');
    const footers = [...document.querySelectorAll('.settings__foot')].filter((el) => getComputedStyle(el).display !== 'none');
    if (footers.length > 1) problems.push(`${footers.length} primary-action footers visible`);
    for (const link of document.querySelectorAll('.catalog-nav a')) {
      const r = link.getBoundingClientRect(); const parent = link.parentElement.getBoundingClientRect();
      if (r.right > parent.right + 1 || r.bottom > parent.bottom + 1) problems.push(`Clipped category link: ${link.textContent.trim()}`);
    }
    return problems.slice(0, 8);
  });
  if (issues.length) findings.push({ label, issues });
}

for (const [width, height, scale] of sizes) {
  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale, reducedMotion: 'reduce' });
  page.on('pageerror', (error) => findings.push({ label: `${width} ${page.url()}`, issues: [error.message] }));
  try {
    for (const route of routes) {
      await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded' });
      await page.locator('main').waitFor();
      await page.evaluate(() => document.fonts.ready);
      await inspect(page, `${width} ${route} initial`);
    }
    if (scale === 1 && [320, 768, 1366, 2560, 3840].includes(width)) {
      const png = await page.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 120;
        const context = canvas.getContext('2d'); context.fillStyle = '#42ccaa'; context.fillRect(0, 0, 160, 120);
        return canvas.toDataURL('image/png').split(',')[1];
      });
      payloads.png = { mimeType: 'image/png', buffer: Buffer.from(png, 'base64') };
      for (const [route, extension] of Object.entries(fileRoutes)) {
        await page.goto(`${base}/tools/${route}/`, { waitUntil: 'networkidle' });
        const file = { name: `${'long-file-name-'.repeat(6)}${'x'.repeat(70)}.${extension}`, ...payloads[extension] };
        await page.locator('input[type=file]').first().setInputFiles(file);
        await page.waitForTimeout(700); // Allow async decoding/probing to render its loaded state.
        await inspect(page, `${width} ${route} loaded`);
      }
    }
    console.log(`Checked ${width}×${height} CSS pixels at ${scale}× device scale`);
  } finally {
    await browser.close();
  }
}
if (findings.length) {
  console.error(JSON.stringify(findings, null, 2));
  process.exitCode = 1;
} else {
  console.log(`No viewport overflow, clipped category links, duplicate action footers or page errors found on ${routes.length} routes and selected file states.`);
}
