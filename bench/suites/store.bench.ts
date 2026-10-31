import { defineSuite } from '../suite.ts';

interface Item {
  id: number;
  done: boolean;
}

interface State {
  a: { b: { c: number } };
  items: Item[];
}

const items = (n: number): Item[] =>
  Array.from({ length: n }, (_, id) => ({ id, done: false }));

export default defineSuite({
  name: 'store',
  tier: 'node',
  time: {
    'read nested path': (s) => {
      const st = s.store<State>({ a: { b: { c: 1 } }, items: [] });
      return { run: () => st.state.a.b.c };
    },
    'write nested path, no subscribers': (s) => {
      const st = s.store<State>({ a: { b: { c: 1 } }, items: [] });
      let i = 0;
      return { run: () => st.set('a', 'b', 'c', ++i) };
    },
    'write nested path and flush, 1 effect': (s) => {
      const st = s.store<State>({ a: { b: { c: 1 } }, items: [] });
      let i = 0;
      const dispose = s.createRoot((d) => {
        s.effect(() => st.state.a.b.c);
        return d;
      });
      s.flushAll();
      return {
        run: () => {
          st.set('a', 'b', 'c', ++i);
          s.flushAll();
        },
        teardown: dispose,
      };
    },
    'write a path read by a computed over a computed, and flush': (s) => {
      const st = s.store<State>({ a: { b: { c: 1 } }, items: items(10) });
      let i = 0;
      const dispose = s.createRoot((d) => {
        const count = new s.Computed(() => st.state.items.length);
        const total = new s.Computed(() => count.value + st.state.a.b.c);
        s.effect(() => total.value);
        return d;
      });
      s.flushAll();
      return {
        run: () => {
          st.set('a', 'b', 'c', ++i);
          s.flushAll();
        },
        teardown: dispose,
      };
    },
    'create a store of 1000 items': (s) => {
      const initial = { a: { b: { c: 1 } }, items: items(1000) };
      return { run: () => s.store<State>(initial) };
    },
    'replace an array of 1000 items': (s) => {
      const st = s.store<State>({ a: { b: { c: 1 } }, items: items(1000) });
      const next = items(1000);
      return { run: () => st.set('items', s.replaceWith(next)) };
    },
    'produce: toggle 1 of 1000 items': (s) => {
      const st = s.store<State>({ a: { b: { c: 1 } }, items: items(1000) });
      let i = 0;
      return {
        run: () => {
          const k = i++ % 1000;
          st.update(
            s.produce((draft: State) => {
              const item = draft.items[k] as Item;
              item.done = !item.done;
            })
          );
        },
      };
    },
  },
});
