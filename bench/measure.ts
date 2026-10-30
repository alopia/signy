/**
 * Times and memory cases, wherever they run: worker.ts in Node, browser.ts in
 * a Chromium page. Results have the same shape in both tiers.
 */
import { Bench } from 'tinybench';
import { formatOps, summarize, thin, type Stats } from './stats.ts';
import {
  matches,
  type MemoryOp,
  type Signy,
  type Suite,
  type TimedOp,
} from './suite.ts';

export interface TimeResult {
  id: string;
  suite: string;
  name: string;
  /** Ops per tinybench sample. Fast ops run in a loop so the timer resolution does not dominate. */
  batch: number;
  /** Per op, in nanoseconds. */
  stats: Stats;
  opsPerSec: number;
  /** Median per op of each worker process. Spread here is noise a single run cannot see. */
  runMedians: number[];
  /** Heap bytes allocated per op, null when a GC got in the way every try. */
  allocPerOp: number | null;
  /** Thinned per op samples in nanoseconds, for the significance test. */
  samples: number[];
}

export interface MemoryMetric {
  id: string;
  suite: string;
  name: string;
  metric: string;
  unit: 'bytes' | 'count';
  value: number;
}

export interface WorkerResult {
  suite: string;
  tier: string;
  time: TimeResult[];
  memory: MemoryMetric[];
  /** Cases left out with skipUnsupported, and why */
  skipped?: Array<{ id: string; reason: string }>;
}

const KEPT_SAMPLES = 1000;

/**
 * What measuring needs from where it runs: Node in a worker process, or a
 * Chromium page for the browser tier.
 */
export interface Host {
  /** Collects garbage until the heap settles */
  fullGc(): void;
  heapUsed(): number;
  /** Runs `fn` and reports whether a GC ran meanwhile, which spoils an allocation count */
  withGcCheck(fn: () => number): { bytes: number; gcRan: boolean };
  /** Time one sample should take, long enough for the clock's resolution */
  sampleTargetNs: number;
}

let sink: unknown;
let host: Host;

/** Keeps a result used, so the engine cannot drop the timed work as dead code. */
export function keepSink(): unknown {
  return sink;
}

function calibrate(op: TimedOp): number {
  if (op.beforeEach || op.async) return 1;
  const until = performance.now() + 30;
  let count = 0;
  while (performance.now() < until) {
    sink = op.run();
    count++;
  }
  const nsPerOp = 30e6 / count;
  return Math.min(
    100_000,
    Math.max(1, Math.ceil(host.sampleTargetNs / nsPerOp))
  );
}

function allocPerOp(op: TimedOp, medianNs: number): number | null {
  // About 5ms of work, short enough to fit in the young generation.
  let n = Math.min(100_000, Math.max(1, Math.round(5e6 / medianNs)));
  for (let attempt = 0; attempt < 5; attempt++, n = Math.max(1, n >> 2)) {
    host.fullGc();
    const { bytes, gcRan } = host.withGcCheck(() => {
      let bytes = 0;
      if (op.beforeEach) {
        // Each read of heapUsed allocates a little, so subtract an empty pair.
        const h0 = host.heapUsed();
        const overhead = host.heapUsed() - h0;
        for (let i = 0; i < n; i++) {
          op.beforeEach();
          const before = host.heapUsed();
          sink = op.run();
          bytes += host.heapUsed() - before - overhead;
        }
      } else {
        const before = host.heapUsed();
        for (let i = 0; i < n; i++) sink = op.run();
        bytes = host.heapUsed() - before;
      }
      return bytes;
    });
    if (!gcRan) return Math.max(0, Math.round(bytes / n));
    if (n === 1) break;
  }
  return null;
}

export async function runTimed(
  suite: Suite,
  name: string,
  factory: (s: Signy) => TimedOp,
  signy: Signy,
  quick: boolean
): Promise<TimeResult> {
  const id = `${suite.name}/${name}`;
  const probe = factory(signy);
  const batch = calibrate(probe);
  probe.teardown?.();

  let op: TimedOp = probe;
  const fn = probe.async
    ? async () => {
        sink = await op.run();
      }
    : batch === 1
      ? () => {
          sink = op.run();
        }
      : () => {
          for (let i = 0; i < batch; i++) sink = op.run();
        };
  const bench = new Bench({
    time: quick ? 300 : 600,
    iterations: quick ? 20 : 50,
    warmupTime: quick ? 100 : 200,
    retainSamples: true,
    throws: true,
  });
  bench.add(id, fn, {
    beforeAll() {
      op = factory(signy);
    },
    afterAll() {
      op.teardown?.();
    },
    beforeEach: probe.beforeEach
      ? () => {
          op.beforeEach?.();
        }
      : undefined,
  });
  host.fullGc();
  await bench.run();

  const result = bench.tasks[0]?.result;
  if (result?.state !== 'completed') {
    throw new Error(`${id} did not complete: ${result?.state}`);
  }
  const perOp = (result.latency.samples ?? []).map((ms) => (ms * 1e6) / batch);
  const stats = summarize(perOp);

  // Allocations across awaits mix with whatever else ran meanwhile
  op = factory(signy);
  const alloc = probe.async ? null : allocPerOp(op, stats.median);
  op.teardown?.();

  return {
    id,
    suite: suite.name,
    name,
    batch,
    stats,
    opsPerSec: 1e9 / stats.median,
    runMedians: [stats.median],
    allocPerOp: alloc,
    samples: thin(perOp, KEPT_SAMPLES),
  };
}

export async function runMemory(
  suite: Suite,
  name: string,
  factory: (s: Signy) => MemoryOp,
  signy: Signy
): Promise<MemoryMetric[]> {
  const id = `${suite.name}/${name}`;
  const op = factory(signy);
  // A first batch settles JIT code, inline caches and table capacity. Each
  // end takes the lowest of 3 readings, because the last disposed cycle or two
  // can stay referenced until the next cycle replaces it.
  const lowest = async (): Promise<number> => {
    let low = Infinity;
    for (let k = 0; k < 3; k++) {
      await cycleOnce();
      signy.flushAll();
      host.fullGc();
      low = Math.min(low, host.heapUsed());
    }
    return low;
  };
  // Microtasks run between cycles, as in an app. In one synchronous loop the
  // flushes they queue pile up and read as growth.
  const cycleOnce = async (): Promise<void> => {
    op.cycle();
    await null;
  };
  for (let i = 0; i < op.cycles; i++) await cycleOnce();
  const before = await lowest();
  for (let i = 0; i < op.cycles; i++) await cycleOnce();
  const retained = (await lowest()) - before;
  const metrics: MemoryMetric[] = [
    {
      id,
      suite: suite.name,
      name,
      metric: `heap growth over ${op.cycles} cycles`,
      unit: 'bytes',
      value: retained,
    },
  ];
  for (const [metric, value] of Object.entries(op.probe?.() ?? {})) {
    metrics.push({ id, suite: suite.name, name, metric, unit: 'count', value });
  }
  op.teardown?.();
  signy.flushAll();
  return metrics;
}

/**
 * Runs the time cases of a suite, or one memory case, on `using`.
 */
export async function runSuite(
  suite: Suite,
  signy: Signy,
  using: Host,
  options: {
    quick: boolean;
    filter?: string;
    memoryCase?: string;
    /** Skip a case that throws, for libraries without every API (bench:solid) */
    skipUnsupported?: boolean;
  },
  log: (line: string) => void
): Promise<WorkerResult> {
  host = using;
  const out: WorkerResult = {
    suite: suite.name,
    tier: suite.tier,
    time: [],
    memory: [],
  };
  if (options.memoryCase !== undefined) {
    const factory = suite.memory?.[options.memoryCase];
    if (!factory) {
      throw new Error(`no memory case ${options.memoryCase} in ${suite.name}`);
    }
    const metrics = await runMemory(suite, options.memoryCase, factory, signy);
    for (const m of metrics)
      log(`  ${`${m.id}: ${m.metric}`.padEnd(64)} ${m.value}`);
    out.memory.push(...metrics);
    return out;
  }
  for (const [name, factory] of Object.entries(suite.time ?? {})) {
    if (!matches(`${suite.name}/${name}`, options.filter)) continue;
    let result: TimeResult;
    try {
      result = await runTimed(suite, name, factory, signy, options.quick);
    } catch (error) {
      if (!options.skipUnsupported) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      (out.skipped ??= []).push({ id: `${suite.name}/${name}`, reason });
      log(`  ${`${suite.name}/${name}`.padEnd(52)} skipped: ${reason}`);
      continue;
    }
    log(
      `  ${result.id.padEnd(52)} ${formatOps(result.opsPerSec).padStart(10)}  ±${result.stats.rme.toFixed(1)}%`
    );
    out.time.push(result);
  }
  return out;
}

/** Merges the time results of several worker processes into one result per case. */
export function mergeRuns(parts: WorkerResult[]): TimeResult[] {
  const byId = new Map<string, TimeResult[]>();
  for (const t of parts.flatMap((p) => p.time)) {
    byId.set(t.id, [...(byId.get(t.id) ?? []), t]);
  }
  return [...byId.values()].map((runs) => {
    const first = runs[0] as TimeResult;
    if (runs.length === 1) return first;
    const pooled = runs.flatMap((r) => r.samples);
    const runMedians = runs.flatMap((r) => r.runMedians);
    const allocs = runs
      .map((r) => r.allocPerOp)
      .filter((a): a is number => a !== null);
    // rme of pooled samples mixes in the shift between processes, which
    // runMedians already shows. Keep the typical rme of one run instead.
    const stats = {
      ...summarize(pooled),
      rme: summarize(runs.map((r) => r.stats.rme)).median,
      samples: runs.reduce((sum, r) => sum + r.stats.samples, 0),
    };
    return {
      ...first,
      stats,
      opsPerSec: 1e9 / summarize(runMedians).median,
      runMedians,
      allocPerOp: allocs.length
        ? Math.round(allocs.reduce((x, y) => x + y, 0) / allocs.length)
        : null,
      samples: thin(pooled, 1000),
    };
  });
}
