/**
 * Vite config for the measurement harness only.
 *
 * Nothing here belongs to the app. It exists so `scripts/measure/index.html` can
 * be opened on a dev server that sends COOP/COEP — which is what makes
 * `performance.measureUserAgentSpecificMemory()` available. Cross-origin isolation
 * changes nothing else about the page: it loads no third-party resources.
 *
 *   npx vite --config scripts/measure/vite.config.ts
 *   → http://localhost:5180/scripts/measure/index.html
 */
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5180,
    strictPort: false,
    open: '/scripts/measure/index.html',
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
