import { availableParallelism } from 'node:os';

/**
 * Each run is a whole Vitest process with 4 workers (vitest.mutation.config.ts),
 * so one run per 4 cores. Stryker's default, one per core, starves every run
 * and reports each mutant as timed out.
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
export default {
  testRunner: 'command',
  mutate: [
    'src/reactivity/**/*.ts',
    'src/views/reconcile.ts',
    'src/router/route.ts',
    '!src/reactivity/**/index.ts',
    '!src/reactivity/**/log-messages.ts',
    '!src/reactivity/testing.ts',
  ],
  coverageAnalysis: 'off',
  concurrency: Math.max(1, Math.floor(availableParallelism() / 4)),
  timeoutMS: 10000,
  reporters: ['clear-text', 'progress', 'html'],
  htmlReporter: {
    fileName: 'reports/mutation/index.html',
  },
  thresholds: {
    high: 80,
    low: 60,
    break: null,
  },
  commandRunner: {
    command:
      'npx vitest run --config vitest.mutation.config.ts --bail 1 --silent',
  },
};
