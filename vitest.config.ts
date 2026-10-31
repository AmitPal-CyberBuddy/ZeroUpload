import { defineConfig } from 'vitest/config';

/**
 * The suite covers the deterministic logic that the security model rests on:
 * ZIP budgets and sanitisation, page ranges, header parsing, size guards and the
 * worker protocol. No DOM, no React, no browser — plain Node, so the tests are
 * fast and cannot pass because a jsdom stub happened to behave.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: 'dot',
  },
});
