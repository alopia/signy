import { defineSuite } from '../suite.ts';

export default defineSuite({
  name: 'reactivity',
  tier: 'node',
  time: {
    'signal: read': (s) => {
      const a = s.signal(1);
      return { run: () => a.value };
    },
    'signal: write, no subscribers': (s) => {
      const a = s.signal(0);
      let i = 0;
      return {
        run: () => {
          a.value = ++i;
        },
      };
    },
    'signal: write and flush, 1 effect': (s) => {
      const a = s.signal(0);
      let i = 0;
      const dispose = s.createRoot((d) => {
        s.effect(() => a.value);
        return d;
      });
      s.flushAll();
      return {
        run: () => {
          a.value = ++i;
          s.flushAll();
        },
        teardown: dispose,
      };
    },
    'signal: write and flush, 1000 effects': (s) => {
      const a = s.signal(0);
      let i = 0;
      const dispose = s.createRoot((d) => {
        for (let k = 0; k < 1000; k++) s.effect(() => a.value);
        return d;
      });
      s.flushAll();
      return {
        run: () => {
          a.value = ++i;
          s.flushAll();
        },
        teardown: dispose,
      };
    },
    'computed: chain of 1000, write head, read tail': (s) => {
      const head = s.signal(0);
      let tail = s.computed(() => head.value);
      for (let k = 1; k < 1000; k++) {
        const prev = tail;
        tail = s.computed(() => prev.value + 1);
      }
      let i = 0;
      return {
        run: () => {
          head.value = ++i;
          return tail.value;
        },
      };
    },
    'computed: diamond, 1 to 100 to 1': (s) => {
      const source = s.signal(0);
      const middle = Array.from({ length: 100 }, (_, k) =>
        s.computed(() => source.value + k)
      );
      const sum = s.computed(() => {
        let total = 0;
        for (const m of middle) total += m.value;
        return total;
      });
      let i = 0;
      return {
        run: () => {
          source.value = ++i;
          return sum.value;
        },
      };
    },
    'computed: fan out, 1 source to 1000 computeds': (s) => {
      const source = s.signal(0);
      const all = Array.from({ length: 1000 }, (_, k) =>
        s.computed(() => source.value * k)
      );
      let i = 0;
      return {
        run: () => {
          source.value = ++i;
          let total = 0;
          for (const c of all) total += c.value;
          return total;
        },
      };
    },
    'batch: 1000 writes, 1 effect': (s) => {
      const a = s.signal(0);
      let i = 0;
      const dispose = s.createRoot((d) => {
        s.effect(() => a.value);
        return d;
      });
      s.flushAll();
      return {
        run: () => {
          s.batch(() => {
            for (let k = 0; k < 1000; k++) a.value = ++i;
          });
          s.flushAll();
        },
        teardown: dispose,
      };
    },
    'flushAll: 1000 signals, 1 effect each': (s) => {
      const signals = Array.from({ length: 1000 }, () => s.signal(0));
      let i = 0;
      const dispose = s.createRoot((d) => {
        for (const sig of signals) s.effect(() => sig.value);
        return d;
      });
      s.flushAll();
      return {
        run: () => {
          i++;
          for (const sig of signals) sig.value = i;
          s.flushAll();
        },
        teardown: dispose,
      };
    },
    'effect: 1000 signals, write and flush each': (s) => {
      const signals = Array.from({ length: 1000 }, () => s.signal(0));
      let i = 0;
      const dispose = s.createRoot((d) => {
        for (const sig of signals) s.effect(() => sig.value);
        return d;
      });
      s.flushAll();
      return {
        run: () => {
          i++;
          for (const sig of signals) {
            sig.value = i;
            s.flushAll();
          }
        },
        teardown: dispose,
      };
    },
    'computed: diamond 1 to 2 to 1, write and flush, 1 effect': (s) => {
      const source = s.signal(0);
      const left = s.computed(() => source.value + 1);
      const right = s.computed(() => source.value * 2);
      const sum = s.computed(() => left.value + right.value);
      let i = 0;
      const dispose = s.createRoot((d) => {
        s.effect(() => sum.value);
        return d;
      });
      s.flushAll();
      return {
        run: () => {
          source.value = ++i;
          s.flushAll();
        },
        teardown: dispose,
      };
    },
    'computed: create 1000 with a signal each, read, dispose': (s) => ({
      run: () =>
        s.createRoot((dispose) => {
          let total = 0;
          for (let k = 0; k < 1000; k++) {
            const sig = s.signal(k);
            total += s.computed(() => sig.value * 2).value;
          }
          dispose();
          return total;
        }),
    }),
    'effect: create 1000 in a root, flush, dispose': (s) => {
      const a = s.signal(0);
      return {
        run: () => {
          const dispose = s.createRoot((d) => {
            for (let k = 0; k < 1000; k++) s.effect(() => a.value);
            return d;
          });
          s.flushAll();
          dispose();
        },
      };
    },
    'render effect: create and dispose 1000': (s) => {
      const a = s.signal(0);
      return {
        run: () => {
          const disposers = new Array<() => void>(1000);
          for (let k = 0; k < 1000; k++) {
            disposers[k] = s.createRenderEffect(() => a.value);
          }
          for (const d of disposers) d();
        },
      };
    },
    'selector: 1000 keys, move selection': (s) => {
      const selected = s.signal(0);
      let i = 0;
      const dispose = s.createRoot((d) => {
        const isSelected = s.createSelector(() => selected.value);
        for (let k = 0; k < 1000; k++) {
          s.effect(() => isSelected(k).value);
        }
        return d;
      });
      s.flushAll();
      return {
        run: () => {
          selected.value = ++i % 1000;
          s.flushAll();
        },
        teardown: dispose,
      };
    },
  },
});
