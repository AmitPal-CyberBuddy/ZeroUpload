import { defineConfig } from 'vitest/config';

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
 * The suite covers the deterministic logic that the security model rests on:
 * ZIP budgets and sanitisation, page ranges, header parsing, size guards and the
 * worker protocol. No DOM, no React, no browser — plain Node, so the tests are
 * fast and cannot pass because a jsdom stub happened to behave.
 */
export default defineConfig({
  resolve: {
    // Same alias the app build uses: `office-crypto` imports Node's `crypto`.
    alias: [{ find: /^crypto$/, replacement: officeCryptoShim() }],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: 'dot',
  },
});
