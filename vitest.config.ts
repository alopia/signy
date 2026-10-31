import { fileURLToPath } from 'node:url';
import { transformAsync } from '@babel/core';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig, type Plugin } from 'vitest/config';

// Compiles test .tsx files the way users do, with babel-plugin-jsx-dom-expressions.
function signyJsx(): Plugin {
  return {
    name: 'signy-jsx',
    enforce: 'pre',
    async transform(code, id) {
      if (!id.endsWith('.tsx')) return null;
      const result = await transformAsync(code, {
        filename: id,
        babelrc: false,
        configFile: false,
        sourceMaps: true,
        presets: [
          [
            '@babel/preset-typescript',
            { isTSX: true, allExtensions: true, onlyRemoveTypeImports: true },
          ],
        ],
        plugins: [
          [
            'babel-plugin-jsx-dom-expressions',
            {
              moduleName: 'signy/jsx',
              effectWrapper: 'createRenderEffect',
              generate: 'dom',
              delegateEvents: true,
              wrapConditionals: true,
            },
          ],
        ],
      });
      return result?.code ? { code: result.code, map: result.map } : null;
    },
  };
}

// SIGNY_BROWSERS=chromium,firefox skips a browser this machine cannot run
const browsers = (
  process.env['SIGNY_BROWSERS'] ?? 'chromium,firefox,webkit'
).split(',') as Array<'chromium' | 'firefox' | 'webkit'>;

// One jsdom per worker, reused across files: jsdom setup was most of the run.
// setup.ts resets the DOM, the scheduler and the config after each test.
const dom = {
  environment: 'jsdom',
  setupFiles: ['test/support/setup.ts'],
  isolate: false,
};

export default defineConfig({
  define: {
    __DEV__: true,
    __VERSION__: JSON.stringify('1.0.0'),
  },
  resolve: {
    alias: {
      'signy/jsx': fileURLToPath(
        new URL('./src/jsx/index.ts', import.meta.url)
      ),
    },
  },
  test: {
    globals: true,
    restoreMocks: true,
    unstubGlobals: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          ...dom,
          include: ['test/**/*.test.ts'],
          exclude: ['test/browser/**', 'test/package/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'types',
          include: [],
          typecheck: {
            enabled: true,
            only: true,
            include: ['test/types/**/*.test-d.ts'],
          },
        },
      },
      {
        extends: true,
        plugins: [signyJsx()],
        test: {
          name: 'jsx',
          ...dom,
          include: ['test/jsx/**/*.test.tsx'],
        },
      },
      {
        // Not extended: the root aliases signy/jsx to src, this must use dist
        test: {
          name: 'package',
          environment: 'node',
          include: ['test/package/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          setupFiles: dom.setupFiles,
          include: ['test/browser/**/*.browser.test.ts'],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: browsers.map((browser) => ({ browser })),
          },
        },
      },
    ],
    coverage: {
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/index.ts',
        'src/**/log-messages.ts',
        'src/**/types.ts',
        'src/types/**',
        'src/core/feature-types.ts',
      ],
      thresholds: {
        lines: 90,
        branches: 80,
        functions: 89,
        statements: 90,
        'src/{reactivity,views,router}/**': { lines: 90, branches: 80 },
      },
    },
  },
});
