import type * as SignyModule from '../src/index.ts';
import type {
  longestIncreasingSubsequence,
  reconcile,
} from '../src/views/reconcile.ts';

/** What `build.ts` bundles: the public API plus a few internals worth timing. */
export type Signy = typeof SignyModule & {
  longestIncreasingSubsequence: typeof longestIncreasingSubsequence;
  reconcile: typeof reconcile;
};

export type Tier = 'node' | 'browser';

export interface TimedOp {
  /** The timed work. Must be repeatable without a reset unless `beforeEach` is set. */
  run: () => unknown;
  /** `run` returns a promise to await, as a navigation does. Timed one op per sample. */
  async?: boolean;
  /** Runs before every `run`, not timed. Disables batching, so keep `run` above ~10µs. */
  beforeEach?: () => void;
  teardown?: () => void;
}

export interface MemoryOp {
  /** One cycle of the work checked for leaks, for example mount then unmount. */
  cycle: () => void;
  cycles: number;
  /** Counters read after the cycles. Lower is better, a leak free run reports 0 or 1. */
  probe?: () => Record<string, number>;
  teardown?: () => void;
}

export interface Suite {
  name: string;
  tier: Tier;
  time?: Record<string, (s: Signy) => TimedOp>;
  memory?: Record<string, (s: Signy) => MemoryOp>;
}

export function defineSuite(suite: Suite): Suite {
  return suite;
}

/** `--filter` is a case insensitive substring of the "suite/case" id. */
export function matches(id: string, filter: string | undefined): boolean {
  return !filter || id.toLowerCase().includes(filter.toLowerCase());
}

/** Deterministic PRNG, so shuffles are the same on every run and every ref. */
export function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const random = seeded(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}
