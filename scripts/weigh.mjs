#!/usr/bin/env node
/**
 * What a visitor actually downloads, per route.
 *
 * `du -sh dist` and the build log both answer the wrong question. The build
 * prints every chunk it emits, which double-counts the engines that exist once in
 * the worker graph and once in the main-thread fallback; `du` counts the whole
 * artifact, most of which no single visit ever fetches. This walks the module
 * graph the way a browser would — starting from the `<script>` and
 * `<link rel="modulepreload">` tags in each prerendered document, following static
 * imports only — and reports the bytes that arrive before the route's own lazy
 * chunk is requested.
 *
 * Dynamic imports are reported separately, because they are a different promise:
 * they arrive after first paint, they are cached individually, and (for the
 * engine chunks) they usually never arrive at all.
 *
 * Run after `npm run build`:  node scripts/weigh.mjs [--json]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');
const ASSETS = join(DIST, 'assets');

const gz = (buffer) => gzipSync(buffer, { level: 9 }).length;
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;

/* ---------------------------- chunk graph ------------------------------- */

const chunkCache = new Map();

function readChunk(file) {
  if (chunkCache.has(file)) return chunkCache.get(file);
  let source = '';
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    chunkCache.set(file, null);
    return null;
  }
  const buffer = readFileSync(file);
  const stat = statSync(file);

  // Every import specifier Rollup emits is a relative sibling: `from"./x.js"` or
  // `import("./x.js")`. Minified output always quotes them, so this is reliable.
  const staticImports = [...source.matchAll(/(?<!import\()\bfrom\s*"\.\/([^"]+\.js)"/g)].map((m) => m[1]);
  // Rolldown emits dynamic imports with backticks; Vite's own preload helper may
  // leave plain quotes. Both are the same edge in the graph.
  const dynamicImports = [...source.matchAll(/import\(\s*[`"']\.\/([^`"']+\.js)[`"']\s*\)/g)].map((m) => m[1]);

  const info = {
    file,
    name: relative(ASSETS, file),
    raw: stat.size,
    gzip: gz(buffer),
    source,
    staticImports: [...new Set(staticImports)],
    dynamicImports: [...new Set(dynamicImports)],
  };
  chunkCache.set(file, info);
  return info;
}

/** Every chunk reachable by static import, in load order. */
function staticClosure(entryFiles) {
  const seen = new Set();
  const order = [];
  const queue = [...entryFiles];

  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const info = readChunk(file);
    if (!info) continue;
    order.push(info);
    for (const next of info.staticImports) queue.push(join(dirname(file), next));
  }
  return order;
}

/** Chunks a route will pull in dynamically, one level deep (engines, tool code). */
function dynamicReach(chunks) {
  const seen = new Set();
  const files = [];
  for (const chunk of chunks) {
    for (const next of chunk.dynamicImports) {
      const file = join(dirname(chunk.file), next);
      if (seen.has(file)) continue;
      seen.add(file);
      const info = readChunk(file);
      if (info) files.push(info);
    }
  }
  return files;
}

/* ------------------------------ routes ---------------------------------- */

function findDocuments(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === 'assets') continue;
      findDocuments(path, out);
    } else if (name.endsWith('.html')) {
      out.push(path);
    }
  }
  return out;
}

function entryFilesOf(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  const files = [];
  for (const match of html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)) files.push(resolve(dirname(htmlPath), match[1]));
  for (const match of html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+\.js)"/g)) {
    files.push(resolve(dirname(htmlPath), match[1]));
  }
  return [...new Set(files)];
}

const routePath = (document) => {
  const rel = relative(DIST, dirname(document));
  return rel === '' ? '/' : `/${rel}/`.replace(/\/{2,}/g, '/');
};

/**
 * Files a chunk names as a *string* rather than imports.
 *
 * Workers are the reason this exists: `new Worker(new URL('pdf.worker-x.js',
 * import.meta.url))` is not an import edge, so a graph walk that only follows
 * imports reports a PDF tool as costing 20 kB when it actually pulls 180 kB of
 * gzip the moment the worker starts. Anything a chunk mentions by name and that
 * exists in `assets/` is counted.
 */
function referencedAssets(chunks, alreadyCounted) {
  const found = new Map();
  for (const chunk of chunks) {
    for (const match of chunk.source.matchAll(/[`"']([A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8}\.js)[`"']/g)) {
      const name = match[1];
      const file = join(ASSETS, name);
      if (alreadyCounted.has(name) || found.has(name)) continue;
      const info = readChunk(file);
      if (info) found.set(name, info);
    }
  }
  return [...found.values()];
}

/** Every chunk reachable by dynamic import, transitively, up to `depth` levels. */
function dynamicClosure(chunks, depth = 3) {
  const seen = new Set(chunks.map((chunk) => chunk.name));
  let frontier = chunks;
  const collected = [];

  for (let level = 0; level < depth && frontier.length; level += 1) {
    const next = [];
    for (const chunk of dynamicReach(frontier)) {
      if (seen.has(chunk.name)) continue;
      seen.add(chunk.name);
      next.push(chunk);
      collected.push(chunk);
    }
    frontier = next;
  }
  return collected;
}

/* ------------------------------ report ---------------------------------- */

const documents = findDocuments(DIST).sort((a, b) => routePath(a).localeCompare(routePath(b)));
const rows = [];

for (const document of documents) {
  const entries = entryFilesOf(document);
  const initial = staticClosure(entries);
  if (initial.length === 0) continue;

  const initialRaw = initial.reduce((sum, chunk) => sum + chunk.raw, 0);
  const initialGzip = initial.reduce((sum, chunk) => sum + chunk.gzip, 0);
  const onDemand = dynamicReach(initial);
  const onDemandGzip = onDemand.reduce((sum, chunk) => sum + chunk.gzip, 0);

  rows.push({
    route: routePath(document),
    initialRaw,
    initialGzip,
    onDemandGzip,
    initialChunks: initial.map((chunk) => chunk.name),
    onDemandChunks: onDemand.map((chunk) => chunk.name),
  });
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

/**
 * The shell is identical for every route, so the interesting number is not the
 * per-route total (all the same) but what a route adds *after* first paint.
 */
const allChunkNames = readdirSync(ASSETS).filter((name) => name.endsWith('.js'));
const allChunks = allChunkNames.map((name) => readChunk(join(ASSETS, name))).filter(Boolean);
const shell = rows[0];
const shellNames = new Set(shell.initialChunks);

console.log(`\nFirst load (entry graph, identical for every route)`);
console.log(`  ${shell.initialChunks.length} chunks · ${kb(shell.initialRaw)} raw · ${kb(shell.initialGzip)} gzip`);
for (const chunk of [...shell.initialChunks].sort()) {
  const info = readChunk(join(ASSETS, chunk));
  if (info && info.raw > 4096) console.log(`    ${chunk.padEnd(34)} ${kb(info.gzip).padStart(10)} gzip`);
}

const ENGINES = {
  'pdf-lib': 'PDFDocument',
  'zip.js': 'zipCrypto',
  fflate: 'invalid zip data',
  'office-crypto': 'EncryptedPackage',
};

const enginesOf = (chunk) =>
  Object.entries(ENGINES)
    .filter(([, marker]) => chunk.source.includes(marker))
    .map(([name]) => name);

/**
 * The tool chunk for a route, found the way the router finds it: the registry
 * slug `merge-pdf` is the component `MergePdfTool`, imported lazily from the entry
 * chunk. Everything a tool needs after first paint hangs off that chunk.
 */
const toolChunkFor = (route) => {
  const slug = /^\/tools\/([^/]+)\/$/.exec(route)?.[1];
  if (!slug || toolSlugs.has(slug) === false) return null;
  const component = slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  const name = allChunkNames.find((candidate) => candidate.startsWith(`${component}Tool-`) || candidate.startsWith(`${component}-`));
  return name ? readChunk(join(ASSETS, name)) : null;
};

const toolSlugs = new Set(
  rows
    .map((row) => /^\/tools\/([^/]+)\/$/.exec(row.route)?.[1])
    .filter((slug) => slug && !['image', 'pdf', 'archive', 'inspect', 'developer'].includes(slug)),
);

const shellNamesSet = new Set(shell.initialChunks);

const reach = new Map();

console.log(`\nWhat a tool costs when you use it (first load excluded)`);
console.log(`  ${'route'.padEnd(26)} ${'tool'.padStart(9)} ${'+ engines'.padStart(11)} ${'+ worker'.padStart(10)}   ${'total'.padStart(10)}`);
for (const row of rows) {
  const toolChunk = toolChunkFor(row.route);
  if (!toolChunk) continue;

  const toolStatic = staticClosure([toolChunk.file]).filter((chunk) => !shellNamesSet.has(chunk.name));
  const toolGzip = toolStatic.reduce((sum, chunk) => sum + chunk.gzip, 0);

  const deferred = dynamicClosure(toolStatic);
  const engines = deferred.filter((chunk) => enginesOf(chunk).length > 0);
  const engineGzip = engines.reduce((sum, chunk) => sum + chunk.gzip, 0);

  const counted = new Set([...toolStatic, ...deferred].map((chunk) => chunk.name));
  const workers = referencedAssets([...toolStatic, ...deferred], counted);
  const workerGzip = workers.reduce((sum, chunk) => sum + chunk.gzip, 0);

  /*
   * The engine copy and the worker are the same work done on two different
   * threads; a visit pays for one. Counting both would double the number and
   * suggest a problem that does not exist, so the total takes the larger.
   */
  const either = Math.max(engineGzip, workerGzip);
  console.log(
    `  ${row.route.padEnd(26)} ${kb(toolGzip).padStart(9)} ${kb(engineGzip).padStart(11)} ${kb(workerGzip).padStart(10)}   ${kb(toolGzip + either).padStart(10)}`,
  );

  reach.set(row.route, new Set([...toolStatic, ...deferred, ...workers].map((chunk) => chunk.name)));
}

/* --------------------------------- engines -------------------------------- */

/**
 * The libraries that are compiled twice — once into the worker graph, once into
 * the main-thread fallback — plus the workers themselves.
 *
 * The two copies are alternatives, not a sum: `client.ts` reaches the worker
 * through `new Worker(new URL(...))` and reaches the fallback through
 * `await import('./ops')` *inside the failure branch*. A visit downloads one or
 * the other, which is why the per-tool table above picks the larger of the two
 * rather than adding them.
 */
console.log(`\nEngine copies in the artifact`);
for (const [engine, marker] of Object.entries(ENGINES)) {
  const holders = allChunks.filter((chunk) => chunk.source.includes(marker));
  // Sizes are printed per chunk, not summed: one chunk can hold two engines
  // (pdf.worker carries fflate as well), and a total would count it twice.
  console.log(`  ${engine.padEnd(14)} ${holders.map((chunk) => `${chunk.name} (${kb(chunk.gzip)})`).join(', ')}`);
}

/* ------------------------------ duplicates -------------------------------- */

/**
 * Two chunks with the same source are the same code shipped twice. Hashing the
 * source with the hashed chunk names normalised out is the only reliable test:
 * grouping by byte size instead pairs unrelated files that happen to weigh the
 * same, and hides the real duplicate.
 */
const signature = (source) => createHash('sha1').update(source.replace(/-[A-Za-z0-9_-]{8}\.js/g, '.js')).digest('hex');

const bySignature = new Map();
for (const chunk of allChunks) {
  const key = signature(chunk.source);
  if (!bySignature.has(key)) bySignature.set(key, []);
  bySignature.get(key).push(chunk);
}

const duplicateGroups = [...bySignature.values()].filter((group) => group.length > 1);

if (duplicateGroups.length === 0) {
  console.log(`\nDuplicated chunks: none`);
} else {
  console.log(`\nDuplicated chunks`);
  let charged = 0;
  for (const group of duplicateGroups) {
    const names = group.map((chunk) => chunk.name);
    const routes = [...reach.entries()]
      .filter(([, names2]) => names.every((name) => names2.has(name)))
      .map(([route]) => route);
    console.log(
      `  ${kb(group[0].gzip).padStart(9)}  ${names.join(' = ')}${
        routes.length ? `  ← both reachable from ${routes.join(', ')}` : '  (no single visit reaches both)'
      }`,
    );
    charged += routes.length > 0 ? group[0].gzip * (group.length - 1) : 0;
  }
  if (charged > 0) {
    console.error(`\nA visit can download the same code twice (${kb(charged)} wasted). Fix the import graph.`);
    process.exit(1);
  }
}
