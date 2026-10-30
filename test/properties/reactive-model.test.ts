/**
 * Model based tests for the reactive core: a random graph of signals,
 * computeds and effects gets random writes, batches, reads and disposals.
 * After each step the real values are compared with a naive model that
 * recomputes everything from scratch.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  Signal,
  Computed,
  batch,
  createRoot,
  effect,
} from '../../src/reactivity';
import { checkInvariants } from '../../src/reactivity/testing';
import { settle } from '../support/tick';

//=============================================
// Graph
//=============================================

/** A computed: a sum, or a branch that switches its dependencies */
type NodeSpec =
  | { kind: 'sum'; deps: [number, number] }
  | { kind: 'branch'; deps: [number, number, number] };

interface GraphSpec {
  signals: number;
  nodes: NodeSpec[];
}

/** Values of signals then computeds, in index order */
function evaluate(spec: GraphSpec, signalValues: number[]): number[] {
  const values = [...signalValues];
  spec.nodes.forEach((node, j) => {
    if (node.kind === 'sum') {
      values.push(values[node.deps[0]]! + values[node.deps[1]]! + j);
    } else {
      const [test, a, b] = node.deps;
      values.push(values[test]! % 2 === 0 ? values[a]! : values[b]!);
    }
  });
  return values;
}

const graphSpec: fc.Arbitrary<GraphSpec> = fc
  .integer({ min: 1, max: 4 })
  .chain((signals) =>
    fc
      .array(fc.tuple(fc.boolean(), fc.nat(), fc.nat(), fc.nat()), {
        minLength: 1,
        maxLength: 8,
      })
      .map((raw) => ({
        signals,
        nodes: raw.map(([branch, x, y, z], j): NodeSpec => {
          const before = signals + j;
          return branch
            ? { kind: 'branch', deps: [x % before, y % before, z % before] }
            : { kind: 'sum', deps: [x % before, y % before] };
        }),
      }))
  );

//=============================================
// Model and real system
//=============================================

interface Model {
  spec: GraphSpec;
  signals: number[];
  /** Node index each live effect reads, by effect id */
  effects: Map<number, number>;
  nextEffect: number;
}

interface Real {
  signals: Signal<number>[];
  /** Signals then computeds, read with .value */
  nodes: Array<Signal<number> | Computed<number>>;
  effects: Map<number, { dispose: () => void; seen: number[] }>;
}

function build(spec: GraphSpec): Real {
  const signals = Array.from({ length: spec.signals }, (_, i) => new Signal(i));
  const nodes: Real['nodes'] = [...signals];
  spec.nodes.forEach((node, j) => {
    const deps = node.deps.map((d) => nodes[d]!);
    nodes.push(
      node.kind === 'sum'
        ? new Computed(() => deps[0]!.value + deps[1]!.value + j)
        : new Computed(() =>
            deps[0]!.value % 2 === 0 ? deps[1]!.value : deps[2]!.value
          )
    );
  });
  return { signals, nodes, effects: new Map() };
}

/** Every live effect saw the model's current value, and nothing is broken */
function checkEffects(model: Model, real: Real): void {
  settle();
  const values = evaluate(model.spec, model.signals);
  for (const [id, node] of model.effects) {
    const seen = real.effects.get(id)!.seen;
    expect(seen[seen.length - 1]).toBe(values[node]);
  }
  expect(checkInvariants()).toEqual([]);
}

//=============================================
// Commands
//=============================================

type Command = fc.Command<Model, Real>;

class Write implements Command {
  constructor(
    readonly signal: number,
    readonly value: number
  ) {}
  check = () => true;
  run(m: Model, r: Real): void {
    const s = this.signal % m.spec.signals;
    m.signals[s] = this.value;
    r.signals[s]!.value = this.value;
    checkEffects(m, r);
  }
  toString = () => `write s${this.signal}=${this.value}`;
}

/** Writes in a batch, reading a node in the middle, then flushes */
class BatchWrite implements Command {
  constructor(
    readonly writes: Array<[number, number]>,
    readonly read: number
  ) {}
  check = () => true;
  run(m: Model, r: Real): void {
    const read = this.read % r.nodes.length;
    const readInBatch = batch(() => {
      for (const [index, v] of this.writes) {
        const s = index % m.spec.signals;
        m.signals[s] = v;
        r.signals[s]!.value = v;
      }
      return r.nodes[read]!.value;
    });
    expect(readInBatch).toBe(evaluate(m.spec, m.signals)[read]);
    checkEffects(m, r);
  }
  toString = () =>
    `batch ${this.writes.map(([s, v]) => `s${s}=${v}`).join(',')} read n${this.read}`;
}

/** Reads a node outside any effect */
class Read implements Command {
  constructor(readonly node: number) {}
  check = () => true;
  run(m: Model, r: Real): void {
    const node = this.node % r.nodes.length;
    expect(r.nodes[node]!.value).toBe(evaluate(m.spec, m.signals)[node]);
  }
  toString = () => `read n${this.node}`;
}

class AddEffect implements Command {
  constructor(readonly node: number) {}
  check = () => true;
  run(m: Model, r: Real): void {
    const node = this.node % r.nodes.length;
    const id = m.nextEffect++;
    const seen: number[] = [];
    const target = r.nodes[node]!;
    const dispose = createRoot((dispose) => {
      effect(() => {
        seen.push(target.value);
      });
      return dispose;
    });
    m.effects.set(id, node);
    r.effects.set(id, { dispose, seen });
    checkEffects(m, r);
  }
  toString = () => `effect on n${this.node}`;
}

class DisposeEffect implements Command {
  constructor(readonly pick: number) {}
  check = (m: Readonly<Model>) => m.effects.size > 0;
  run(m: Model, r: Real): void {
    const ids = [...m.effects.keys()];
    const id = ids[this.pick % ids.length]!;
    const { dispose, seen } = r.effects.get(id)!;
    dispose();
    m.effects.delete(id);
    r.effects.delete(id);

    // A disposed effect never runs again
    const runs = seen.length;
    for (let s = 0; s < m.spec.signals; s++) {
      m.signals[s] = m.signals[s]! + 1;
      r.signals[s]!.value = m.signals[s]!;
    }
    checkEffects(m, r);
    expect(seen.length).toBe(runs);
  }
  toString = () => `dispose effect #${this.pick}`;
}

const value = fc.integer({ min: -3, max: 3 });
const index = fc.nat({ max: 11 });

const commands = [
  fc.tuple(index, value).map(([s, v]) => new Write(s, v)),
  fc
    .tuple(
      fc.array(fc.tuple(index, value), { minLength: 1, maxLength: 3 }),
      index
    )
    .map(([writes, read]) => new BatchWrite(writes, read)),
  index.map((n) => new Read(n)),
  index.map((n) => new AddEffect(n)),
  fc.nat().map((p) => new DisposeEffect(p)),
];

//=============================================
// Tests
//=============================================

describe('reactive core against a model', () => {
  it('matches the model through random writes, batches, reads and disposals', () => {
    fc.assert(
      fc.property(
        graphSpec,
        fc.commands(commands, { maxCommands: 30 }),
        (spec, cmds) => {
          const real = build(spec);
          const model: Model = {
            spec,
            signals: real.signals.map((s) => s.peek()),
            effects: new Map(),
            nextEffect: 0,
          };
          try {
            fc.modelRun(() => ({ model, real }), cmds);
          } finally {
            for (const { dispose } of real.effects.values()) dispose();
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
