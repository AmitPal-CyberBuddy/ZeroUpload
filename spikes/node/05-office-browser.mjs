/**
 * Spike 5 — Office decryption as a *browser* bundle.
 *
 * `office-crypto`'s published ESM build imports Node's `crypto`, which a static
 * site cannot resolve. This bundles it with `node/crypto-browser-shim.mjs`
 * aliased in place of `crypto`, then decrypts the same reference-encrypted files
 * as Spike 3 — in a bundle with no Node built-ins left in it.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'node/out/office');
const bundle = join(OUT, 'office-crypto-browser.bundle.mjs');
const now = () => performance.now();

const rows = [];
const check = (name, value, ok = true) => {
  rows.push({ name, value, ok });
  console.log(`  ${ok ? '    ' : 'FAIL'} ${name.padEnd(46)} ${String(value).padStart(22)}`);
};

const entry = join(OUT, '.entry.mjs');
writeFileSync(entry, `export { OOXMLFile, isEncrypted } from 'office-crypto';\n`);

execFileSync('node_modules/.bin/esbuild', [
  entry,
  '--bundle',
  '--format=esm',
  '--minify',
  '--target=es2022',
  '--platform=browser',
  '--legal-comments=none',
  `--alias:crypto=${join(process.cwd(), 'node/crypto-browser-shim.mjs')}`,
  `--outfile=${bundle}`,
], { stdio: ['ignore', 'ignore', 'pipe'] });
rmSync(entry);

const contents = readFileSync(bundle, 'utf8');
const raw = statSync(bundle).size;
const gz = Number(execFileSync('bash', ['-c', `gzip -9 -c ${bundle} | wc -c`], { encoding: 'utf8' }).trim());
check('browser bundle: office-crypto + shim', `${(raw / 1024).toFixed(0)} kB · ${(gz / 1024).toFixed(0)} kB gz`);
check('no Node built-ins left in the bundle', /from\s*["'](node:)?crypto["']/.test(contents) ? 'crypto import remains (bad)' : 'none', !/from\s*["'](node:)?crypto["']/.test(contents));

console.log('\nSpike 5 — Office read path, browser bundle\n');

const { OOXMLFile } = await import(bundle);

for (const kind of ['docx', 'xlsx', 'pptx']) {
  const started = now();
  const file = new OOXMLFile(readFileSync(join(OUT, `reference-locked.${kind}`)));
  file.loadKey({ password: 'correct horse' });
  const decrypted = file.decrypt();
  const ms = Math.round(now() - started);
  const identical = Buffer.compare(Buffer.from(decrypted), readFileSync(join(OUT, `plain.${kind}`))) === 0;
  check(`browser bundle decrypts ${kind}`, `${identical ? 'byte-identical' : 'DIFFERENT'} · ${ms} ms`, identical);
}

for (const kind of ['docx', 'xlsx']) {
  const file = new OOXMLFile(readFileSync(join(OUT, `ours-locked.${kind}`)));
  file.loadKey({ password: 'correct horse' });
  const decrypted = file.decrypt();
  const identical = Buffer.compare(Buffer.from(decrypted), readFileSync(join(OUT, `plain.${kind}`))) === 0;
  check(`browser bundle opens our own ${kind}`, identical ? 'byte-identical' : 'DIFFERENT', identical);
}

{
  const file = new OOXMLFile(readFileSync(join(OUT, 'reference-locked.docx')));
  let outcome = 'accepted (bad)';
  let ok = false;
  try {
    file.loadKey({ password: 'nope' });
    file.decrypt(); // the decrypted payload is not a ZIP → InvalidKeyError
  } catch (error) {
    outcome = `${error.name}: ${String(error.message).slice(0, 30)}`;
    ok = true;
  }
  check('browser bundle rejects a wrong password', outcome, ok);
}

const failures = rows.filter((row) => !row.ok);
writeFileSync(join(OUT, 'browser-results.json'), JSON.stringify({ rows, failures }, null, 2));
console.log(`\n  failures: ${failures.length === 0 ? 'none' : failures.map((f) => f.name).join('; ')}\n`);
