import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, type SizeResult } from './build.ts';
import { envWarnings, type Env } from './env.ts';
import { formatOps, summarize } from './stats.ts';

export { formatOps };
import type { MemoryMetric, TimeResult } from './measure.ts';

export const RESULTS_DIR = join(ROOT, 'bench', 'results');

export interface RunResult {
  schema: 1;
  name: string | null;
  createdAt: string;
  durationMs: number;
  quick: boolean;
  filter: string | null;
  /** Git ref measured, when it is not the working tree (the base side of --ab). */
  ref: string | null;
  env: Env;
  time: TimeResult[];
  memory: MemoryMetric[];
  sizes: SizeResult[];
}

export type Mode = 'text' | 'md';

/** Spread of the per process medians, in percent of their median. */
export function runSpread(t: TimeResult): number {
  const medians = t.runMedians;
  if (medians.length < 2) return 0;
  const mid = summarize(medians).median;
  return ((Math.max(...medians) - Math.min(...medians)) / mid) * 100;
}

export function resultPath(nameOrPath: string): string {
  if (nameOrPath.endsWith('.json') || nameOrPath.includes('/')) {
    return nameOrPath;
  }
  return join(RESULTS_DIR, `${nameOrPath}.json`);
}

export function loadResult(nameOrPath: string): RunResult {
  const path = resultPath(nameOrPath);
  if (!existsSync(path)) {
    throw new Error(`no saved result at ${path}, save one with --save`);
  }
  const result = JSON.parse(readFileSync(path, 'utf8')) as RunResult;
  if (result.schema !== 1) {
    throw new Error(`${path} has schema ${result.schema}, expected 1`);
  }
  return result;
}

export function formatNs(ns: number): string {
  if (ns >= 1e6) return `${(ns / 1e6).toFixed(2)}ms`;
  if (ns >= 1e3) return `${(ns / 1e3).toFixed(2)}µs`;
  return `${ns.toFixed(1)}ns`;
}

export function formatBytes(bytes: number): string {
  const sign = bytes < 0 ? '-' : '';
  const abs = Math.abs(bytes);
  if (abs >= 1024 * 1024) return `${sign}${(abs / 1024 / 1024).toFixed(2)} MB`;
  if (abs >= 1024) return `${sign}${(abs / 1024).toFixed(1)} kB`;
  return `${sign}${abs} B`;
}

export function formatPercent(delta: number): string {
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`;
}

/** First column left aligned, the rest right aligned. */
export function table(headers: string[], rows: string[][], mode: Mode): string {
  if (rows.length === 0) return '';
  if (mode === 'md') {
    const line = (cells: string[]) =>
      `| ${cells.map((c) => c.replaceAll('|', '\\|')).join(' | ')} |`;
    const rule = headers.map((_, i) => (i === 0 ? '---' : '---:'));
    return [line(headers), line(rule), ...rows.map(line)].join('\n');
  }
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length))
  );
  const line = (cells: string[]) =>
    cells
      .map((c, i) =>
        i === 0 ? c.padEnd(widths[i] ?? 0) : c.padStart(widths[i] ?? 0)
      )
      .join('  ')
      .trimEnd();
  return [line(headers), ...rows.map(line)].join('\n');
}

export function describeRun(run: RunResult): string {
  const { git } = run.env;
  const what = run.ref ? `${run.ref} (${git.short})` : git.short;
  const dirty = !run.ref && git.dirty ? ` + dirty ${git.diffHash}` : '';
  return `${run.name ?? 'unsaved'} (${what}${dirty})`;
}

export function envLine(env: Env): string {
  const cpu =
    env.pinnedCpu === null
      ? 'not pinned'
      : `cpu ${env.pinnedCpu}${env.coreType === 'unknown' ? '' : ` (${env.coreType} core)`}`;
  return `node ${env.node}, ${env.cpuModel}, ${cpu}, governor ${env.governor}, load ${env.loadavg.join(' ')}`;
}

export function renderRun(run: RunResult, mode: Mode): string {
  const { env } = run;
  const heading = (text: string) => (mode === 'md' ? `## ${text}` : text);
  const out: string[] = [];
  out.push(
    mode === 'md'
      ? `# signy bench: ${describeRun(run)}`
      : `signy bench: ${describeRun(run)}`
  );
  const meta = [
    `branch ${env.git.branch}, commit ${env.git.sha}${env.git.dirty ? `, uncommitted changes ${env.git.diffHash}` : ', clean'}`,
    envLine(env),
    `${env.os}, V8 ${env.v8}, bench sources ${env.benchHash}`,
    `${run.createdAt}, took ${(run.durationMs / 1000).toFixed(0)}s${run.quick ? ', QUICK run, not for baselines' : ''}${run.filter ? `, filter "${run.filter}"` : ''}`,
    ...envWarnings(env).map((w) => `warning: ${w}`),
  ];
  out.push(meta.map((m) => (mode === 'md' ? `- ${m}` : `  ${m}`)).join('\n'));

  if (run.time.length > 0) {
    out.push(heading('Timings'));
    out.push(
      table(
        [
          'case',
          'ops/s',
          'median',
          'p99',
          'rme',
          'runs',
          'samples',
          'alloc/op',
        ],
        run.time.map((t) => [
          t.id,
          formatOps(t.opsPerSec),
          formatNs(t.stats.median),
          formatNs(t.stats.p99),
          `±${t.stats.rme.toFixed(1)}%`,
          t.runMedians.length > 1
            ? `${t.runMedians.length}, ${runSpread(t).toFixed(1)}% apart`
            : '1',
          String(t.stats.samples),
          t.allocPerOp === null ? '?' : formatBytes(t.allocPerOp),
        ]),
        mode
      )
    );
  }
  if (run.memory.length > 0) {
    out.push(heading('Memory'));
    out.push(
      table(
        ['case', 'metric', 'value'],
        run.memory.map((m) => [
          m.id,
          m.metric,
          m.unit === 'bytes' ? formatBytes(m.value) : String(m.value),
        ]),
        mode
      )
    );
  }
  if (run.sizes.length > 0) {
    out.push(heading('Bundle size (esbuild minified)'));
    out.push(
      table(
        ['entry', 'minified', 'gzip', 'brotli'],
        run.sizes.map((s) => [
          s.entry,
          formatBytes(s.minified),
          formatBytes(s.gzip),
          formatBytes(s.brotli),
        ]),
        mode
      )
    );
  }
  return out.join('\n\n') + '\n';
}
