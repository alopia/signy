/**
 * The browser tier: runs a suite in headless Chromium through Playwright.
 * The suite, the Signy build and measure.ts are bundled into one script, and
 * each job gets a fresh browser, like a node job gets a fresh process.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { ROOT } from './build.ts';
import type { WorkerResult } from './measure.ts';

const BENCH_DIR = join(ROOT, 'bench');
const PAGE_URL = 'http://signy-bench.localhost/';

/** Whether Playwright's Chromium is installed, so --save can include the tier */
export function chromiumInstalled(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

/** The page side: gc() from --expose-gc, heap from precise memory info */
const PAGE_HOST = `
const gc = globalThis.gc;
const host = {
  fullGc() {
    if (!gc) throw new Error('the page needs --js-flags=--expose-gc');
    for (let i = 0; i < 3; i++) gc();
  },
  heapUsed: () => performance.memory.usedJSHeapSize,
  // Chromium reports no GC events to the page. A heap that shrank means one ran.
  withGcCheck(fn) {
    const bytes = fn();
    return { bytes, gcRan: bytes < 0 };
  },
  // An isolated page still rounds performance.now() to 5µs
  sampleTargetNs: 1_000_000,
};
`;

async function bundle(
  suiteFile: string,
  signyBuild: string,
  outDir: string
): Promise<string> {
  mkdirSync(outDir, { recursive: true });
  const outfile = join(outDir, 'page.js');
  await build({
    stdin: {
      contents: `
        import suite from ${JSON.stringify(suiteFile)};
        import * as signy from ${JSON.stringify(signyBuild)};
        import { keepSink, runSuite } from ${JSON.stringify(join(BENCH_DIR, 'measure.ts'))};
        ${PAGE_HOST}
        globalThis.__runBench = async (options) => {
          const result = await runSuite(suite, signy, host, options, (line) => console.log(line));
          if (keepSink() === Symbol.for('never')) console.log('');
          return result;
        };
      `,
      resolveDir: BENCH_DIR,
      sourcefile: 'bench-page.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    outfile,
    logLevel: 'error',
  });
  return outfile;
}

/**
 * Runs the time cases of a suite, or one memory case, in a fresh Chromium.
 */
export async function runBrowserJob(
  suiteFile: string,
  signyBuild: string,
  buildDir: string,
  options: { quick: boolean; filter?: string; memoryCase?: string },
  log: (line: string) => void
): Promise<WorkerResult> {
  const script = await bundle(suiteFile, signyBuild, join(buildDir, 'browser'));
  const browser = await chromium.launch({
    args: ['--js-flags=--expose-gc', '--enable-precise-memory-info'],
  });
  try {
    const page = await browser.newPage();
    page.on('console', (message) => log(message.text()));
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // A real origin with COOP and COEP: cross origin isolated pages get the
    // finest timer, and sessionStorage works
    await page.route(PAGE_URL, (route) =>
      route.fulfill({
        contentType: 'text/html',
        headers: {
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp',
        },
        body: '<!doctype html><html><body></body></html>',
      })
    );
    await page.goto(PAGE_URL);
    if (!(await page.evaluate(() => crossOriginIsolated))) {
      throw new Error('the bench page is not cross origin isolated');
    }
    await page.addScriptTag({ path: script });
    const result = (await page.evaluate(
      (opts) =>
        (
          globalThis as unknown as {
            __runBench(o: typeof opts): Promise<unknown>;
          }
        ).__runBench(opts),
      options
    )) as WorkerResult;
    if (errors.length > 0) throw new Error(errors.join('\n'));
    return result;
  } finally {
    await browser.close();
  }
}
