import {
  defineSuite,
  seeded,
  shuffled,
  type Signy,
  type TimedOp,
} from '../suite.ts';

interface Row {
  id: number;
  label: string;
}

let nextId = 0;
const rows = (n: number): Row[] =>
  Array.from({ length: n }, () => ({ id: ++nextId, label: `row ${nextId}` }));

// Without `reset`, each run flips the source between `base` and the changed
// list, which works for ops that are their own inverse (swap, reverse).
function mapped(
  s: Signy,
  base: Row[],
  next: (base: Row[]) => Row[],
  reset: boolean
): TimedOp {
  const source = s.signal(base);
  const other = next(base);
  let flipped = false;
  const dispose = s.createRoot((d) => {
    const list = s.mapByItem(
      () => source.value,
      (row, index) => ({ row, index })
    );
    s.effect(() => list());
    return d;
  });
  s.flushAll();
  if (reset) {
    return {
      beforeEach: () => {
        source.value = base;
        s.flushAll();
      },
      run: () => {
        source.value = other;
        s.flushAll();
      },
      teardown: dispose,
    };
  }
  return {
    run: () => {
      flipped = !flipped;
      source.value = flipped ? other : base;
      s.flushAll();
    },
    teardown: dispose,
  };
}

export default defineSuite({
  name: 'list',
  tier: 'node',
  time: {
    'mapByItem: create 1k, dispose': (s) => {
      const data = rows(1000);
      return {
        run: () => {
          const dispose = s.createRoot((d) => {
            const list = s.mapByItem(
              () => data,
              (row, index) => ({ row, index })
            );
            s.effect(() => list());
            return d;
          });
          s.flushAll();
          dispose();
        },
      };
    },
    'mapByItem: append 1k to 1k': (s) =>
      mapped(s, rows(1000), (base) => [...base, ...rows(1000)], true),
    'mapByItem: swap rows 2 and 999': (s) =>
      mapped(
        s,
        rows(1000),
        (base) => {
          const out = [...base];
          [out[1], out[998]] = [out[998] as Row, out[1] as Row];
          return out;
        },
        false
      ),
    'mapByItem: reverse 1k': (s) =>
      mapped(s, rows(1000), (base) => [...base].reverse(), false),
    'mapByItem: shuffle 1k': (s) =>
      mapped(s, rows(1000), (base) => shuffled(base, 42), false),
    'mapByItem: remove every 10th of 1k': (s) =>
      mapped(
        s,
        rows(1000),
        (base) => base.filter((_, i) => i % 10 !== 0),
        true
      ),
    'mapByItem: clear 1k': (s) => mapped(s, rows(1000), () => [], true),
    'mapByIndex: replace every 10th of 1k': (s) => {
      const base = rows(1000);
      const other = base.map((row, i) =>
        i % 10 === 0 ? { ...row, label: `${row.label} !` } : row
      );
      const source = s.signal(base);
      let flipped = false;
      const dispose = s.createRoot((d) => {
        const list = s.mapByIndex(
          () => source.value,
          (row, index) => ({ row, index })
        );
        s.effect(() => list());
        return d;
      });
      s.flushAll();
      return {
        run: () => {
          flipped = !flipped;
          source.value = flipped ? other : base;
          s.flushAll();
        },
        teardown: dispose,
      };
    },
    'LIS: 1k random positions': (s) => {
      const random = seeded(7);
      const positions = Array.from({ length: 1000 }, () =>
        random() < 0.1 ? -1 : Math.floor(random() * 1000)
      );
      return { run: () => s.longestIncreasingSubsequence(positions) };
    },
  },
});
