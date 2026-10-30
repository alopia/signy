import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import { join, relative } from 'node:path';
import { ROOT } from './build.ts';

export interface Env {
  git: {
    sha: string;
    short: string;
    branch: string;
    dirty: boolean;
    /** Hash of the uncommitted changes in runtime files, empty when clean. */
    diffHash: string;
  };
  /** Hash of the benchmark sources, so a changed benchmark is detected. */
  benchHash: string;
  node: string;
  v8: string;
  os: string;
  cpuModel: string;
  /** null when taskset is missing or not on Linux. */
  pinnedCpu: number | null;
  coreType: 'performance' | 'efficiency' | 'unknown';
  governor: string;
  loadavg: number[];
}

// Files that change what gets measured. Everything else (docs, tests, ai/) is ignored.
const RUNTIME_PATHS = ['src', 'bench', 'package.json', 'package-lock.json'];

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function hashFiles(dir: string, skip: string[]): string {
  const hash = createHash('sha256');
  const walk = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      const rel = relative(dir, full);
      if (skip.some((s) => rel === s || rel.startsWith(s + '/'))) continue;
      if (statSync(full).isDirectory()) walk(full);
      else hash.update(rel).update(readFileSync(full));
    }
  };
  walk(dir);
  return hash.digest('hex').slice(0, 12);
}

function readSys(path: string): string {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return '';
  }
}

/** Parses a kernel cpu list like "0-11,16" into a set. */
function cpuList(text: string): Set<number> {
  const cpus = new Set<number>();
  for (const part of text.split(',').filter(Boolean)) {
    const [from, to] = part.split('-').map(Number) as [number, number?];
    for (let i = from; i <= (to ?? from); i++) cpus.add(i);
  }
  return cpus;
}

export function hasTaskset(): boolean {
  if (process.platform !== 'linux') return false;
  try {
    execFileSync('taskset', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function collectEnv(cpu: number | null): Env {
  const status = git(['status', '--porcelain', '--', ...RUNTIME_PATHS]);
  const diffHash = status
    ? createHash('sha256')
        .update(git(['diff', 'HEAD', '--', ...RUNTIME_PATHS]))
        .update(status)
        .digest('hex')
        .slice(0, 12)
    : '';
  const sha = git(['rev-parse', 'HEAD']);
  const probe = cpu ?? 0;
  let coreType: Env['coreType'] = 'unknown';
  if (existsSync('/sys/devices/cpu_core/cpus')) {
    if (cpuList(readSys('/sys/devices/cpu_core/cpus')).has(probe)) {
      coreType = 'performance';
    } else if (cpuList(readSys('/sys/devices/cpu_atom/cpus')).has(probe)) {
      coreType = 'efficiency';
    }
  }
  return {
    git: {
      sha,
      short: sha.slice(0, 7),
      branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
      dirty: status !== '',
      diffHash,
    },
    benchHash: hashFiles(join(ROOT, 'bench'), ['results', '.build']),
    node: process.version,
    v8: process.versions.v8,
    os: `${os.type()} ${os.release()}`,
    cpuModel: os.cpus()[0]?.model.trim() ?? 'unknown',
    pinnedCpu: cpu,
    coreType,
    governor:
      readSys(`/sys/devices/system/cpu/cpu${probe}/cpufreq/scaling_governor`) ||
      'unknown',
    loadavg: os.loadavg().map((l) => Math.round(l * 100) / 100),
  };
}

/** Warnings about this machine that make numbers less reliable. */
export function envWarnings(env: Env): string[] {
  const warnings: string[] = [];
  if (env.pinnedCpu === null) {
    warnings.push('not pinned to a CPU (taskset missing), expect more noise');
  }
  if (env.coreType === 'efficiency') {
    warnings.push(
      `cpu ${env.pinnedCpu} is an efficiency core, pick a performance core with --cpu`
    );
  }
  if (env.governor !== 'performance' && env.governor !== 'unknown') {
    warnings.push(
      `governor is ${env.governor}, for steadier numbers run: sudo cpupower frequency-set -g performance`
    );
  }
  const cores = os.cpus().length;
  if ((env.loadavg[0] ?? 0) > cores / 4) {
    warnings.push(
      `load average ${env.loadavg[0]} on ${cores} CPUs, something else is running`
    );
  }
  return warnings;
}
