import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { GCProfiler } from 'node:v8';
import { keepSink, runSuite, type Host } from './measure.ts';
import type { Signy, Suite } from './suite.ts';

export type { MemoryMetric, TimeResult, WorkerResult } from './measure.ts';

const gc = (globalThis as { gc?: () => void }).gc;

const nodeHost: Host = {
  fullGc() {
    if (!gc) throw new Error('worker needs --expose-gc');
    for (let i = 0; i < 3; i++) gc();
  },
  heapUsed: () => process.memoryUsage().heapUsed,
  withGcCheck(fn) {
    const profiler = new GCProfiler();
    profiler.start();
    const bytes = fn();
    const gcs = profiler.stop()?.statistics.length ?? 0;
    return { bytes, gcRan: gcs > 0 };
  },
  sampleTargetNs: 20_000,
};

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      suite: { type: 'string' },
      build: { type: 'string' },
      out: { type: 'string' },
      filter: { type: 'string' },
      // Each memory case gets a process of its own, garbage from one case
      // can otherwise be collected during the next.
      'memory-case': { type: 'string' },
      quick: { type: 'boolean', default: false },
      'skip-unsupported': { type: 'boolean', default: false },
    },
  });
  if (!values.suite || !values.build || !values.out) {
    throw new Error(
      'usage: worker.ts --suite <file> --build <file> --out <file>'
    );
  }
  const suite = (await import(pathToFileURL(values.suite).href))
    .default as Suite;
  const signy = (await import(pathToFileURL(values.build).href)) as Signy;

  const out = await runSuite(
    suite,
    signy,
    nodeHost,
    {
      quick: values.quick,
      filter: values.filter,
      memoryCase: values['memory-case'],
      skipUnsupported: values['skip-unsupported'],
    },
    (line) => process.stderr.write(line + '\n')
  );
  writeFileSync(values.out, JSON.stringify(out));
  // Keeps the result used, so V8 cannot drop the timed work as dead code.
  if (keepSink() === Symbol.for('never')) process.stderr.write('');
}

await main();
