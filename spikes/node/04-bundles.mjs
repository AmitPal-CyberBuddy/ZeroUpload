/**
 * Spike 4 — what each candidate actually costs in a lazy chunk.
 *
 * Bundles the exact import set a tool would use with esbuild (minify + ESM,
 * tree-shaking on, same as Vite's production build), then reports raw and
 * gzip -9 sizes. No estimates: these are the bytes a browser would download.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'node/out/bundles');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
// keep entry files inside the package so `@cantoo/pdf-lib` etc. resolve normally
const work = join(OUT, '.work');
mkdirSync(work, { recursive: true });

const shim = join(process.cwd(), 'node/crypto-browser-shim.mjs');
const candidates = {
  'pdf (@cantoo/pdf-lib)': {
    source: `export { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';`,
  },
  'pdf (pdf-lib, already shipped)': {
    source: `export { PDFDocument, StandardFonts } from 'pdf-lib';`,
  },
  'zip AES (@zip.js/zip.js)': {
    source: `export { BlobReader, BlobWriter, TextReader, ZipReader, ZipWriter } from '@zip.js/zip.js';`,
  },
  'office decrypt (office-crypto + shim)': {
    source: `export { OOXMLFile, isEncrypted } from 'office-crypto';`,
    alias: ['--alias:crypto=' + shim],
  },
  'office encrypt (agile + cfb + noble)': {
    source: `export { encryptOoxml } from '${join(process.cwd(), 'node/agile.mjs')}';`,
  },
  'fflate (shipped ZIP writer, for scale)': {
    source: `export * as fflate from 'fflate';`,
  },
};

const rows = [];
for (const [label, { source, alias = [] }] of Object.entries(candidates)) {
  const entry = join(work, `entry-${label.replace(/[^a-z]+/gi, '-')}.mjs`);
  writeFileSync(entry, source);
  const file = join(OUT, `${label.replace(/[^a-z0-9]+/gi, '-')}.js`);
  execFileSync('node_modules/.bin/esbuild', [
    entry,
    '--bundle',
    '--format=esm',
    '--minify',
    '--target=es2022',
    '--platform=browser',
    '--legal-comments=none',
    ...alias,
    `--outfile=${file}`,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const raw = statSync(file).size;
  const gz = Number(execFileSync('bash', ['-c', `gzip -9 -c ${file} | wc -c`], { encoding: 'utf8' }).trim());
  const brotli = Number(execFileSync('bash', ['-c', `brotli -c -q 11 ${file} 2>/dev/null | wc -c || echo ${gz}`], { encoding: 'utf8' }).trim());
  const bundledSource = readFileSync(file, 'utf8');
  /* GitHub Pages cannot send COOP/COEP, so cross-origin isolation is unavailable.
   * Any dependency on SharedArrayBuffer/Atomics makes a tool unusable there. */
  const isolation = ['SharedArrayBuffer', 'Atomics.', 'crossOriginIsolated']
    .filter((token) => bundledSource.includes(token));
  const spawnsWorker = /new Worker\(|new SharedWorker\(/.test(bundledSource);
  /* GitHub Pages serves from /<repo>/ — absolute "/assets/…" URLs and
   * import.meta.url lookups are the two ways a library breaks under a subpath. */
  const absolute = ['import.meta.url', '"/assets/', "'/assets/", 'document.baseURI']
    .filter((token) => bundledSource.includes(token));
  rows.push({ label, raw, gz, brotli: brotli || gz, needsIsolation: isolation, spawnsWorker, subpathRisk: absolute });
  console.log(`  ${label.padEnd(42)} ${(raw / 1024).toFixed(0).padStart(6)} kB raw ${(gz / 1024).toFixed(0).padStart(5)} kB gz   ${isolation.length ? `NEEDS ISOLATION (${isolation.join(', ')})` : 'no COOP/COEP need'}${spawnsWorker ? ' · can use a worker' : ''}${absolute.length ? ` · SUBPATH RISK (${absolute.join(', ')})` : ' · subpath-safe'}`);
}

rmSync(work, { recursive: true, force: true });
writeFileSync(join(OUT, 'bundles.json'), JSON.stringify(rows, null, 2));
