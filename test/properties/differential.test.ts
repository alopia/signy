/**
 * Differential tests: random graphs built twice, with Signy and with the
 * TC39 signal-polyfill, get the same writes and must read the same values and
 * throw on the same reads.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Signal as Polyfill } from 'signal-polyfill';
import { Signal, Computed, batch } from '../../src/reactivity';

/** A node: a sum, a branch that switches dependencies, or one that throws */
type NodeSpec =
  | { kind: 'sum'; deps: number[] }
  | { kind: 'branch'; deps: number[] }
  | { kind: 'throws'; deps: number[] };

interface Graph {
  signals: number;
  nodes: NodeSpec[];
}

const graph: fc.Arbitrary<Graph> = fc
  .integer({ min: 1, max: 4 })
  .chain((signals) =>
    fc
      .array(
        fc.tuple(
          fc.constantFrom('sum', 'branch', 'throws'),
          fc.nat(),
          fc.nat(),
          fc.nat()
        ),
        { minLength: 1, maxLength: 10 }
      )
      .map((raw) => ({
        signals,
        nodes: raw.map(([kind, x, y, z], j) => {
          const before = signals + j;
          return {
            kind,
            deps: [x % before, y % before, z % before],
          } as NodeSpec;
        }),
      }))
  );

/** The node function, given how to read a node by index */
function compute(
  node: NodeSpec,
  j: number,
  read: (i: number) => number
): number {
  const [a, b, c] = node.deps as [number, number, number];
  switch (node.kind) {
    case 'sum':
      return read(a) + read(b) + j;
    case 'branch':
      return read(a) % 2 === 0 ? read(b) : read(c);
    case 'throws': {
      const value = read(a);
      if (value % 3 === 0) throw new Error(`node ${j}`);
      return value;
    }
  }
}

interface Built {
  write(signal: number, value: number): void;
  read(node: number): { value?: number; error?: string };
}

function buildSigny(g: Graph): Built {
  const signals = Array.from(
    { length: g.signals },
    (_, i) => new Signal(i + 1)
  );
  const nodes: Array<Signal<number> | Computed<number>> = [...signals];
  g.nodes.forEach((node, j) => {
    nodes.push(new Computed(() => compute(node, j, (i) => nodes[i]!.value)));
  });
  return {
    write: (s, v) => {
      signals[s]!.value = v;
    },
    read: (n) => attempt(() => nodes[n]!.value),
  };
}

function buildPolyfill(g: Graph): Built {
  const signals = Array.from(
    { length: g.signals },
    (_, i) => new Polyfill.State(i + 1)
  );
  const nodes: Array<Polyfill.State<number> | Polyfill.Computed<number>> = [
    ...signals,
  ];
  g.nodes.forEach((node, j) => {
    nodes.push(
      new Polyfill.Computed(() => compute(node, j, (i) => nodes[i]!.get()))
    );
  });
  return {
    write: (s, v) => signals[s]!.set(v),
    read: (n) => attempt(() => nodes[n]!.get()),
  };
}

function attempt(read: () => number): { value?: number; error?: string } {
  try {
    return { value: read() };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

const steps = fc.array(
  fc.tuple(fc.nat(), fc.integer({ min: -4, max: 4 }), fc.boolean()),
  { maxLength: 25 }
);

describe('Signy against signal-polyfill', () => {
  it('reads the same values and errors after every write', () => {
    fc.assert(
      fc.property(graph, steps, (g, writes) => {
        const signy = buildSigny(g);
        const polyfill = buildPolyfill(g);
        const total = g.signals + g.nodes.length;
        const compareAll = () => {
          for (let n = 0; n < total; n++) {
            expect(signy.read(n)).toEqual(polyfill.read(n));
          }
        };

        compareAll();
        for (const [index, value, inBatch] of writes) {
          const s = index % g.signals;
          if (inBatch) batch(() => signy.write(s, value));
          else signy.write(s, value);
          polyfill.write(s, value);
          compareAll();
        }
      }),
      { numRuns: 300 }
    );
  });

  it('computes each node at most once per read after a write, like the polyfill', () => {
    fc.assert(
      fc.property(graph, steps, (g, writes) => {
        let signyRuns = 0;
        let polyfillRuns = 0;
        const signals = Array.from(
          { length: g.signals },
          (_, i) => new Signal(i + 1)
        );
        const pSignals = Array.from(
          { length: g.signals },
          (_, i) => new Polyfill.State(i + 1)
        );
        const nodes: Array<Signal<number> | Computed<number>> = [...signals];
        const pNodes: Array<
          Polyfill.State<number> | Polyfill.Computed<number>
        > = [...pSignals];
        g.nodes.forEach((node, j) => {
          nodes.push(
            new Computed(() => {
              signyRuns++;
              return compute(node, j, (i) => nodes[i]!.value);
            })
          );
          pNodes.push(
            new Polyfill.Computed(() => {
              polyfillRuns++;
              return compute(node, j, (i) => pNodes[i]!.get());
            })
          );
        });
        const last = nodes.length - 1;
        attempt(() => nodes[last]!.value);
        attempt(() => pNodes[last]!.get());

        for (const [index, value] of writes) {
          const s = index % g.signals;
          signals[s]!.value = value;
          pSignals[s]!.set(value);
          attempt(() => nodes[last]!.value);
          attempt(() => pNodes[last]!.get());
          expect(signyRuns).toBe(polyfillRuns);
        }
      }),
      { numRuns: 200 }
    );
  });
});
