import { defineSuite } from '../suite.ts';

export default defineSuite({
  name: 'memory',
  tier: 'node',
  memory: {
    'effects: root with 10 effects, created and disposed': (s) => {
      const shared = s.signal(0);
      let runs = 0;
      return {
        cycles: 1000,
        cycle: () => {
          const dispose = s.createRoot((d) => {
            for (let k = 0; k < 10; k++) {
              s.effect(() => {
                shared.value;
                runs++;
              });
            }
            return d;
          });
          s.flushAll();
          dispose();
        },
        probe: () => {
          runs = 0;
          shared.value++;
          s.flushAll();
          return { 'effect runs per write after dispose': runs };
        },
      };
    },
    // A render effect that re-runs used to keep every inner binding it
    // created on earlier runs.
    'render effect: inner binding re-created on each run': (s) => {
      const toggle = s.signal(0);
      const x = s.signal(0);
      let innerRuns = 0;
      let dispose = (): void => {};
      return {
        cycles: 100,
        cycle: () => {
          dispose();
          dispose = s.createRenderEffect(() => {
            toggle.value;
            s.createRenderEffect(() => {
              x.value;
              innerRuns++;
            });
          });
          for (let k = 0; k < 10; k++) {
            toggle.value++;
            s.flushAll();
          }
        },
        probe: () => {
          innerRuns = 0;
          x.value++;
          s.flushAll();
          const perWrite = innerRuns;
          dispose();
          innerRuns = 0;
          x.value++;
          s.flushAll();
          return {
            'inner runs per write while mounted': perWrite,
            'inner runs per write after dispose': innerRuns,
          };
        },
      };
    },
    'mapByItem: 1k rows created and disposed': (s) => {
      const data = Array.from({ length: 1000 }, (_, id) => ({ id }));
      const source = s.signal(data);
      return {
        cycles: 100,
        cycle: () => {
          const dispose = s.createRoot((d) => {
            const list = s.mapByItem(
              () => source.value,
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
    'store: effect on a path, created and disposed': (s) => {
      const st = s.store({ a: { b: 1 } });
      let runs = 0;
      return {
        cycles: 1000,
        cycle: () => {
          const dispose = s.createRoot((d) => {
            s.effect(() => {
              st.state.a.b;
              runs++;
            });
            return d;
          });
          s.flushAll();
          dispose();
        },
        probe: () => {
          runs = 0;
          st.set('a', 'b', (v: number) => v + 1);
          s.flushAll();
          return { 'effect runs per write after dispose': runs };
        },
      };
    },
    // A store used as a map kept a node for every id it ever read, deleted
    // ones included.
    'store as a map: id added, read by an effect, deleted, disposed': (s) => {
      const st = s.store({ rows: {} as Record<string, number> });
      let next = 0;
      return {
        cycles: 2000,
        cycle: () => {
          const id = `row-${next++}`;
          st.set('rows', id, 1);
          const dispose = s.createRoot((d) => {
            s.effect(() => {
              st.state.rows[id];
            });
            return d;
          });
          s.flushAll();
          delete st.state.rows[id];
          s.flushAll();
          dispose();
        },
      };
    },
  },
});
