/**
 * The unit tests as one flat project, for Stryker's command runner. Its
 * Vitest runner does not activate mutants with Vitest 5.
 */
import { defineConfig } from 'vitest/config';
import config from './vitest.config';

export default defineConfig({
  define: config.define,
  resolve: config.resolve,
  test: {
    globals: true,
    restoreMocks: true,
    unstubGlobals: true,
    environment: 'jsdom',
    setupFiles: ['test/support/setup.ts'],
    // As in vitest.config.ts: one jsdom per worker, reused across files
    isolate: false,
    // Stryker runs several of these at once, so each gets a few workers
    maxWorkers: 4,
    include: ['test/**/*.test.ts'],
    exclude: ['test/browser/**', 'test/package/**'],
  },
});
