/**
 * Tests for reactive stores
 */

import { describe, it, expect } from 'vitest';
import {
  ReactiveStore,
  ReactiveMap,
  store,
  unwrap,
  produce,
  replaceWith,
  effect,
  batch,
  Computed,
} from '../../src/reactivity';
import { keyNodeCount } from '../../src/reactivity/testing';
import { settle } from '../support/tick';
import { testRoot } from '../support/root';

describe('ReactiveStore class', () => {
  describe('constructor', () => {
    it('should create a store with initial value', () => {
      const store = new ReactiveStore({ count: 0 });
      expect(store.state.count).toBe(0);
    });

    it('should deep clone the initial value', () => {
      const original = { nested: { value: 1 } };
      const store = new ReactiveStore(original);

      original.nested.value = 999;
      expect(store.state.nested.value).toBe(1);
    });

    it('should accept a name for debugging', () => {
      const store = new ReactiveStore({ x: 1 }, { name: 'myStore' });
      expect(store.name).toBe('myStore');
    });
  });

  describe('state getter', () => {
    it('should return reactive proxy', () => {
      const store = new ReactiveStore({ value: 42 });
      expect(store.state.value).toBe(42);
    });

    it('should throw when accessing disposed store', () => {
      const store = new ReactiveStore({ x: 1 });
      store.dispose();

      expect(() => store.state).toThrow();
    });
  });

  describe('set()', () => {
    it('should set value at path', () => {
      const store = new ReactiveStore({ user: { name: 'Alice' } });
      store.set('user', 'name', 'Bob');
      expect(store.state.user.name).toBe('Bob');
    });

    it('should accept updater function', () => {
      const store = new ReactiveStore({ count: 5 });
      store.set('count', (prev: number) => prev * 2);
      expect(store.state.count).toBe(10);
    });

    it('should handle nested paths', () => {
      const store = new ReactiveStore({
        a: { b: { c: { d: 'deep' } } },
      });
      store.set('a', 'b', 'c', 'd', 'updated');
      expect(store.state.a.b.c.d).toBe('updated');
    });

    it('should notify subscribers', async () => {
      const store = new ReactiveStore({ value: 0 });
      const values: number[] = [];

      testRoot(() => {
        effect(() => {
          values.push(store.state.value);
        });

        settle();
        expect(values).toEqual([0]);

        store.set('value', 1);
        settle();
        expect(values).toEqual([0, 1]);
      });
    });

    it('should not notify if value unchanged', async () => {
      const store = new ReactiveStore({ value: 42 });
      let effectCount = 0;

      testRoot(() => {
        effect(() => {
          store.state.value;
          effectCount++;
        });

        settle();
        expect(effectCount).toBe(1);

        store.set('value', 42); // Same value
        settle();
        expect(effectCount).toBe(1);
      });
    });

    it('should throw when setting on disposed store', () => {
      const store = new ReactiveStore({ x: 1 });
      store.dispose();

      expect(() => store.set('x', 2)).toThrow();
    });
  });

  describe('merge()', () => {
    it('should merge partial object', () => {
      const store = new ReactiveStore({
        a: 1,
        b: 2,
        nested: { x: 10 },
      });

      store.merge({ a: 100, nested: { x: 20 } });

      expect(store.state.a).toBe(100);
      expect(store.state.b).toBe(2);
      expect(store.state.nested.x).toBe(20);
    });

    it('should deep merge nested objects', () => {
      const store = new ReactiveStore({
        user: { name: 'Alice', settings: { theme: 'dark', lang: 'en' } },
      });

      // Cast needed because Partial<T> is shallow
      store.merge({
        user: { settings: { theme: 'light', lang: 'en' } },
      } as never);

      expect(store.state.user.name).toBe('Alice');
      expect(store.state.user.settings.theme).toBe('light');
      expect(store.state.user.settings.lang).toBe('en');
    });

    it('should throw when merging on disposed store', () => {
      const store = new ReactiveStore({ x: 1 });
      store.dispose();

      expect(() => store.merge({ x: 2 })).toThrow();
    });
  });

  describe('update()', () => {
    it('should update entire state with function', () => {
      const store = new ReactiveStore({ count: 0, label: 'test' });

      store.update((prev) => ({
        ...prev,
        count: prev.count + 1,
      }));

      expect(store.state.count).toBe(1);
      expect(store.state.label).toBe('test');
    });

    it('should throw when updating disposed store', () => {
      const store = new ReactiveStore({ x: 1 });
      store.dispose();

      expect(() => store.update((prev) => prev)).toThrow();
    });
  });

  describe('unwrap()', () => {
    it('should return plain copy of data', () => {
      const store = new ReactiveStore({ count: 42 });
      const plain = store.unwrap();

      expect(plain).toEqual({ count: 42 });
      expect(plain).not.toBe(store.state);
    });
  });

  describe('dispose()', () => {
    it('should mark as disposed', () => {
      const store = new ReactiveStore({ x: 1 });
      expect(store.disposed).toBe(false);

      store.dispose();
      expect(store.disposed).toBe(true);
    });

    it('should be idempotent', () => {
      const store = new ReactiveStore({ x: 1 });
      store.dispose();
      store.dispose();
      expect(store.disposed).toBe(true);
    });
  });
});

describe('store factory function', () => {
  it('should return a ReactiveStore instance', () => {
    const s = store({ count: 0 });

    expect(s).toBeInstanceOf(ReactiveStore);
    expect(typeof s.state).toBe('object');
    expect(typeof s.set).toBe('function');
  });

  it('should create reactive state', () => {
    const s = store({
      user: { name: 'Alice' },
    });

    expect(s.state.user.name).toBe('Alice');
  });

  describe('set method', () => {
    it('should update with path-based syntax', () => {
      const s = store({
        user: { name: 'Alice', age: 25 },
      });

      s.set('user', 'name', 'Bob');
      expect(s.state.user.name).toBe('Bob');
    });

    it('should update with function', () => {
      const s = store({ count: 5 });

      s.set('count', (prev: number) => prev + 1);
      expect(s.state.count).toBe(6);
    });

    it('should merge object at root', () => {
      const s = store({
        a: 1,
        b: 2,
      });

      s.merge({ a: 10 });
      expect(s.state.a).toBe(10);
      expect(s.state.b).toBe(2);
    });

    it('should replace with function updater', () => {
      const s = store({ count: 0 });

      s.update((prev: { count: number }) => ({ count: prev.count + 10 }));
      expect(s.state.count).toBe(10);
    });
  });
});

describe('unwrap', () => {
  it('should return plain copy of store data', () => {
    const s = store({ items: [1, 2, 3] });
    const plain = unwrap(s.state);

    expect(plain).toEqual({ items: [1, 2, 3] });
    expect(Array.isArray(plain.items)).toBe(true);
  });

  it('should handle nested objects', () => {
    const s = store({
      user: { profile: { name: 'Test' } },
    });
    const plain = unwrap(s.state);

    expect(plain.user.profile.name).toBe('Test');
  });
});

describe('produce', () => {
  it('should create updater function', () => {
    const s = store({
      items: [{ id: 1, done: false }],
    });

    s.update(
      produce((draft: { items: Array<{ id: number; done: boolean }> }) => {
        draft.items.push({ id: 2, done: true });
      })
    );

    expect(s.state.items.length).toBe(2);
    expect(s.state.items[1]?.done).toBe(true);
  });

  it('should allow mutation-style updates', () => {
    const s = store({
      user: { name: 'Alice', score: 0 },
    });

    s.update(
      produce((draft: { user: { name: string; score: number } }) => {
        draft.user.score += 10;
        draft.user.name = 'Alice++';
      })
    );

    expect(s.state.user.score).toBe(10);
    expect(s.state.user.name).toBe('Alice++');
  });

  it('should not mutate original state', () => {
    const s = store({ value: 1 });

    s.update(
      produce((draft: { value: number }) => {
        draft.value = 999;
      })
    );

    // The original proxy reflects the new value
    expect(s.state.value).toBe(999);
  });
});

describe('replaceWith', () => {
  it('should replace data completely', () => {
    const s = store({
      items: ['a', 'b', 'c'],
    });

    s.set('items', replaceWith(['x', 'y']));

    expect(s.state.items).toEqual(['x', 'y']);
  });

  it('should work with nested updates', () => {
    const s = store({
      data: { list: [1, 2, 3] },
    });

    s.set('data', 'list', replaceWith([10, 20]));

    expect(s.state.data.list).toEqual([10, 20]);
  });
});

describe('store reactivity', () => {
  it('should track property access', async () => {
    const s = store({ count: 0 });
    const values: number[] = [];

    testRoot(() => {
      effect(() => {
        values.push(s.state.count);
      });

      settle();
      expect(values).toEqual([0]);

      s.set('count', 1);
      settle();
      expect(values).toEqual([0, 1]);
    });
  });

  it('should track nested property access', async () => {
    const s = store({
      user: { profile: { name: 'Alice' } },
    });
    const names: string[] = [];

    testRoot(() => {
      effect(() => {
        names.push(s.state.user.profile.name);
      });

      settle();
      expect(names).toEqual(['Alice']);

      s.set('user', 'profile', 'name', 'Bob');
      settle();
      expect(names).toEqual(['Alice', 'Bob']);
    });
  });

  it('should only notify affected subscribers', async () => {
    const s = store({ a: 1, b: 2 });
    let aEffectCount = 0;
    let bEffectCount = 0;

    testRoot(() => {
      effect(() => {
        s.state.a;
        aEffectCount++;
      });

      effect(() => {
        s.state.b;
        bEffectCount++;
      });

      settle();
      expect(aEffectCount).toBe(1);
      expect(bEffectCount).toBe(1);

      s.set('a', 10);
      settle();
      expect(aEffectCount).toBe(2);
      expect(bEffectCount).toBe(1); // b didn't change

      s.set('b', 20);
      settle();
      expect(aEffectCount).toBe(2); // a didn't change
      expect(bEffectCount).toBe(2);
    });
  });

  it('should batch multiple path updates', async () => {
    const s = store({ a: 0, b: 0 });
    let effectCount = 0;

    testRoot(() => {
      effect(() => {
        s.state.a;
        s.state.b;
        effectCount++;
      });

      settle();
      expect(effectCount).toBe(1);

      batch(() => {
        s.set('a', 1);
        s.set('b', 2);
      });

      settle();
      // Should only run once for batched update
      expect(effectCount).toBe(2);
    });
  });
});

describe('array support', () => {
  it('should handle array state', () => {
    const s = store({
      items: [1, 2, 3],
    });

    expect(s.state.items[0]).toBe(1);
    expect(s.state.items.length).toBe(3);
  });

  it('notifies readers of removed indices when the length shrinks', () => {
    const s = store({ list: ['a', 'b', 'c'] });
    const seen: unknown[] = [];
    testRoot(() => effect(() => void seen.push(s.state.list[2])));
    settle();

    s.state.list.length = 2;
    settle();
    s.set('list', 'length', 1);
    settle();
    s.set('list', ['x', 'y', 'z']);
    settle();
    expect(seen).toEqual(['c', undefined, 'z']);
  });

  it('notifies readers of removed indices for set("list", "length")', () => {
    const s = store({ list: ['a', 'b'] });
    const seen: unknown[] = [];
    testRoot(() => effect(() => void seen.push(s.state.list[1])));
    settle();

    s.set('list', 'length', 1);
    settle();
    expect(seen).toEqual(['b', undefined]);
  });

  it('should update array items', () => {
    const s = store({
      items: ['a', 'b', 'c'],
    });

    s.set('items', 1, 'X');
    expect(s.state.items[1]).toBe('X');
  });

  it('should handle array methods via produce', () => {
    const s = store({
      items: [1, 2],
    });

    s.update(
      produce((draft: { items: number[] }) => {
        draft.items.push(3);
      })
    );

    expect(s.state.items).toEqual([1, 2, 3]);
  });

  it('should track array access', async () => {
    const s = store({
      items: ['a', 'b'],
    });
    const log: string[] = [];

    testRoot(() => {
      effect(() => {
        log.push(`first: ${s.state.items[0]}`);
      });

      settle();
      expect(log).toEqual(['first: a']);

      s.set('items', 0, 'X');
      settle();
      expect(log).toEqual(['first: a', 'first: X']);
    });
  });
});

describe('proxy behavior', () => {
  it('should handle "in" operator', () => {
    const s = store({ existing: 1 });

    expect('existing' in s.state).toBe(true);
    expect('nonexistent' in s.state).toBe(false);
  });

  it('should handle Object.keys()', () => {
    const s = store({ a: 1, b: 2, c: 3 });

    expect(Object.keys(s.state)).toEqual(['a', 'b', 'c']);
  });

  it('should handle direct property assignment', async () => {
    const s = store<{ x: number; y?: number }>({ x: 1 });
    const values: number[] = [];

    testRoot(() => {
      effect(() => {
        values.push(s.state.x);
      });

      settle();

      // Direct assignment on proxy also triggers updates
      (s.state as Record<string, unknown>)['x'] = 99;
      settle();

      expect(values).toContain(99);
    });
  });

  it('should handle delete property', () => {
    const s = store<{ a: number; b?: number }>({
      a: 1,
      b: 2,
    });

    delete (s.state as Record<string, unknown>)['b'];
    expect('b' in s.state).toBe(false);
  });
});

describe('edge cases', () => {
  it('should handle empty object', () => {
    const s = store({});
    expect(Object.keys(s.state)).toEqual([]);
  });

  it('should handle nested arrays', () => {
    const s = store({
      matrix: [
        [1, 2],
        [3, 4],
      ],
    });

    expect(s.state.matrix[0]![1]).toBe(2);

    s.set('matrix', 0, 1, 99);
    expect(s.state.matrix[0]![1]).toBe(99);
  });

  it('should handle null values', () => {
    const s = store<{ value: string | null }>({
      value: 'test',
    });

    s.set('value', null);
    expect(s.state.value).toBe(null);
  });

  it('should handle undefined values', () => {
    const s = store<{ value?: string }>({
      value: 'test',
    });

    s.set('value', undefined);
    expect(s.state.value).toBe(undefined);
  });

  it('should not wrap exotic objects (Date)', () => {
    const date = new Date('2024-01-01');
    const s = store({ created: date });

    // Date should work correctly
    expect(s.state.created instanceof Date).toBe(true);
  });

  it('should clone Date objects', () => {
    const original = new Date('2024-01-01');
    const s = store({ date: original });

    original.setFullYear(2099);
    expect(s.state.date.getFullYear()).toBe(2024);
  });
});

// A store read used to add the reader without registering the store as one
// of its sources. A computed that also read another computed then checked
// only that one on the next read, found it unchanged and kept its old value.
describe('computed values over a store', () => {
  const setup = (
    read: (
      s: ReactiveStore<{ n: number; coupon: string }>,
      sub: Computed<number>
    ) => string
  ) => {
    const s = store({ n: 0, coupon: '' });
    const seen: string[] = [];
    testRoot(() => {
      const sub = new Computed(() => s.state.n);
      const outer = new Computed(() => read(s, sub));
      effect(() => {
        seen.push(outer.value);
      });
    });
    settle();
    return { s, seen };
  };

  it('update when they read only the store', () => {
    const { s, seen } = setup((st) => st.state.n + st.state.coupon);
    s.set('coupon', 'A');
    settle();
    expect(seen).toEqual(['0', '0A']);
  });

  it('update when they read a computed, then the store', () => {
    const { s, seen } = setup((st, sub) => sub.value + st.state.coupon);
    s.set('coupon', 'A');
    settle();
    expect(seen).toEqual(['0', '0A']);
  });

  it('update when they read the store, then a computed', () => {
    const { s, seen } = setup((st, sub) => st.state.coupon + sub.value);
    s.set('coupon', 'A');
    settle();
    expect(seen).toEqual(['0', 'A0']);
  });

  it('update when the path the inner computed reads changes', () => {
    const { s, seen } = setup((st, sub) => sub.value + st.state.coupon);
    s.set('n', 5);
    settle();
    expect(seen).toEqual(['0', '5']);
  });

  it('read fresh values outside any effect', () => {
    const s = store({ n: 1, coupon: '' });
    const sub = new Computed(() => s.state.n * 2);
    const outer = new Computed(() => `${sub.value}${s.state.coupon}`);
    expect(outer.value).toBe('2');
    s.set('coupon', 'B');
    expect(outer.value).toBe('2B');
    s.set('n', 2);
    expect(outer.value).toBe('4B');
  });
});

describe('per key tracking', () => {
  it('does not re-run readers of a parent path on a nested write', () => {
    const s = new ReactiveStore({ a: { b: { c: 1 } } });
    let parentRuns = 0;
    let leafRuns = 0;

    testRoot(() => {
      effect(() => {
        void s.state.a;
        parentRuns++;
      });
      effect(() => {
        void s.state.a.b.c;
        leafRuns++;
      });
    });
    settle();

    s.set('a', 'b', 'c', 2);
    settle();

    expect(parentRuns).toBe(1);
    expect(leafRuns).toBe(2);
  });

  it('notifies key list readers when a key is added or deleted', () => {
    const s = new ReactiveStore<Record<string, number>>({ a: 1 });
    const seen: string[][] = [];

    testRoot(() => {
      effect(() => {
        seen.push(Object.keys(s.state));
      });
    });
    settle();

    s.set('a', 2); // value change only
    settle();
    s.set('b', 3);
    settle();
    delete s.state['a'];
    settle();

    expect(seen).toEqual([['a'], ['a', 'b'], ['b']]);
  });

  it('notifies length readers on push', () => {
    const s = new ReactiveStore({ items: [1, 2] });
    const lengths: number[] = [];

    testRoot(() => {
      effect(() => {
        lengths.push(s.state.items.length);
      });
    });
    settle();

    s.state.items.push(3);
    settle();

    expect(lengths).toEqual([2, 3]);
  });

  it('notifies only the changed keys on merge', () => {
    const s = new ReactiveStore({ a: 1, b: 1 });
    let bRuns = 0;

    testRoot(() => {
      effect(() => {
        void s.state.b;
        bRuns++;
      });
    });
    settle();

    s.merge({ a: 2, b: 1 });
    settle();

    expect(bRuns).toBe(1);
  });
});

describe('update() and unwrap()', () => {
  it('update() removes keys missing from the result', () => {
    const s = new ReactiveStore<{ a: number; b?: number }>({ a: 1, b: 2 });
    s.update(() => ({ a: 3 }));
    expect(s.unwrap()).toEqual({ a: 3 });
    expect('b' in s.state).toBe(false);
  });

  it('update() shortens arrays', () => {
    const s = new ReactiveStore({ items: [1, 2, 3] });
    s.update((prev) => ({ items: prev.items.slice(0, 1) }));
    expect(s.unwrap()).toEqual({ items: [1] });
  });

  it('update() keeps the proxy identity of nested objects', () => {
    const s = new ReactiveStore({ user: { name: 'a', age: 1 } });
    const user = s.state.user;
    s.update((prev) => ({ user: { ...prev.user, name: 'b' } }));
    expect(s.state.user).toBe(user);
    expect(user.name).toBe('b');
  });

  it('unwrap() keeps Map and Set', () => {
    const s = new ReactiveStore({
      map: new Map([['k', { v: 1 }]]),
      set: new Set([1, 2]),
    });
    const plain = unwrap(s.state);
    expect(plain.map).toBeInstanceOf(Map);
    expect(plain.map.get('k')).toEqual({ v: 1 });
    expect(plain.set).toBeInstanceOf(Set);
    expect([...plain.set]).toEqual([1, 2]);
  });

  it('unwrap() does not track the store', () => {
    const s = new ReactiveStore({ a: 1 });
    let runs = 0;
    testRoot(() => {
      effect(() => {
        unwrap(s.state);
        runs++;
      });
    });
    settle();
    s.set('a', 2);
    settle();
    expect(runs).toBe(1);
  });
});

describe('objects that move to another index', () => {
  it('keep notifying their readers after an earlier item is removed', () => {
    const s = new ReactiveStore({
      addresses: [
        { id: 1, city: '' },
        { id: 2, city: 'London' },
        { id: 3, city: 'Paris' },
      ],
    });
    const seen: string[] = [];
    testRoot(() => {
      effect(() => {
        seen.push(s.state.addresses.map((a) => a.city).join(','));
      });
    });
    settle();

    s.set('addresses', (list: { id: number }[]) =>
      list.filter((a) => a.id !== 2)
    );
    settle();
    s.set('addresses', 1, 'city', 'Rome');
    settle();

    expect(seen.at(-1)).toBe(',Rome');
  });

  it('keep notifying a reader that holds the moved proxy', () => {
    const s = new ReactiveStore({ list: [{ v: 1 }, { v: 2 }] });
    const second = s.state.list[1]!;
    const seen: number[] = [];
    testRoot(() => {
      effect(() => {
        seen.push(second.v);
      });
    });
    settle();

    s.set('list', (list: { v: number }[]) => list.slice(1));
    settle();
    s.set('list', 0, 'v', 5);
    settle();

    expect(seen).toEqual([2, 5]);
  });
});

describe('sealed objects in a store', () => {
  it('track and notify their keys', () => {
    const s = new ReactiveStore({ box: Object.seal({ n: 1 }) });
    const seen: number[] = [];
    testRoot(() => {
      effect(() => {
        seen.push(s.state.box.n);
      });
    });
    settle();
    s.set('box', 'n', 2);
    settle();
    expect(seen).toEqual([1, 2]);
  });
});

describe('objects that are not plain in the initial value', () => {
  class Point {
    constructor(public x: number) {}
    get double(): number {
      return this.x * 2;
    }
    len(): number {
      return this.x;
    }
  }

  // One value per test: a value the native clone refuses, such as a WeakMap,
  // would make the whole initial value take another path and hide the others
  it('keep a class instance with its prototype, as set() does', () => {
    const p = new Point(3);
    const s = new ReactiveStore({ p });
    expect(s.state.p).toBeInstanceOf(Point);
    expect(s.state.p.len()).toBe(3);
    expect(s.state.p.double).toBe(6);
    expect(unwrap(s.state).p).toBe(p);
  });

  it('keep a WeakMap', () => {
    const key = {};
    const s = new ReactiveStore({ weak: new WeakMap([[key, 1]]) });
    expect(s.state.weak.get(key)).toBe(1);
  });

  it('keep a RegExp', () => {
    const s = new ReactiveStore({ re: /a+/ });
    expect(s.state.re.test('aa')).toBe(true);
  });

  it('copy a Date', () => {
    const when = new Date(0);
    const s = new ReactiveStore({ when });
    expect(s.state.when.getTime()).toBe(0);
    expect(unwrap(s.state).when).not.toBe(when);
  });

  it('copy arrays and plain objects, frozen ones included', () => {
    const items = [{ id: 1 }];
    const frozen = Object.freeze({ a: 1 });
    const s = new ReactiveStore({ items, frozen });
    items.push({ id: 2 });
    expect(s.state.items).toHaveLength(1);
    expect(unwrap(s.state).frozen).not.toBe(frozen);
    expect(Object.isFrozen(unwrap(s.state).frozen)).toBe(false);
  });

  it('keep a ReactiveMap one', () => {
    const s = new ReactiveStore({ users: new ReactiveMap([[1, 'Ada']]) });
    expect(s.state.users).toBeInstanceOf(ReactiveMap);
    expect(s.state.users.get(1)).toBe('Ada');
  });

  it('still copies a plain object with a constructor key or no prototype', () => {
    const words = { constructor: 'a word' };
    const bare = Object.assign(Object.create(null), { a: 1 });
    const s = new ReactiveStore({ words, bare });
    expect(unwrap(s.state).words).not.toBe(words);
    expect(s.state.words.constructor).toBe('a word');
    expect(s.state.bare.a).toBe(1);
  });

  it('track a class instance as set() does', () => {
    const s = new ReactiveStore({ p: new Point(1) });
    const seen: number[] = [];
    testRoot(() => {
      effect(() => {
        seen.push(s.state.p.x);
      });
    });
    settle();
    s.set('p', 'x', 2);
    settle();
    expect(seen).toEqual([1, 2]);
  });
});

describe('produce on a store draft', () => {
  type Item = { id: number; done: boolean };

  it('notifies only the keys the recipe wrote', () => {
    testRoot(() => {
      const s = new ReactiveStore({
        items: [
          { id: 1, done: false },
          { id: 2, done: false },
        ] as Item[],
      });
      let firstRuns = 0;
      let secondRuns = 0;
      effect(() => {
        firstRuns++;
        return s.state.items[0]!.done;
      });
      effect(() => {
        secondRuns++;
        return s.state.items[1]!.done;
      });
      settle();
      const second = s.state.items[1];

      s.update(
        produce((draft: { items: Item[] }) => {
          draft.items[1]!.done = true;
        })
      );
      settle();
      expect(firstRuns).toBe(1);
      expect(secondRuns).toBe(2);
      expect(s.state.items[1]).toBe(second);
      expect(s.state.items[1]!.done).toBe(true);
    });
  });

  it('reads the values written earlier in the same recipe', () => {
    const s = new ReactiveStore({ user: { name: 'a', tags: ['x'] } });
    let seen = '';
    s.update(
      produce((draft: { user: { name: string; tags: string[] } }) => {
        draft.user.name = 'b';
        draft.user.tags.push('y');
        seen = `${draft.user.name}${draft.user.tags.join('')}`;
      })
    );
    expect(seen).toBe('bxy');
    expect(unwrap(s.state)).toEqual({ user: { name: 'b', tags: ['x', 'y'] } });
  });

  it('notifies the readers of indices a shorter array removed', () => {
    testRoot(() => {
      const s = new ReactiveStore({ items: [1, 2, 3] });
      let last: number | undefined;
      effect(() => {
        last = s.state.items[2];
      });
      settle();

      s.update(
        produce((draft: { items: number[] }) => {
          draft.items.pop();
        })
      );
      settle();
      expect(last).toBeUndefined();
      expect(s.state.items.length).toBe(2);
    });
  });

  it('moves the objects a recipe assigns, keeping them whole', () => {
    const s = new ReactiveStore({
      items: [
        { id: 1, done: true },
        { id: 2, done: false },
      ] as Item[],
      kept: [] as Item[],
    });
    s.update(
      produce((draft: { items: Item[]; kept: Item[] }) => {
        draft.kept = draft.items.filter((item) => item.done);
        draft.items = draft.items.filter((item) => !item.done);
      })
    );
    expect(unwrap(s.state)).toEqual({
      items: [{ id: 2, done: false }],
      kept: [{ id: 1, done: true }],
    });
    s.set('kept', 0, 'done', false);
    s.set('items', 0, 'done', true);
    expect(unwrap(s.state)).toEqual({
      items: [{ id: 2, done: true }],
      kept: [{ id: 1, done: false }],
    });
  });

  it('moves a card spliced out of one array into another', () => {
    type Card = { id: number; text: string };
    type Board = { columns: { cards: Card[] }[] };
    testRoot(() => {
      const s = new ReactiveStore<Board>({
        columns: [
          {
            cards: [
              { id: 1, text: 'a' },
              { id: 2, text: 'b' },
              { id: 3, text: 'c' },
            ],
          },
          { cards: [] },
        ],
      });
      const moved = s.state.columns[0]!.cards[0];
      let doneTexts = '';
      effect(() => {
        doneTexts = s.state.columns[1]!.cards.map((c) => c.text).join();
      });
      settle();

      s.set(
        'columns',
        produce((columns: Board['columns']) => {
          const [card] = columns[0]!.cards.splice(0, 1);
          columns[1]!.cards.push(card!);
        })
      );
      settle();
      expect(unwrap(s.state)).toEqual({
        columns: [
          {
            cards: [
              { id: 2, text: 'b' },
              { id: 3, text: 'c' },
            ],
          },
          { cards: [{ id: 1, text: 'a' }] },
        ],
      });
      expect(doneTexts).toBe('a');
      expect(s.state.columns[1]!.cards[0]).toBe(moved);
    });
  });

  it('deletes keys and notifies their readers', () => {
    testRoot(() => {
      const s = new ReactiveStore<{ a?: number; b: number }>({ a: 1, b: 2 });
      let keys = '';
      effect(() => {
        keys = Object.keys(s.state).join();
      });
      settle();

      s.update(
        produce((draft: { a?: number; b: number }) => {
          delete draft.a;
        })
      );
      settle();
      expect(keys).toBe('b');
    });
  });

  it('copies a Map before the recipe changes it, and notifies its readers', () => {
    testRoot(() => {
      const s = new ReactiveStore({ m: new Map([['a', 1]]) });
      const before = s.state.m;
      let size = 0;
      effect(() => {
        size = s.state.m.size;
      });
      settle();

      s.update(
        produce((draft: { m: Map<string, number> }) => {
          draft.m.set('b', 2);
        })
      );
      settle();
      expect(size).toBe(2);
      expect(before.size).toBe(1);
    });
  });

  it('runs on a draft of the value at a path', () => {
    testRoot(() => {
      const s = new ReactiveStore({ user: { name: 'a', score: 1 } });
      let names = 0;
      effect(() => {
        names++;
        return s.state.user.name;
      });
      settle();

      s.set(
        'user',
        produce((user: { name: string; score: number }) => {
          user.score = 2;
        })
      );
      settle();
      expect(s.state.user.score).toBe(2);
      expect(names).toBe(1);
    });
  });

  it('does not track what the recipe reads', () => {
    testRoot(() => {
      const s = new ReactiveStore({ a: 1, b: 0 });
      let runs = 0;
      effect(() => {
        runs++;
        s.update(
          produce((draft: { a: number; b: number }) => {
            draft.b = draft.a;
          })
        );
      });
      settle();
      s.set('a', 2);
      settle();
      expect(runs).toBe(1);
    });
  });
});

describe('prototype pollution', () => {
  const polluted = () => ({}) as Record<string, unknown>;

  it('merge() skips a __proto__ key from parsed JSON', () => {
    const s = new ReactiveStore<Record<string, unknown>>({ a: 1 });
    s.merge(JSON.parse('{"__proto__":{"polluted":1},"a":2}'));
    expect(polluted()['polluted']).toBeUndefined();
    expect(Object.getPrototypeOf(unwrap(s.state))).toBe(Object.prototype);
    expect(s.state['a']).toBe(2);
  });

  it('update() skips a __proto__ key from parsed JSON', () => {
    const s = new ReactiveStore<Record<string, unknown>>({ a: { b: 1 } });
    s.state['a'];
    s.update(() => JSON.parse('{"a":{"__proto__":{"polluted":1}}}'));
    expect(polluted()['polluted']).toBeUndefined();
    expect(Object.getPrototypeOf(s.state['a'])).toBe(Object.prototype);
  });

  it('set() walks own keys, so constructor.prototype stays plain data', () => {
    const s = new ReactiveStore<Record<string, unknown>>({});
    s.set('constructor', 'prototype', 'polluted', 1);
    expect(polluted()['polluted']).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
    expect(unwrap(s.state)).toEqual({
      constructor: { prototype: { polluted: 1 } },
    });
    expect(() => s.set('__proto__', 'polluted', 1)).toThrow(
      'reactivity:store-unsafe-key'
    );
  });

  it('set() takes keys named constructor and prototype in a map', () => {
    const s = new ReactiveStore<{ counts: Record<string, number> }>({
      counts: {},
    });
    s.set('counts', 'constructor', 1);
    s.set('counts', 'prototype', (n: unknown) => ((n as number) ?? 0) + 1);
    expect(unwrap(s.state).counts).toEqual({ constructor: 1, prototype: 1 });
  });

  it('the proxy does not hand out Object.prototype', () => {
    const s = new ReactiveStore<Record<string, unknown>>({});
    const proto = (s.state as { __proto__: Record<string, unknown> }).__proto__;
    expect(() => {
      (s.state as Record<string, unknown>)['__proto__'] = {};
    }).toThrow('reactivity:store-unsafe-key');
    expect(proto).toBe(Object.prototype);
  });

  it('a produce() draft refuses __proto__', () => {
    const s = new ReactiveStore<Record<string, unknown>>({ a: 1 });
    expect(() =>
      s.update(
        produce((draft: Record<string, unknown>) => {
          draft['__proto__'] = { polluted: 1 };
        })
      )
    ).toThrow('reactivity:store-unsafe-key');
    expect(polluted()['polluted']).toBeUndefined();
  });

  it('unwrap() drops an own __proto__ key', () => {
    const s = new ReactiveStore<Record<string, unknown>>({});
    s.set('a', JSON.parse('{"__proto__":{"polluted":1}}'));
    const copy = unwrap(s.state);
    expect(Object.getPrototypeOf(copy['a'])).toBe(Object.prototype);
  });
});

describe('store nodes of keys that are gone', () => {
  type Rows = { rows: Record<string, number | undefined> };
  const rowsOf = (s: ReactiveStore<Rows>) => s.state.rows;

  it('keeps no node for ids that were added, read and deleted', () => {
    const s = new ReactiveStore<Rows>({ rows: {} });
    for (let id = 0; id < 1000; id++) {
      const key = `row-${id}`;
      s.set('rows', key, 1);
      testRoot((dispose) => {
        effect(() => rowsOf(s)[key]);
        settle();
        delete rowsOf(s)[key];
        settle();
        dispose();
      });
    }
    expect(keyNodeCount(rowsOf(s))).toBe(0);
  });

  it('keeps a constant number of nodes for keys that stay, however many readers come and go', () => {
    const s = new ReactiveStore({ a: { b: 1 } });
    for (let i = 0; i < 1000; i++) {
      testRoot((dispose) => {
        effect(() => s.state.a.b);
        settle();
        dispose();
      });
    }
    expect(keyNodeCount(s.state)).toBe(1);
    expect(keyNodeCount(s.state.a)).toBe(1);
  });

  it('keeps the node of a key that is still there when its readers leave', () => {
    const s = new ReactiveStore<Rows>({ rows: { a: 1 } });
    testRoot((dispose) => {
      effect(() => rowsOf(s)['a']);
      settle();
      dispose();
    });
    expect(keyNodeCount(rowsOf(s))).toBe(1);
  });

  it('drops the node of a key deleted after its readers left', () => {
    const s = new ReactiveStore<Rows>({ rows: { a: 1 } });
    testRoot((dispose) => {
      effect(() => rowsOf(s)['a']);
      settle();
      dispose();
    });
    delete rowsOf(s)['a'];
    expect(keyNodeCount(rowsOf(s))).toBe(0);
  });

  it('keeps the node while a reader is subscribed to a deleted key', () => {
    const s = new ReactiveStore<Rows>({ rows: { a: 1 } });
    const seen: unknown[] = [];
    testRoot((dispose) => {
      effect(() => seen.push(rowsOf(s)['a']));
      settle();
      delete rowsOf(s)['a'];
      expect(keyNodeCount(rowsOf(s))).toBe(1);
      settle();
      // The reader still reads the key, so the key comes back to it
      s.set('rows', 'a', 5);
      settle();
      expect(seen).toEqual([1, undefined, 5]);
      dispose();
    });
  });

  it('drops the node when the reader stops reading the key', () => {
    const s = new ReactiveStore<Rows>({ rows: { a: 1 } });
    testRoot((dispose) => {
      effect(() => {
        if (rowsOf(s)['a'] !== undefined) return;
      });
      settle();
      delete rowsOf(s)['a'];
      settle();
      expect(keyNodeCount(rowsOf(s))).toBe(1);
      dispose();
    });
    expect(keyNodeCount(rowsOf(s))).toBe(0);
  });

  it('drops the node of a key that was read and never existed', () => {
    const s = new ReactiveStore<Rows>({ rows: {} });
    testRoot((dispose) => {
      effect(() => rowsOf(s)['ghost']);
      settle();
      expect(keyNodeCount(rowsOf(s))).toBe(1);
      dispose();
    });
    expect(keyNodeCount(rowsOf(s))).toBe(0);
  });

  it('notifies a new reader of a key whose node was dropped before', () => {
    const s = new ReactiveStore<Rows>({ rows: { a: 1 } });
    testRoot((dispose) => {
      effect(() => rowsOf(s)['a']);
      settle();
      dispose();
    });
    delete rowsOf(s)['a'];
    const seen: unknown[] = [];
    testRoot((dispose) => {
      effect(() => seen.push(rowsOf(s)['a']));
      settle();
      s.set('rows', 'a', 7);
      settle();
      expect(seen).toEqual([undefined, 7]);
      dispose();
    });
  });

  describe('computed values', () => {
    it('sees a key written after the node of a deleted key was dropped (unwatched computed)', () => {
      const s = new ReactiveStore<Rows>({ rows: { k: 1 } });
      const c = new Computed(() => rowsOf(s)['k']);
      expect(c.value).toBe(1);

      delete rowsOf(s)['k'];
      expect(keyNodeCount(rowsOf(s))).toBe(0);
      expect(c.value).toBeUndefined();

      s.set('rows', 'k', 5);
      expect(c.value).toBe(5);
    });

    it('sees a key written after it was watched again', () => {
      const s = new ReactiveStore<Rows>({ rows: { k: 1 } });
      const c = new Computed(() => rowsOf(s)['k']);
      expect(c.value).toBe(1);
      delete rowsOf(s)['k'];

      const seen: unknown[] = [];
      testRoot((dispose) => {
        effect(() => seen.push(c.value));
        settle();
        s.set('rows', 'k', 5);
        settle();
        expect(seen).toEqual([undefined, 5]);
        dispose();
      });
    });

    it('is not stranded when its last reader leaves while the key is absent', () => {
      const s = new ReactiveStore<Rows>({ rows: {} });
      const c = new Computed(() => rowsOf(s)['k']);

      testRoot((dispose) => {
        effect(() => c.value);
        settle();
        dispose();
      });
      expect(keyNodeCount(rowsOf(s))).toBe(0);

      // Written while nobody watches the computed, and the node is gone
      s.set('rows', 'k', 9);
      const seen: unknown[] = [];
      testRoot((dispose) => {
        effect(() => seen.push(c.value));
        settle();
        expect(seen).toEqual([9]);
        s.set('rows', 'k', 10);
        settle();
        expect(seen).toEqual([9, 10]);
        dispose();
      });
    });

    it('keeps tracking a key that exists when its readers leave and come back', () => {
      const s = new ReactiveStore<Rows>({ rows: { k: 1 } });
      const c = new Computed(() => rowsOf(s)['k']);
      testRoot((dispose) => {
        effect(() => c.value);
        settle();
        dispose();
      });
      s.set('rows', 'k', 2);
      const seen: unknown[] = [];
      testRoot((dispose) => {
        effect(() => seen.push(c.value));
        settle();
        s.set('rows', 'k', 3);
        settle();
        expect(seen).toEqual([2, 3]);
        dispose();
      });
    });
  });

  describe('arrays', () => {
    it('drops the nodes of indices a shorter array no longer has', () => {
      const s = new ReactiveStore({ items: [1, 2, 3, 4] });
      testRoot((dispose) => {
        effect(() => s.state.items[3]);
        settle();
        s.set('items', (items: number[]) => items.slice(0, 2));
        settle();
        dispose();
      });
      expect(keyNodeCount(s.state.items)).toBe(0);
    });

    it('drops the node of an index removed by pop', () => {
      const s = new ReactiveStore({ items: [1, 2, 3] });
      testRoot((dispose) => {
        effect(() => s.state.items[2]);
        settle();
        s.set('items', (items: number[]) => items.slice(0, 2));
        settle();
        dispose();
      });
      expect(keyNodeCount(s.state.items)).toBe(0);
    });

    it('keeps the nodes of indices that are still there', () => {
      const s = new ReactiveStore({ items: [1, 2, 3] });
      testRoot((dispose) => {
        effect(() => (s.state.items[0] ?? 0) + (s.state.items[1] ?? 0));
        settle();
        dispose();
      });
      expect(keyNodeCount(s.state.items)).toBe(2);
    });
  });

  it('still notifies readers of the key list', () => {
    const s = new ReactiveStore<Rows>({ rows: {} });
    const seen: number[] = [];
    testRoot((dispose) => {
      effect(() => seen.push(Object.keys(rowsOf(s)).length));
      settle();
      testRoot((inner) => {
        effect(() => rowsOf(s)['a']);
        settle();
        s.set('rows', 'a', 1);
        settle();
        delete rowsOf(s)['a'];
        settle();
        inner();
      });
      expect(seen).toEqual([0, 1, 0]);
      dispose();
    });
  });
});
