/**
 * Emscripten's pthread workers run the same glue with `self.name` set to
 * "em-pthread". Node cannot `import()` an http URL, so the glue is fetched and
 * evaluated as a data: module — it is a self-contained bundle with no imports.
 */
import { workerData } from 'node:worker_threads';

globalThis.self = globalThis;
globalThis.name = 'em-pthread';
globalThis.location = { href: workerData.href };

const response = await fetch(workerData.href);
const source = await response.text();
const encoded = Buffer.from(source, 'utf8').toString('base64');
await import(`data:text/javascript;base64,${encoded}`);
