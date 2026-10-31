import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Absolute path to the browser shim for `office-crypto`'s Node `crypto` import.
 * Built from `import.meta.url` so it does not depend on `@types/node`; the
 * Windows drive-letter prefix is stripped because alias replacements want a
 * path, not a file URL.
 */
function officeCryptoShim(): string {
  const pathname = new URL('./src/lib/office/crypto-browser-shim.ts', import.meta.url).pathname;
  return /^\/[A-Za-z]:/.test(pathname) ? pathname.slice(1) : pathname;
}

/**
 * `office-crypto` imports Node's `crypto` for its hash/AES primitives. Aliasing
 * that one bare specifier to a browser shim (noble hashes + ciphers) is what
 * makes the library usable in a static site without forking it. The regex keeps
 * `node:crypto` and any subpath untouched, so nothing else changes behaviour.
 */
const cryptoShim = officeCryptoShim();

// ZeroUpload is deployed as a fully static site.
//
// The build keeps `base: './'` so one artifact works at a GitHub project URL, a
// custom domain or any subdirectory. Development uses an absolute base, because
// routes are real paths (`/tools/merge-pdf/`): a `./`-relative script tag would
// resolve against the route's depth and 404.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  plugins: [react()],
  resolve: {
    /**
     * Resolve CommonJS entry points instead of the `module` field.
     *
     * pdf-lib's ESM build imports files it does not ship (`./form.js`) and its
     * own dependencies do the same (`@pdf-lib/standard-fonts/es` asks for
     * `all-encodings.compressed.json.js`). Rollup reports those as unresolved
     * imports, which breaks the PDF worker chunk in a clean checkout. The CJS
     * builds are complete, so preferring `main` is the one switch that makes
     * both the entry bundle and the worker resolve identically.
     */
    mainFields: ['browser', 'main'],
    alias: [{ find: /^crypto$/, replacement: cryptoShim }],
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    allowedHosts: true,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  worker: {
    format: 'es',
  },
}));
