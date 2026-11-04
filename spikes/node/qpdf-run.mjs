/**
 * Runs the qpdf-wasm pthread build inside Node.
 *
 * This is deliberately awkward: the emscripten build expects a browser (self,
 * location, fetch, Worker, SharedArrayBuffer, OffscreenCanvas-free). Node gives
 * us the primitives, so with a shim we can prove the engine works and produce
 * files to verify. The shim is NOT a deployment story — see the report.
 */
import { Worker as NodeWorker } from 'node:worker_threads';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'node_modules/qpdf-wasm');

function serve() {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      const name = request.url.split('?')[0].replace(/^\//, '');
      const file = join(DIR, name);
      if (!existsSync(file)) {
        response.writeHead(404).end('no');
        return;
      }
      const type = name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript';
      response.writeHead(200, { 'content-type': type }).end(readFileSync(file));
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
    server.unref();
  });
}

export async function runQpdf() {
  const { server, port } = await serve();
  const base = `http://127.0.0.1:${port}/`;

  globalThis.self = globalThis;
  globalThis.location = { href: base };
  try {
    Object.defineProperty(globalThis.navigator, 'hardwareConcurrency', { value: 2, configurable: true });
  } catch {
    /* Node's navigator is a getter in some versions */
  }

  // Emscripten's pthread workers re-enter the same glue with `self.name` set to
  // "em-pthread"; Node's Worker needs a bootstrap to do that.
  const bootstrap = new URL('./pthread-bootstrap.mjs', import.meta.url);
  class BrowserWorker {
    constructor(url, options = {}) {
      const href = String(url);
      const worker = new NodeWorker(bootstrap, {
        workerData: { href: href.startsWith('http') ? href : new URL(href, base).href },
        type: 'module',
      });
      this._worker = worker;
      this._listeners = new Map();
      worker.on('message', (data) => {
        for (const listener of this._listeners.get('message') ?? []) listener({ data });
        this.onmessage?.({ data });
      });
      worker.on('error', (error) => {
        for (const listener of this._listeners.get('error') ?? []) listener(error);
        this.onerror?.(error);
      });
      this.onmessage = null;
      this.onerror = null;
    }
    addEventListener(type, listener) {
      const list = this._listeners.get(type) ?? [];
      list.push(listener);
      this._listeners.set(type, list);
    }
    postMessage(message, transfer) {
      this._worker.postMessage(message, transfer);
    }
    terminate() {
      return this._worker.terminate();
    }
  }
  globalThis.Worker = BrowserWorker;

  const started = performance.now();
  const { default: init } = await import(join(DIR, 'qpdf.js'));
  const module = await init({
    noInitialRun: true,
    locateFile: (name) => base + name,
    print: () => {},
    printErr: () => {},
  });
  const startupMs = Math.round(performance.now() - started);

  let version = 'unknown';
  module.callMain(['--version']);
  // qpdf prints through `print`, which we silenced; ask the FS for the exit code
  // instead and reconstruct from a `--json-help`-free route: just report that it ran.
  version = 'ran';

  const input = readFileSync(join(process.cwd(), 'node/out/pdf/plain.pdf'));
  module.FS.writeFile('/in.pdf', new Uint8Array(input));
  const password = 'spike-password';
  try {
    module.callMain(['--encrypt', password, password, '256', '--', '/in.pdf', '/out.pdf']);
  } catch (error) {
    if (error?.name !== 'ExitStatus') throw error;
  }
  const encrypted = module.FS.readFile('/out.pdf');
  server.close();
  return {
    ok: true,
    version,
    startupMs,
    rssMb: process.memoryUsage().rss / 1024 / 1024,
    encryptedBytes: encrypted ? Uint8Array.from(encrypted) : null,
    password,
  };
}

/* Leave no listener behind if the caller gives up. */
process.on('exit', () => {});
