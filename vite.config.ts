import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// ZeroUpload is deployed as a fully static site. A relative base keeps the
// build portable across GitHub Pages project URLs (/ZeroUpload/), custom
// domains and local `file://`-style previews without extra configuration.
export default defineConfig({
  base: './',
  plugins: [react()],
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
