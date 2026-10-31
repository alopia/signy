import { parseArgs } from 'node:util';
import {
  describeRun,
  envLine,
  formatBytes,
  formatOps,
  formatPercent,
  loadResult,
  runSpread,
  table,
  type Mode,
  type RunResult,
} from './report.ts';
import { mannWhitney } from './stats.ts';
import { matches } from './suite.ts';

export type Verdict =
  | 'slower'
  | 'worse'
  | 'noisy'
  | 'removed'
  | 'new'
  | 'faster'
  | 'better'
  | 'larger'
  | 'smaller'
  | 'same';

const ORDER: Verdict[] = [
  'slower',
  'worse',
  'noisy',
  'removed',
  'new',
  'faster',
  'better',
  'larger',
  'smaller',
  'same',
];

export const REGRESSIONS: Verdict[] = ['slower', 'worse'];

export interface Row {
  id: string;
  before: string;
  after: string;
  delta: number | null;
  verdict: Verdict;
  note: string;
}

export interface Comparison {
  base: string;
  head: string;
  env: string;
  warnings: string[];
  rows: Row[];
  counts: Partial<Record<Verdict, number>>;
  regressions: number;
}

export interface CompareOptions {
  /** Smallest throughput change in percent that counts. */
  threshold: number;
  /** Above this rme in percent, a case measured in one process is noisy. */
  maxRme: number;
  /** Significance level of the Mann-Whitney test. */
  alpha: number;
}

export const DEFAULTS: CompareOptions = {
  threshold: 5,
  maxRme: 5,
  alpha: 0.01,
};

// Retained heap jitters by a few kB between processes even with no change.
const HEAP_SLACK_BYTES = 64 * 1024;

/** True when every head process beat (or lost to) every base process. */
function separated(base: number[], head: number[], faster: boolean): boolean {
  return faster
    ? Math.max(...head) < Math.min(...base)
    : Math.min(...head) > Math.max(...base);
}

function guardRails(base: RunResult, head: RunResult): string[] {
  const a = base.env;
  const b = head.env;
  const warnings: string[] = [];
  if (a.cpuModel !== b.cpuModel) {
    warnings.push(`different CPU: ${a.cpuModel} vs ${b.cpuModel}`);
  }
  if (a.node !== b.node || a.v8 !== b.v8) {
    warnings.push(`different Node: ${a.node} vs ${b.node}`);
  }
  if (a.pinnedCpu !== b.pinnedCpu) {
    warnings.push(`different pinned CPU: ${a.pinnedCpu} vs ${b.pinnedCpu}`);
  }
  if (a.governor !== b.governor) {
    warnings.push(`different governor: ${a.governor} vs ${b.governor}`);
  }
  if (a.benchHash !== b.benchHash) {
    warnings.push(
      'benchmark sources changed between the runs, take a new baseline'
    );
  }
  if (!base.ref && a.git.dirty) {
    warnings.push('the baseline was taken with uncommitted changes');
  }
  if (base.quick || head.quick) {
    warnings.push('a --quick run is involved, treat deltas as rough');
  }
  if (base.filter && base.filter !== head.filter) {
    warnings.push(
      `the baseline only ran cases matching "${base.filter}", others show as new`
    );
  }
  return warnings;
}

export function compareRuns(
  base: RunResult,
  head: RunResult,
  options: CompareOptions = DEFAULTS
): Comparison {
  const rows: Row[] = [];

  const baseTime = new Map(base.time.map((t) => [t.id, t]));
  const headTime = new Map(head.time.map((t) => [t.id, t]));
  for (const [id, b] of headTime) {
    const a = baseTime.get(id);
    if (!a) {
      rows.push({
        id,
        before: '',
        after: formatOps(b.opsPerSec),
        delta: null,
        verdict: 'new',
        note: '',
      });
      continue;
    }
    const delta = ((b.opsPerSec - a.opsPerSec) / a.opsPerSec) * 100;
    const p = mannWhitney(a.samples, b.samples);
    const spread = Math.max(runSpread(a), runSpread(b));
    // A single process per side cannot show its own spread, fall back to rme.
    const single = a.runMedians.length === 1 || b.runMedians.length === 1;
    let verdict: Verdict = 'same';
    if (single && Math.max(a.stats.rme, b.stats.rme) > options.maxRme) {
      verdict = 'noisy';
    } else if (Math.abs(delta) >= options.threshold) {
      // Moved past the threshold. Real only if every run on one side beat
      // every run on the other, else the processes overlap and it is unclear.
      verdict =
        p < options.alpha && separated(a.runMedians, b.runMedians, delta > 0)
          ? delta > 0
            ? 'faster'
            : 'slower'
          : 'noisy';
    }
    const notes: string[] = [];
    if (verdict === 'noisy') {
      notes.push(
        single
          ? `rme ±${a.stats.rme.toFixed(1)}% / ±${b.stats.rme.toFixed(1)}%`
          : `runs overlap, they vary by ${spread.toFixed(1)}%`
      );
    }
    if (a.allocPerOp !== null && b.allocPerOp !== null) {
      const diff = b.allocPerOp - a.allocPerOp;
      if (Math.abs(diff) > Math.max(16, a.allocPerOp * 0.1)) {
        notes.push(
          `alloc/op ${formatBytes(a.allocPerOp)} -> ${formatBytes(b.allocPerOp)}`
        );
      }
    }
    rows.push({
      id,
      before: formatOps(a.opsPerSec),
      after: formatOps(b.opsPerSec),
      delta,
      verdict,
      note: notes.join(', '),
    });
  }
  for (const id of baseTime.keys()) {
    // A filtered rerun against a full baseline only covers its own cases.
    if (!headTime.has(id) && matches(id, head.filter ?? undefined)) {
      rows.push({
        id,
        before: formatOps(baseTime.get(id)!.opsPerSec),
        after: '',
        delta: null,
        verdict: 'removed',
        note: '',
      });
    }
  }

  const key = (m: { id: string; metric: string }) => `${m.id}: ${m.metric}`;
  const baseMem = new Map(base.memory.map((m) => [key(m), m]));
  for (const b of head.memory) {
    const a = baseMem.get(key(b));
    const show = (v: number) =>
      b.unit === 'bytes' ? formatBytes(v) : String(v);
    if (!a) {
      rows.push({
        id: key(b),
        before: '',
        after: show(b.value),
        delta: null,
        verdict: 'new',
        note: '',
      });
      continue;
    }
    const diff = b.value - a.value;
    const slack =
      b.unit === 'bytes'
        ? Math.max(HEAP_SLACK_BYTES, Math.abs(a.value) * 0.1)
        : 0;
    rows.push({
      id: key(b),
      before: show(a.value),
      after: show(b.value),
      delta: a.value === 0 ? null : (diff / Math.abs(a.value)) * 100,
      verdict: diff > slack ? 'worse' : diff < -slack ? 'better' : 'same',
      note: '',
    });
  }

  if (base.sizes.length > 0 && head.sizes.length > 0) {
    const baseSize = new Map(base.sizes.map((s) => [s.entry, s]));
    for (const b of head.sizes) {
      const a = baseSize.get(b.entry);
      if (!a) continue;
      const diff = b.brotli - a.brotli;
      rows.push({
        id: `size: ${b.entry} (brotli)`,
        before: formatBytes(a.brotli),
        after: formatBytes(b.brotli),
        delta: (diff / a.brotli) * 100,
        verdict: diff > 0 ? 'larger' : diff < 0 ? 'smaller' : 'same',
        note: diff === 0 ? '' : `${diff > 0 ? '+' : ''}${diff} B`,
      });
    }
  }

  rows.sort((x, y) => ORDER.indexOf(x.verdict) - ORDER.indexOf(y.verdict));
  const counts: Partial<Record<Verdict, number>> = {};
  for (const row of rows) counts[row.verdict] = (counts[row.verdict] ?? 0) + 1;
  return {
    base: describeRun(base),
    head: describeRun(head),
    env: envLine(head.env),
    warnings: guardRails(base, head),
    rows,
    counts,
    regressions: rows.filter((r) => REGRESSIONS.includes(r.verdict)).length,
  };
}

export function summaryLine(c: Comparison): string {
  return ORDER.filter((v) => c.counts[v])
    .map((v) => `${c.counts[v]} ${v}`)
    .join(', ');
}

export function renderComparison(
  c: Comparison,
  mode: Mode,
  changedOnly = false
): string {
  const rows = changedOnly
    ? c.rows.filter((r) => r.verdict !== 'same')
    : c.rows;
  const out: string[] = [];
  const title = `signy bench compare: ${c.base} -> ${c.head}`;
  out.push(mode === 'md' ? `## ${title}` : title);
  const meta = [c.env, ...c.warnings.map((w) => `warning: ${w}`)];
  out.push(meta.map((m) => (mode === 'md' ? `- ${m}` : `  ${m}`)).join('\n'));
  out.push(
    table(
      ['case', 'before', 'after', 'delta', 'verdict', 'note'],
      rows.map((r) => [
        r.id,
        r.before,
        r.after,
        r.delta === null ? '' : formatPercent(r.delta),
        REGRESSIONS.includes(r.verdict) ? r.verdict.toUpperCase() : r.verdict,
        r.note,
      ]),
      mode
    ) || '(nothing changed)'
  );
  out.push(summaryLine(c));
  return out.join('\n\n') + '\n';
}

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      threshold: { type: 'string' },
      json: { type: 'boolean', default: false },
      md: { type: 'boolean', default: false },
      'changed-only': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help || positionals.length !== 2) {
    process.stdout.write(
      'usage: npm run bench:compare -- <base> <head> [--threshold 5] [--md] [--changed-only] [--json]\n' +
        '<base> and <head> are names in bench/results/ or paths to result JSON files.\n'
    );
    process.exit(values.help ? 0 : 2);
  }
  const [a, b] = positionals as [string, string];
  const comparison = compareRuns(loadResult(a), loadResult(b), {
    ...DEFAULTS,
    threshold: values.threshold ? Number(values.threshold) : DEFAULTS.threshold,
  });
  process.stdout.write(
    values.json
      ? JSON.stringify(comparison, null, 2) + '\n'
      : renderComparison(
          comparison,
          values.md ? 'md' : 'text',
          values['changed-only']
        )
  );
  process.exitCode = comparison.regressions > 0 ? 1 : 0;
}

if (import.meta.main) main();
