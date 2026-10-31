import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// ZeroUpload is deployed as a fully static site. A relative base keeps the
// build portable across GitHub Pages project URLs (/ZeroUpload/), custom
// domains and local `file://`-style previews without extra configuration.
export default defineConfig({
  base: './',
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
});
