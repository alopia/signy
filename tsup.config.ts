import path from 'node:path';
import * as esbuild from 'esbuild';
import { defineConfig, type Options } from 'tsup';
import pkg from './package.json' with { type: 'json' };

// Shared configuration
const sharedConfig: Partial<Options> = {
  splitting: false,
  sourcemap: true,
  treeshake: true,
  define: {
    __VERSION__: JSON.stringify(pkg.version),
  },
};

// Shared configuration for minified builds
// Use terser minifier to avoid SWC source map race conditions in parallel builds
const minifiedSharedConfig: Partial<Options> = {
  ...sharedConfig,
  minify: 'terser',
};

// Entry points for the library
const mainEntry = { signy: 'src/index.ts' };

// Subexport entries
const coreEntry = { 'core/index': 'src/core/index.ts' };
const webEntry = { 'web/index': 'src/web/index.ts' };
const appEntry = { 'app/index': 'src/app/index.ts' };
const routerEntry = { 'router/index': 'src/router/index.ts' };
const storeEntry = { 'store/index': 'src/reactivity/store.ts' };

// JSX entries
const jsxEntry = {
  'jsx/index': 'src/jsx/index.ts',
  'jsx/jsx-runtime': 'src/jsx/jsx-runtime.ts',
};

// Build mode detection (needs to be before modernConfig)
const buildMode = process.env.BUILD_MODE ?? 'modern';

// ES targets to build (in order from modern to legacy)
const esTargets = ['es2022', 'es2017', 'es5'] as const;
type ESTarget = (typeof esTargets)[number];

// Helper to create ESM config for a specific target
function createEsmConfig(target: ESTarget, minify: boolean): Options {
  const isModern = target === 'es2022';
  const isEs5 = target === 'es5';
  const suffix = isModern ? '' : `.${target}`;
  const minSuffix = minify ? '.min' : '';
  const baseConfig = minify ? minifiedSharedConfig : sharedConfig;

  return {
    ...baseConfig,
    entry: { [`signy${suffix}`]: 'src/index.ts' },
    format: ['esm'],
    dts: false,
    target,
    outDir: 'dist',
    clean: false,
    // Disable source maps for ES5 to avoid SWC internal race condition warnings
    ...(isEs5 ? { sourcemap: false } : {}),
    // Only set minify: false for non-minified builds;
    // minified builds use 'terser' from minifiedSharedConfig
    ...(minify ? {} : { minify: false }),
    outExtension: () => ({ js: `${minSuffix}.js` }),
    define: {
      ...sharedConfig.define,
      __DEV__: minify ? 'false' : 'true',
    },
  };
}

// Helper to create IIFE (global) config for a specific target
function createGlobalConfig(target: ESTarget, minify: boolean): Options {
  const suffix = target === 'es2022' ? '' : `.${target}`;
  const isEs5 = target === 'es5';
  const prodSuffix = minify ? '.prod' : '';
  const baseConfig = minify ? minifiedSharedConfig : sharedConfig;

  return {
    ...baseConfig,
    entry: { [`signy.global${suffix}`]: 'src/index.ts' },
    format: ['iife'],
    dts: false,
    target,
    outDir: 'dist',
    clean: false,
    // Disable source maps for ES5 to avoid SWC internal race condition warnings
    ...(isEs5 ? { sourcemap: false } : {}),
    // Only set minify: false for non-minified builds;
    // minified builds use 'terser' from minifiedSharedConfig
    ...(minify ? {} : { minify: false }),
    globalName: 'Signy',
    outExtension: () => ({ js: `${prodSuffix}.js` }),
    define: {
      ...sharedConfig.define,
      __DEV__: minify ? 'false' : 'true',
    },
  };
}

// Modern build (ES2022) - for bundlers and modern browsers. ES2022 keeps class
// fields native: lowered, each field of each effect, row and signal becomes an
// Object.defineProperty call
// Includes ESM and TypeScript declarations. Split, so every subpath shares one
// copy of the runtime and `signy` and `signy/router` see the same signals.
const modernConfig: Options = {
  ...sharedConfig,
  splitting: true,
  entry: {
    ...mainEntry,
    ...coreEntry,
    ...webEntry,
    ...appEntry,
    ...routerEntry,
    ...storeEntry,
    ...jsxEntry,
  },
  format: ['esm'],
  dts: true,
  target: 'es2022',
  outDir: 'dist',
  clean: buildMode !== 'all', // Don't clean during 'all' mode (cleaned before build starts)
  minify: false,
  // The app's bundler decides, so its production build drops the dev checks.
  // esbuild only defines literals and names, hence the banner.
  banner: {
    js: "const __SIGNY_DEV__ = process.env.NODE_ENV !== 'production';",
  },
  define: {
    ...sharedConfig.define,
    __DEV__: '__SIGNY_DEV__',
  },
};

// Modern minified (ES2022)
const modernMinifiedConfig = createEsmConfig('es2022', true);

// Generate configs for all legacy ES targets
const legacyConfigs: Options[] = esTargets
  .filter((t) => t !== 'es2022') // Skip modern, handled separately
  .flatMap((target) => [
    createEsmConfig(target, false), // Unminified
    createEsmConfig(target, true), // Minified
  ]);

// Global IIFE builds (ES2022, like the modern build)
const globalConfig = createGlobalConfig('es2022', false);
const globalMinifiedConfig = createGlobalConfig('es2022', true);

// Global builds for older browsers
const globalEs2017Config = createGlobalConfig('es2017', false);
const globalEs2017MinifiedConfig = createGlobalConfig('es2017', true);
const globalEs5Config = createGlobalConfig('es5', false);
const globalEs5MinifiedConfig = createGlobalConfig('es5', true);

//=============================================
// CDN Subexport Global Builds
//=============================================

// Names a module exports, from esbuild's metafile
async function exportsOf(file: string): Promise<string[]> {
  const result = await esbuild.build({
    entryPoints: [file],
    bundle: true,
    write: false,
    metafile: true,
    format: 'esm',
    logLevel: 'silent',
    define: { __DEV__: 'true', __VERSION__: '""' },
  });
  return Object.values(result.metafile.outputs)[0]!.exports;
}

interface AddonGlobal {
  /** File or directory bundled into the add-on */
  own: string;
  /** Global builds the add-on reads window.Signy from, besides signy.global.js */
  hostFile: string;
  hostEntry: string;
  file: string;
}

// An add-on with its own copy of the runtime has its own signals, so the app
// never sees its writes. Modules the host globals export
// from are read off window.Signy, the rest is bundled into the add-on.
// esbuild has no globals mapping for IIFE builds.
function useHostGlobal(addon: AddonGlobal): esbuild.Plugin {
  const ownPath = path.resolve(addon.own);
  return {
    name: 'signy-host-global',
    setup(build) {
      // Names on window.Signy whichever host build defined it
      const hostExports = Promise.all([exportsOf(addon.hostEntry), exportsOf(mainEntry.signy)]).then(
        ([host, full]) => new Set(host.filter((n) => full.includes(n)))
      );
      const shared = new Map<string, Promise<string[]>>();

      build.onResolve({ filter: /^signy-host$/ }, () => ({ path: 'signy-host', namespace: 'signy-host-global' }));

      build.onResolve({ filter: /^\./ }, async (args) => {
        // build.resolve() below runs this hook again
        if (args.kind === 'entry-point' || args.pluginData === 'resolving') return undefined;
        const result = await build.resolve(args.path, {
          kind: args.kind,
          resolveDir: args.resolveDir,
          pluginData: 'resolving',
        });
        const file = result.path;
        if (result.errors.length || file === ownPath || file.startsWith(ownPath + path.sep)) {
          return result;
        }
        if (!shared.has(file)) {
          shared.set(
            file,
            Promise.all([exportsOf(file), hostExports]).then(([names, hostNames]) =>
              names.filter((n) => hostNames.has(n))
            )
          );
        }
        const names = await shared.get(file)!;
        return names.length ? { path: file, namespace: 'signy-host-global' } : result;
      });

      // Names the hosts lack stay undeclared, so importing one fails the build
      build.onLoad({ filter: /.*/, namespace: 'signy-host-global' }, async (args) => {
        if (args.path === 'signy-host') {
          return {
            contents:
              `const host = globalThis.Signy;\n` +
              `if (!host) throw new Error('${addon.file} needs ${addon.hostFile} or signy.global.js loaded first');\n` +
              `export default host;\n`,
            loader: 'js',
          };
        }
        const names = await shared.get(args.path)!;
        return {
          contents: `import host from 'signy-host';\nexport const { ${names.join(', ')} } = host;\n`,
          loader: 'js',
        };
      });
    },
  };
}

// Helper to create global config for subexports
function createSubexportGlobalConfig(
  name: string,
  entry: string,
  globalName: string,
  minify: boolean,
  host?: Pick<AddonGlobal, 'own' | 'hostEntry' | 'hostFile'>
): Options {
  const prodSuffix = minify ? '.prod' : '';
  const baseConfig = minify ? minifiedSharedConfig : sharedConfig;

  return {
    ...baseConfig,
    entry: { [`signy.${name}.global`]: entry },
    format: ['iife'],
    dts: false,
    target: 'es2022',
    outDir: 'dist',
    clean: false,
    globalName,
    outExtension: () => ({ js: `${prodSuffix}.js` }),
    define: {
      ...sharedConfig.define,
      __DEV__: minify ? 'false' : 'true',
    },
    ...(host
      ? { esbuildPlugins: [useHostGlobal({ ...host, file: `signy.${name}.global${prodSuffix}.js` })] }
      : {}),
  };
}

// Core global (reactivity only)
const globalCoreConfig = createSubexportGlobalConfig('core', 'src/core/index.ts', 'Signy', false);
const globalCoreMinifiedConfig = createSubexportGlobalConfig('core', 'src/core/index.ts', 'Signy', true);

// Web global (core + DOM + views + components)
const globalWebConfig = createSubexportGlobalConfig('web', 'src/web/index.ts', 'Signy', false);
const globalWebMinifiedConfig = createSubexportGlobalConfig('web', 'src/web/index.ts', 'Signy', true);

// Store addon global (requires core)
const storeHost = { own: 'src/reactivity/store.ts', hostEntry: 'src/core/index.ts', hostFile: 'signy.core.global.js, signy.web.global.js' };
const globalStoreConfig = createSubexportGlobalConfig('store', 'src/reactivity/store.ts', 'SignyStore', false, storeHost);
const globalStoreMinifiedConfig = createSubexportGlobalConfig('store', 'src/reactivity/store.ts', 'SignyStore', true, storeHost);

export default defineConfig(() => {
  switch (buildMode) {
    case 'all':
      // Full distribution build with all targets
      return [
        modernConfig,
        modernMinifiedConfig,
        ...legacyConfigs,
        // Full bundle globals
        globalConfig,
        globalMinifiedConfig,
        globalEs2017Config,
        globalEs2017MinifiedConfig,
        globalEs5Config,
        globalEs5MinifiedConfig,
        // Subexport globals for CDN
        globalCoreConfig,
        globalCoreMinifiedConfig,
        globalWebConfig,
        globalWebMinifiedConfig,
        globalStoreConfig,
        globalStoreMinifiedConfig,
      ];
    case 'minified':
      // Modern + minified variants only
      return [modernConfig, modernMinifiedConfig];
    case 'legacy':
      // All legacy ES targets
      return legacyConfigs;
    case 'global':
      // Global IIFE builds only (all variants)
      return [
        globalConfig,
        globalMinifiedConfig,
        globalEs2017Config,
        globalEs2017MinifiedConfig,
        globalEs5Config,
        globalEs5MinifiedConfig,
        // Subexport globals
        globalCoreConfig,
        globalCoreMinifiedConfig,
        globalWebConfig,
        globalWebMinifiedConfig,
        globalStoreConfig,
        globalStoreMinifiedConfig,
      ];
    case 'modern':
    default:
      // Default: modern ESM (fastest for development)
      return modernConfig;
  }
});
