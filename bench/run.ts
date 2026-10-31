import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { bundleSigny, extractRef, measureSizes, ROOT } from './build.ts';
import {
  compareRuns,
  DEFAULTS,
  renderComparison,
  type Comparison,
} from './compare.ts';
import { collectEnv, envWarnings, hasTaskset } from './env.ts';
import {
  envLine,
  loadResult,
  renderRun,
  RESULTS_DIR,
  resultPath,
  type RunResult,
} from './report.ts';
import { matches, type Suite, type Tier } from './suite.ts';
import { mergeRuns, type WorkerResult } from './measure.ts';
import { chromiumInstalled, runBrowserJob } from './browser.ts';

const BENCH_DIR = join(ROOT, 'bench');
const BUILD_DIR = join(BENCH_DIR, '.build');
const SUITES_DIR = join(BENCH_DIR, 'suites');
// Worker processes per suite. One process cannot see its own JIT and CPU luck.
const RUNS = 5;

const HELP = `usage: npm run bench -- [options]

  --save <name>       save to bench/results/<name>.json and .md
  --compare <base>    compare with a saved result (name or path)
  --ab <git ref>      build <ref> and run it interleaved with the working tree
  --filter <text>     only cases whose "suite/case" id contains <text>
  --browser           also run the browser tier in headless Chromium. --save
                      includes it whenever Chromium is installed
  --quick             one process and fewer samples, never for a baseline
  --cpu <n|none>      CPU to pin to (default $BENCH_CPU or 2)
  --threshold <pct>   smallest change that counts (default ${DEFAULTS.threshold})
  --force             overwrite an existing saved result
  --json              print JSON instead of the report

Exits with 1 when a comparison finds a regression.
`;

function log(line: string): void {
  process.stderr.write(line + '\n');
}

function pickCpu(arg: string | undefined): number | null {
  const value = arg ?? process.env['BENCH_CPU'] ?? '2';
  if (value === 'none' || !hasTaskset()) return null;
  const cpu = Number(value);
  if (!Number.isInteger(cpu) || cpu < 0) {
    throw new Error(`--cpu must be a CPU index or "none", got ${value}`);
  }
  return cpu < os.cpus().length ? cpu : 0;
}

function suiteFiles(): string[] {
  return readdirSync(SUITES_DIR)
    .filter((f) => f.endsWith('.bench.ts'))
    .sort()
    .map((f) => join(SUITES_DIR, f));
}

interface Job {
  file: string;
  suite: string;
  tier: Tier;
  /** Unset for the time cases of a suite, which share one process. */
  memoryCase?: string;
}

async function planJobs(
  filter: string | undefined,
  tiers: readonly Tier[]
): Promise<Job[]> {
  const jobs: Job[] = [];
  for (const file of suiteFiles()) {
    const suite = (await import(pathToFileURL(file).href)).default as Suite;
    if (!tiers.includes(suite.tier)) {
      log(`skipping ${suite.name}: the ${suite.tier} tier is not selected`);
      continue;
    }
    const ids = (cases: object | undefined) =>
      Object.keys(cases ?? {}).filter((name) =>
        matches(`${suite.name}/${name}`, filter)
      );
    const tier = suite.tier;
    if (ids(suite.time).length > 0) {
      jobs.push({ file, suite: suite.name, tier });
    }
    for (const name of ids(suite.memory)) {
      jobs.push({ file, suite: suite.name, tier, memoryCase: name });
    }
  }
  return jobs;
}

async function runJob(
  job: Job,
  build: string,
  cpu: number | null,
  quick: boolean,
  filter: string | undefined
): Promise<WorkerResult> {
  if (job.tier === 'browser') {
    return runBrowserJob(
      job.file,
      build,
      BUILD_DIR,
      { quick, filter, memoryCase: job.memoryCase },
      log
    );
  }
  mkdirSync(BUILD_DIR, { recursive: true });
  const out = join(BUILD_DIR, `worker-${process.pid}.json`);
  const args = [
    '--expose-gc',
    '--max-semi-space-size=64',
    join(BENCH_DIR, 'worker.ts'),
    '--suite',
    job.file,
    '--build',
    build,
    '--out',
    out,
    ...(quick ? ['--quick'] : []),
    ...(filter ? ['--filter', filter] : []),
    ...(job.memoryCase === undefined ? [] : ['--memory-case', job.memoryCase]),
  ];
  const [cmd, ...rest] =
    cpu === null
      ? [process.execPath, ...args]
      : ['taskset', '-c', String(cpu), process.execPath, ...args];
  // Worker stdout goes to our stderr, so --json output stays clean.
  const result = spawnSync(cmd as string, rest, {
    stdio: ['ignore', 2, 2],
    cwd: ROOT,
  });
  if (result.status !== 0) {
    throw new Error(
      `worker for ${job.memoryCase ?? job.suite} failed with status ${result.status}`
    );
  }
  return JSON.parse(readFileSync(out, 'utf8')) as WorkerResult;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      save: { type: 'string' },
      compare: { type: 'string' },
      ab: { type: 'string' },
      filter: { type: 'string' },
      quick: { type: 'boolean', default: false },
      browser: { type: 'boolean', default: false },
      cpu: { type: 'string' },
      threshold: { type: 'string' },
      force: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    process.stdout.write(HELP);
    return;
  }
  if (values.save !== undefined) {
    if (!/^[\w.-]+$/.test(values.save)) {
      throw new Error('--save takes a plain name like before-unmount-leak');
    }
    if (existsSync(resultPath(values.save)) && !values.force) {
      throw new Error(
        `bench/results/${values.save}.json exists, pick another name or pass --force`
      );
    }
  }
  if (values.compare !== undefined && values.ab !== undefined) {
    throw new Error('use either --compare or --ab, not both');
  }
  // Fail before a long run, not after it.
  const base = values.compare ? loadResult(values.compare) : null;
  const options = {
    ...DEFAULTS,
    threshold: values.threshold ? Number(values.threshold) : DEFAULTS.threshold,
  };

  const started = Date.now();
  const cpu = pickCpu(values.cpu);
  const env = collectEnv(cpu);
  log(
    `signy bench: ${env.git.short} on ${env.git.branch}${env.git.dirty ? ' with uncommitted changes' : ''}`
  );
  log(`  ${envLine(env)}`);
  for (const w of envWarnings(env)) log(`  warning: ${w}`);

  const head = await bundleSigny(ROOT, join(BUILD_DIR, 'head'));
  let baseBuild: string | null = null;
  let abSha = '';
  if (values.ab) {
    abSha = spawnSync(
      'git',
      ['rev-parse', '--verify', `${values.ab}^{commit}`],
      {
        cwd: ROOT,
        encoding: 'utf8',
      }
    ).stdout.trim();
    if (!abSha) throw new Error(`--ab: unknown git ref ${values.ab}`);
    const tree = join(BUILD_DIR, 'ab-tree');
    extractRef(abSha, tree);
    baseBuild = await bundleSigny(tree, join(BUILD_DIR, 'ab'));
    log(
      `  A/B: ${values.ab} (${abSha.slice(0, 7)}) vs working tree, interleaved`
    );
  }

  // A saved baseline covers the browser tier too, when it can run here
  const withBrowser =
    values.browser || (values.save !== undefined && chromiumInstalled());
  if (values.browser && !chromiumInstalled()) {
    throw new Error(
      '--browser needs Chromium: npx playwright install chromium'
    );
  }
  const tiers: Tier[] = withBrowser ? ['node', 'browser'] : ['node'];
  const jobs = await planJobs(values.filter, tiers);
  const runs = values.quick ? 1 : RUNS;
  const headParts: WorkerResult[] = [];
  const baseParts: WorkerResult[] = [];
  const side = async (build: string, parts: WorkerResult[], job: Job) => {
    parts.push(await runJob(job, build, cpu, values.quick, values.filter));
  };
  // Repeats go round all suites, so a slow minute on the machine hits every
  // case a little instead of one case a lot.
  for (let r = 0; r < runs; r++) {
    for (const job of jobs.filter((j) => j.memoryCase === undefined)) {
      log(
        `run ${r + 1}/${runs}, ${job.suite}${baseBuild ? ', base then working tree' : ''}`
      );
      if (baseBuild) await side(baseBuild, baseParts, job);
      await side(head, headParts, job);
    }
  }
  for (const job of jobs.filter((j) => j.memoryCase !== undefined)) {
    if (baseBuild) await side(baseBuild, baseParts, job);
    await side(head, headParts, job);
  }

  // Sizes are deterministic and cheap, but a filtered run is about specific cases.
  const sizes = values.filter ? [] : await measureSizes(ROOT);
  const refGit = {
    ...env.git,
    sha: abSha,
    short: abSha.slice(0, 7),
    dirty: false,
    diffHash: '',
  };
  const finish = (parts: WorkerResult[], ref: string | null): RunResult => ({
    schema: 1,
    name: ref ? null : (values.save ?? null),
    createdAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    quick: values.quick,
    filter: values.filter ?? null,
    ref,
    env: ref ? { ...env, git: refGit } : env,
    time: mergeRuns(parts),
    memory: parts.flatMap((p) => p.memory),
    sizes,
  });
  const run = finish(headParts, null);
  let comparison: Comparison | null = null;
  if (values.ab) {
    const baseRun = {
      ...finish(baseParts, values.ab),
      sizes: values.filter
        ? []
        : await measureSizes(join(BUILD_DIR, 'ab-tree')),
    };
    comparison = compareRuns(baseRun, run, options);
  } else if (base) {
    comparison = compareRuns(base, run, options);
  }

  if (values.save) {
    mkdirSync(RESULTS_DIR, { recursive: true });
    writeFileSync(resultPath(values.save), JSON.stringify(run, null, 1));
    const md =
      renderRun(run, 'md') +
      (comparison ? '\n' + renderComparison(comparison, 'md') : '');
    writeFileSync(join(RESULTS_DIR, `${values.save}.md`), md);
    log(`saved bench/results/${values.save}.json and .md`);
  }

  if (values.json) {
    process.stdout.write(
      JSON.stringify(comparison ? { run, comparison } : run) + '\n'
    );
  } else {
    process.stdout.write('\n' + renderRun(run, 'text'));
    if (comparison)
      process.stdout.write('\n' + renderComparison(comparison, 'text'));
  }
  if (comparison && comparison.regressions > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  log(`bench: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});
