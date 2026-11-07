import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * The DOM project.
 *
 * The main suite (`vitest.config.ts`) deliberately runs in plain Node: no DOM, no
 * React, no browser — which keeps it fast and stops a jsdom stub from being the
 * reason a test passes. The cost of that discipline was that *nothing mounted a
 * component*: 401 tests, and a crash on first paint would not have been noticed.
 *
 * This project is that missing half, and it is kept strictly separate so it can
 * never contaminate the logic suite. It renders real component trees with the real
 * providers and fails on:
 *
 *  - a thrown exception during render, and
 *  - anything React itself logs through `console.error` (invalid DOM nesting,
 *    missing keys, hook-order problems, state updates outside `act`).
 *
 * It is a smoke test, not a behaviour suite: it answers "does this mount", not
 * "does this work". Behaviour is covered by the Node suite and by hand.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['tests/dom/**/*.test.tsx'],
    setupFiles: ['tests/dom/setup.ts'],
    reporters: 'dot',
    // The lazy tool modules pull in large dependency graphs on first import.
    testTimeout: 30_000,
  },
});
