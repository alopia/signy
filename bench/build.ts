import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { build } from 'esbuild';

export const ROOT = join(import.meta.dirname, '..');

// Same entries as tsup.config.ts. Sizes are esbuild minified, so they track
// changes rather than match the published terser output byte for byte.
const SIZE_ENTRIES: Record<string, string> = {
  signy: 'src/index.ts',
  core: 'src/core/index.ts',
  web: 'src/web/index.ts',
  app: 'src/app/index.ts',
  router: 'src/router/index.ts',
  store: 'src/reactivity/store.ts',
  jsx: 'src/jsx/index.ts',
};

export interface SizeResult {
  entry: string;
  minified: number;
  gzip: number;
  brotli: number;
}

function defines(): Record<string, string> {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  return {
    __DEV__: 'false',
    __VERSION__: JSON.stringify(pkg.version),
  };
}

/** Bundles the tree at `srcRoot` into `<outDir>/signy.js`, with production defines. */
export async function bundleSigny(
  srcRoot: string,
  outDir: string
): Promise<string> {
  mkdirSync(outDir, { recursive: true });
  const outfile = join(outDir, 'signy.js');
  await build({
    stdin: {
      contents: [
        "export * from './src/index.ts';",
        "export { longestIncreasingSubsequence, reconcile } from './src/views/reconcile.ts';",
      ].join('\n'),
      resolveDir: srcRoot,
      sourcefile: 'bench-entry.ts',
      loader: 'ts',
    },
    // An extracted ref has no node_modules of its own.
    nodePaths: [join(ROOT, 'node_modules')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    target: 'es2022',
    define: defines(),
    outfile,
    logLevel: 'error',
  });
  return outfile;
}

export async function measureSizes(srcRoot: string): Promise<SizeResult[]> {
  const sizes: SizeResult[] = [];
  for (const [entry, file] of Object.entries(SIZE_ENTRIES)) {
    const result = await build({
      entryPoints: [join(srcRoot, file)],
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      target: 'es2022',
      packages: 'external',
      minify: true,
      treeShaking: true,
      define: defines(),
      write: false,
      logLevel: 'error',
    });
    const code = result.outputFiles[0]?.contents ?? new Uint8Array();
    sizes.push({
      entry,
      minified: code.length,
      gzip: gzipSync(code, { level: 9 }).length,
      brotli: brotliCompressSync(code).length,
    });
  }
  return sizes;
}

/** Writes `src/` of a git ref into `dest`, without touching the working tree or git state. */
export function extractRef(ref: string, dest: string): void {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const tar = execFileSync('git', ['archive', '--format=tar', ref, 'src'], {
    cwd: ROOT,
    maxBuffer: 256 * 1024 * 1024,
  });
  execFileSync('tar', ['-x', '-C', dest], { input: tar });
}
