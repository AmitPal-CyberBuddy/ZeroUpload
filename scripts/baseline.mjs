#!/usr/bin/env node
/**
 * Prints the numbers the docs quote, measured from the tree in front of you.
 *
 * Every review in `docs/` opens with a table of code size, build size, test count
 * and route count. Written by hand, those numbers are correct on the day and
 * wrong a week later — and in a repository whose authority comes from measurement,
 * a stale figure is worse than no figure, because it reads as a fact.
 *
 *   npm run build && npm run baseline
 *
 * Test counts are passed in rather than measured here: running the suites from
 * this script would mean parsing reporter output, which is a dependency on a
 * formatter. The docs say where the numbers come from.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');

const walk = (dir, test) => {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path, test));
    else if (test(path)) out.push(path);
  }
  return out;
};

const bytes = (n) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1024 / 1024).toFixed(2)} MiB`;
};

const lines = (files) =>
  files.reduce((sum, file) => sum + readFileSync(file, 'utf8').split('\n').length, 0);

const src = (ext) => walk(join(ROOT, 'src'), (p) => p.endsWith(ext));

// ---- code ----
const ts = src('.ts').concat(src('.tsx'));
const css = src('.css');
const testFiles = walk(join(ROOT, 'tests'), (p) => /\.test\.tsx?$/.test(p));

// ---- registry, read from source so no build is needed ----
const registry = readFileSync(join(ROOT, 'src/registry/tools.ts'), 'utf8');
const defined = (registry.match(/^\s{4}slug: '/gm) ?? []).length;
const beta = (registry.match(/status: 'beta'/g) ?? []).length;
const soon = (registry.match(/status: 'soon'/g) ?? []).length;
const categorySource = readFileSync(join(ROOT, 'src/registry/categories.ts'), 'utf8');
const categories = (categorySource.match(/^\s{4}id: '/gm) ?? []).length;

const rows = [];
rows.push(['Code', `${ts.length} TS/TSX files, ${lines(ts).toLocaleString()} lines · CSS ${lines(css).toLocaleString()} lines`]);
rows.push(['Tests', `${testFiles.length} test files, ${lines(testFiles).toLocaleString()} lines of test code`]);
rows.push(['Registry', `${defined} tools defined · ${soon} planned · ${beta} beta · ${categories} groups`]);

// ---- build, when there is one ----
if (existsSync(DIST)) {
  const files = walk(DIST, () => true);
  const total = files.reduce((sum, file) => sum + statSync(file).size, 0);
  const js = files.filter((file) => file.endsWith('.js'));
  const jsGzip = js.reduce((sum, file) => sum + gzipSync(readFileSync(file), { level: 9 }).length, 0);

  // The entry is whatever `index.html` loads first; the weigh script prints the
  // per-route cost, which is the number that matters for first load.
  const shell = readFileSync(join(DIST, 'index.html'), 'utf8');
  const entryMatch = /<script type="module"[^>]*src="[^"]*\/(index-[\w-]+\.js)"/.exec(shell);
  const entry = entryMatch ? join(DIST, 'assets', entryMatch[1]) : null;
  if (entry && existsSync(entry)) {
    const raw = readFileSync(entry);
    rows.push(['Entry chunk', `${bytes(raw.length)} raw · ${bytes(gzipSync(raw, { level: 9 }).length)} gzip`]);
  }

  const html = files.filter((file) => file.endsWith('.html'));
  rows.push(['Build', `${bytes(total)} across ${files.length} files · ${js.length} JS · ${html.length} HTML documents`]);
  rows.push(['JS in artifact', `${bytes(js.reduce((sum, file) => sum + statSync(file).size, 0))} raw · ${bytes(jsGzip)} gzip total`]);
} else {
  rows.push(['Build', 'not built — run `npm run build` first']);
}

const width = Math.max(...rows.map(([key]) => key.length));
console.log('\nZeroUpload baseline\n');
for (const [key, value] of rows) console.log(`  ${key.padEnd(width)}  ${value}`);
console.log('\nPaste this into the review that quotes it. Figures measured, not recalled.\n');
