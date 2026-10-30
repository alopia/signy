/**
 * bench:solid: the reactivity, store and list suites on Signy and on Solid,
 * through the adapters in bench/adapters, as one table saved to
 * bench/results/solid-<date>.md. A side by side, never a baseline: it is not
 * meant for --compare.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import { ROOT } from './build.ts';
import { collectEnv, hasTaskset } from './env.ts';
import { mergeRuns, type TimeResult, type WorkerResult } from './measure.ts';
import { RESULTS_DIR, envLine } from './report.ts';
import { formatOps } from './stats.ts';

const BENCH_DIR = join(ROOT, 'bench');
const OUT_DIR = join(BENCH_DIR, '.build', 'solid');
const SUITES = ['reactivity', 'store', 'list'];
const LIBRARIES = ['signy', 'solid'] as const;
const RUNS = 3;

type Library = (typeof LIBRARIES)[number];

function log(line: string): void {
  process.stderr.write(line + '\n');
}

async function bundleAdapter(library: Library): Promise<string> {
  const outfile = join(OUT_DIR, `${library}.js`);
  await build({
    entryPoints: [join(BENCH_DIR, 'adapters', `${library}.ts`)],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    // Solid's browser build, its Node one is the server build
    conditions: ['browser', 'production'],
    target: 'es2022',
    define: {
      __DEV__: 'false',
      __VERSION__: JSON.stringify('bench'),
      'process.env.NODE_ENV': '"production"',
    },
    outfile,
    logLevel: 'error',
  });
  return outfile;
}

function runWorker(
  suite: string,
  adapter: string,
  cpu: number | null,
  quick: boolean
): WorkerResult {
  const out = join(OUT_DIR, `worker-${process.pid}.json`);
  const args = [
    '--expose-gc',
    '--max-semi-space-size=64',
    join(BENCH_DIR, 'worker.ts'),
    '--suite',
    join(BENCH_DIR, 'suites', `${suite}.bench.ts`),
    '--build',
    adapter,
    '--out',
    out,
    '--skip-unsupported',
    ...(quick ? ['--quick'] : []),
  ];
  const [cmd, ...rest] =
    cpu === null
      ? [process.execPath, ...args]
      : ['taskset', '-c', String(cpu), process.execPath, ...args];
  const result = spawnSync(cmd as string, rest, {
    stdio: ['ignore', 2, 2],
    cwd: ROOT,
  });
  if (result.status !== 0) throw new Error(`worker for ${suite} failed`);
  return JSON.parse(readFileSync(out, 'utf8')) as WorkerResult;
}

function solidVersion(): string {
  const pkg = JSON.parse(
    readFileSync(join(ROOT, 'node_modules', 'solid-js', 'package.json'), 'utf8')
  ) as { version: string };
  return pkg.version;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      quick: { type: 'boolean', default: false },
      cpu: { type: 'string' },
    },
  });
  mkdirSync(OUT_DIR, { recursive: true });
  const value = values.cpu ?? process.env['BENCH_CPU'] ?? '2';
  const cpu = value === 'none' || !hasTaskset() ? null : Number(value);
  const env = collectEnv(cpu);

  const adapters = {
    signy: await bundleAdapter('signy'),
    solid: await bundleAdapter('solid'),
  };
  const results: Record<Library, TimeResult[]> = { signy: [], solid: [] };
  const skipped = new Map<string, string>();
  const runs = values.quick ? 1 : RUNS;

  for (const suite of SUITES) {
    const parts: Record<Library, WorkerResult[]> = { signy: [], solid: [] };
    for (let r = 0; r < runs; r++) {
      for (const library of LIBRARIES) {
        log(`run ${r + 1}/${runs}, ${suite}, ${library}`);
        const part = runWorker(suite, adapters[library], cpu, values.quick);
        parts[library].push(part);
        for (const s of part.skipped ?? [])
          skipped.set(s.id, `${library}: ${s.reason}`);
      }
    }
    for (const library of LIBRARIES)
      results[library].push(...mergeRuns(parts[library]));
  }

  const date = new Date().toISOString().slice(0, 10);
  const solidById = new Map(results.solid.map((t) => [t.id, t]));
  const lines = [
    `# Signy and Solid, ${date}`,
    '',
    `Signy ${env.git.short}${env.git.dirty ? ' with uncommitted changes' : ''}, solid-js ${solidVersion()}. ${envLine(env)}.`,
    '',
    'The same suites on both, through bench/adapters. A ratio above 1 means Signy does more operations per second. Not a baseline, never used with --compare.',
    values.quick ? '\nQUICK run, rough numbers only.' : '',
    '',
    '| case | Signy | Solid | ratio |',
    '| --- | ---: | ---: | ---: |',
  ];
  for (const signy of results.signy) {
    const solid = solidById.get(signy.id);
    if (!solid) continue;
    const ratio = signy.opsPerSec / solid.opsPerSec;
    lines.push(
      `| ${signy.id} | ${formatOps(signy.opsPerSec)} | ${formatOps(solid.opsPerSec)} | ${ratio.toFixed(2)} |`
    );
  }
  if (skipped.size > 0) {
    lines.push('', 'Skipped, no clean equivalent:', '');
    for (const [id, reason] of skipped) lines.push(`- ${id} (${reason})`);
  }
  const md =
    lines.filter((l, i) => l !== '' || lines[i - 1] !== '').join('\n') + '\n';

  mkdirSync(RESULTS_DIR, { recursive: true });
  const file = join(RESULTS_DIR, `solid-${date}.md`);
  writeFileSync(file, md);
  log(`saved ${file.slice(ROOT.length + 1)}`);
  process.stdout.write('\n' + md);
}

main().catch((error: unknown) => {
  log(`bench:solid: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});
