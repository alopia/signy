export interface Stats {
  mean: number;
  median: number;
  p75: number;
  p99: number;
  min: number;
  max: number;
  sd: number;
  /** Relative margin of error of the mean at 95%, in percent. */
  rme: number;
  samples: number;
}

export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] as number;
  const b = sorted[hi] as number;
  return a + (b - a) * (pos - lo);
}

export function summarize(samples: readonly number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  let sum = 0;
  for (const v of sorted) sum += v;
  const mean = sum / n;
  let sq = 0;
  for (const v of sorted) sq += (v - mean) ** 2;
  const sd = n > 1 ? Math.sqrt(sq / (n - 1)) : 0;
  return {
    mean,
    median: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
    p99: quantile(sorted, 0.99),
    min: sorted[0] as number,
    max: sorted[n - 1] as number,
    sd,
    rme: n > 1 ? ((1.96 * sd) / Math.sqrt(n) / mean) * 100 : 0,
    samples: n,
  };
}

/** Keeps `count` evenly spaced quantiles, so a saved run stays small but keeps its shape. */
export function thin(samples: readonly number[], count: number): number[] {
  const sorted = [...samples].sort((a, b) => a - b);
  if (sorted.length <= count) return sorted;
  const out = new Array<number>(count);
  for (let i = 0; i < count; i++) out[i] = quantile(sorted, i / (count - 1));
  return out;
}

/** Two sided Mann-Whitney U test with tie correction. Timings are not normal, so no t-test. */
export function mannWhitney(
  a: readonly number[],
  b: readonly number[]
): number {
  const n1 = a.length;
  const n2 = b.length;
  if (n1 === 0 || n2 === 0) return 1;
  const all = [
    ...a.map((v) => ({ v, g: 0 })),
    ...b.map((v) => ({ v, g: 1 })),
  ].sort((x, y) => x.v - y.v);
  const n = all.length;
  let rankA = 0;
  let ties = 0;
  for (let i = 0; i < n;) {
    let j = i;
    while (j + 1 < n && (all[j + 1] as { v: number }).v === all[i]!.v) j++;
    const rank = (i + j) / 2 + 1;
    const t = j - i + 1;
    ties += t ** 3 - t;
    for (let k = i; k <= j; k++) if (all[k]!.g === 0) rankA += rank;
    i = j + 1;
  }
  const u = rankA - (n1 * (n1 + 1)) / 2;
  const mu = (n1 * n2) / 2;
  const sigma = Math.sqrt(((n1 * n2) / 12) * (n + 1 - ties / (n * (n - 1))));
  if (sigma === 0) return 1;
  const z = (Math.abs(u - mu) - 0.5) / sigma;
  return Math.min(1, 2 * (1 - normalCdf(z)));
}

function normalCdf(z: number): number {
  // Abramowitz and Stegun 7.1.26, error below 1.5e-7.
  const t = 1 / (1 + 0.3275911 * (z / Math.SQRT2));
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-(z * z) / 2);
  return 0.5 * (1 + erf);
}

export function formatOps(ops: number): string {
  if (ops >= 1e6) return `${(ops / 1e6).toFixed(2)}M/s`;
  if (ops >= 1e3) return `${(ops / 1e3).toFixed(1)}k/s`;
  return `${ops.toFixed(1)}/s`;
}
