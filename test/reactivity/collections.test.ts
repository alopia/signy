/**
 * Tests for ReactiveMap and ReactiveSet
 */

import { describe, it, expect } from 'vitest';
import {
  Computed,
  ReactiveMap,
  ReactiveSet,
  ReactiveStore,
  effect,
  unwrap,
} from '../../src/reactivity';
import { settle } from '../support/tick';
import { testRoot } from '../support/root';

/** Runs `read` in an effect and returns how often it ran, after each write */
function watch<T>(read: () => T) {
  const seen: T[] = [];
  testRoot(() => {
    effect(() => {
      seen.push(read());
    });
  });
  settle();
  return {
    seen,
    runs: () => seen.length,
  };
}

const nodeCount = (collection: object): number =>
  (collection as unknown as { _tracker: { _nodes: Map<unknown, unknown> } })
    ._tracker._nodes.size;

describe('ReactiveMap', () => {
  describe('as a Map', () => {
    it('is a Map and takes entries', () => {
      const map = new ReactiveMap([
        ['a', 1],
        ['b', 2],
      ]);
      expect(map).toBeInstanceOf(Map);
      expect(map.size).toBe(2);
      expect(map.get('a')).toBe(1);
      expect([...map]).toEqual([
        ['a', 1],
        ['b', 2],
      ]);
    });

    it('does the Map operations', () => {
      const map = new ReactiveMap<string, number>();
      expect(map.set('a', 1)).toBe(map);
      map.set('b', 2);
      expect(map.has('a')).toBe(true);
      expect(map.delete('a')).toBe(true);
      expect(map.delete('a')).toBe(false);
      expect([...map.keys()]).toEqual(['b']);
      expect([...map.values()]).toEqual([2]);
      expect([...map.entries()]).toEqual([['b', 2]]);
      const seen: unknown[] = [];
      map.forEach((value, key, self) => seen.push([value, key, self === map]));
      expect(seen).toEqual([[2, 'b', true]]);
      map.clear();
      expect(map.size).toBe(0);
    });

    it('takes any key, objects and NaN included', () => {
      const key = {};
      const map = new ReactiveMap<unknown, string>([
        [key, 'object'],
        [NaN, 'nan'],
      ]);
      expect(map.get(key)).toBe('object');
      expect(map.get(NaN)).toBe('nan');
    });
  });

  describe('get and has', () => {
    it('re-runs for the key that changed and for no other', () => {
      const map = new ReactiveMap<string, number>([['a', 1]]);
      const a = watch(() => map.get('a'));
      expect(a.seen).toEqual([1]);

      map.set('b', 5);
      settle();
      expect(a.runs()).toBe(1);

      map.set('a', 2);
      settle();
      expect(a.seen).toEqual([1, 2]);
    });

    it('does not re-run for a write of the value the key already has', () => {
      const map = new ReactiveMap([['a', 1]]);
      const a = watch(() => map.get('a'));
      map.set('a', 1);
      settle();
      expect(a.runs()).toBe(1);
    });

    it('re-runs when the key is added and deleted', () => {
      const map = new ReactiveMap<string, number>();
      const a = watch(() => map.get('a'));
      map.set('a', 1);
      settle();
      map.delete('a');
      settle();
      expect(a.seen).toEqual([undefined, 1, undefined]);
    });

    it('re-runs has() when the key is added and deleted, not when its value changes', () => {
      const map = new ReactiveMap<string, number>();
      const has = watch(() => map.has('a'));
      map.set('a', 1);
      settle();
      map.set('a', 2);
      settle();
      map.delete('a');
      settle();
      expect(has.seen).toEqual([false, true, true, false]);
    });
  });

  describe('size and iteration', () => {
    it('re-runs size when a key is added or removed, not when a value changes', () => {
      const map = new ReactiveMap([['a', 1]]);
      const size = watch(() => map.size);
      map.set('a', 2);
      settle();
      expect(size.runs()).toBe(1);
      map.set('b', 1);
      settle();
      map.delete('a');
      settle();
      expect(size.seen).toEqual([1, 2, 1]);
    });

    it('re-runs keys() for added and removed keys only', () => {
      const map = new ReactiveMap([['a', 1]]);
      const keys = watch(() => [...map.keys()].join());
      map.set('a', 9);
      settle();
      expect(keys.runs()).toBe(1);
      map.set('b', 1);
      settle();
      expect(keys.seen).toEqual(['a', 'a,b']);
    });

    it('re-runs values(), entries(), forEach() and iteration on a value change', () => {
      const map = new ReactiveMap([['a', 1]]);
      const values = watch(() => [...map.values()].join());
      const entries = watch(() => [...map.entries()].join('|'));
      const each = watch(() => {
        const out: number[] = [];
        map.forEach((value) => out.push(value));
        return out.join();
      });
      const iter = watch(() => [...map].length + ':' + [...map][0]![1]);
      map.set('a', 2);
      settle();
      expect(values.seen).toEqual(['1', '2']);
      expect(entries.seen).toEqual(['a,1', 'a,2']);
      expect(each.seen).toEqual(['1', '2']);
      expect(iter.seen).toEqual(['1:1', '1:2']);
    });

    it('re-runs iteration when a key is added', () => {
      const map = new ReactiveMap<string, number>();
      const values = watch(() => [...map.values()].join());
      map.set('a', 1);
      settle();
      expect(values.seen).toEqual(['', '1']);
    });
  });

  describe('delete and clear', () => {
    it('notifies nobody when the key was not there', () => {
      const map = new ReactiveMap<string, number>();
      const a = watch(() => map.get('a'));
      const size = watch(() => map.size);
      expect(map.delete('a')).toBe(false);
      settle();
      expect(a.runs()).toBe(1);
      expect(size.runs()).toBe(1);
    });

    it('clear() notifies every key reader, size and iteration', () => {
      const map = new ReactiveMap([
        ['a', 1],
        ['b', 2],
      ]);
      const a = watch(() => map.get('a'));
      const b = watch(() => map.get('b'));
      const size = watch(() => map.size);
      const values = watch(() => [...map.values()].join());
      map.clear();
      settle();
      expect(a.seen).toEqual([1, undefined]);
      expect(b.seen).toEqual([2, undefined]);
      expect(size.seen).toEqual([2, 0]);
      expect(values.seen).toEqual(['1,2', '']);
    });

    it('clear() on an empty map notifies nobody', () => {
      const map = new ReactiveMap<string, number>();
      const size = watch(() => map.size);
      map.clear();
      settle();
      expect(size.runs()).toBe(1);
    });
  });

  describe('nodes of keys that are gone', () => {
    it('keeps no node for ids that were added, read and deleted', () => {
      const map = new ReactiveMap<string, number>();
      for (let id = 0; id < 1000; id++) {
        const key = `row-${id}`;
        map.set(key, 1);
        testRoot((dispose) => {
          effect(() => map.get(key));
          settle();
          map.delete(key);
          settle();
          dispose();
        });
      }
      expect(nodeCount(map)).toBe(0);
    });

    it('keeps the node of a key that is still there', () => {
      const map = new ReactiveMap([['a', 1]]);
      testRoot((dispose) => {
        effect(() => map.get('a'));
        settle();
        dispose();
      });
      expect(nodeCount(map)).toBe(1);
    });

    it('drops the node of a key that was read and never added', () => {
      const map = new ReactiveMap<string, number>();
      testRoot((dispose) => {
        effect(() => map.get('ghost'));
        settle();
        expect(nodeCount(map)).toBe(1);
        dispose();
      });
      expect(nodeCount(map)).toBe(0);
    });

    it('keeps the node while a reader is subscribed to a deleted key', () => {
      const map = new ReactiveMap([['a', 1]]);
      const a = watch(() => map.get('a'));
      map.delete('a');
      expect(nodeCount(map)).toBe(1);
      settle();
      map.set('a', 5);
      settle();
      expect(a.seen).toEqual([1, undefined, 5]);
    });

    it('drops the nodes of every key on clear() once nobody reads them', () => {
      const map = new ReactiveMap([
        ['a', 1],
        ['b', 2],
      ]);
      testRoot((dispose) => {
        effect(() => map.get('a') ?? map.get('b'));
        settle();
        dispose();
      });
      map.clear();
      expect(nodeCount(map)).toBe(0);
    });

    it('lets an unwatched computed see a key written after its node was dropped', () => {
      const map = new ReactiveMap([['k', 1]]);
      const c = new Computed(() => map.get('k'));
      expect(c.value).toBe(1);
      map.delete('k');
      expect(nodeCount(map)).toBe(0);
      expect(c.value).toBeUndefined();
      map.set('k', 5);
      expect(c.value).toBe(5);
    });

    it('does not strand a computed whose last reader left while the key was absent', () => {
      const map = new ReactiveMap<string, number>();
      const c = new Computed(() => map.get('k'));
      testRoot((dispose) => {
        effect(() => c.value);
        settle();
        dispose();
      });
      expect(nodeCount(map)).toBe(0);
      map.set('k', 9);
      const later = watch(() => c.value);
      expect(later.seen).toEqual([9]);
      map.set('k', 10);
      settle();
      expect(later.seen).toEqual([9, 10]);
    });
  });

  describe('in a store', () => {
    it('is left alone by the store and tracks itself', () => {
      const s = new ReactiveStore({ users: new ReactiveMap([[1, 'Ada']]) });
      expect(s.state.users).toBeInstanceOf(ReactiveMap);
      const user = watch(() => s.state.users.get(1));
      s.state.users.set(1, 'Grace');
      settle();
      expect(user.seen).toEqual(['Ada', 'Grace']);
    });

    it('is cloned as a ReactiveMap, so the store owns its copy', () => {
      const original = new ReactiveMap([[1, { name: 'Ada' }]]);
      const s = new ReactiveStore({ users: original });
      expect(s.state.users).not.toBe(original);
      expect(s.state.users).toBeInstanceOf(ReactiveMap);
      original.get(1)!.name = 'changed';
      expect(s.state.users.get(1)!.name).toBe('Ada');
    });

    it('is found and kept anywhere in the initial value', () => {
      const s = new ReactiveStore({
        lists: [{ tags: new ReactiveSet(['a']) }],
        plain: new Map([['k', new ReactiveMap([[1, 'x']])]]),
      });
      expect(s.state.lists[0]!.tags).toBeInstanceOf(ReactiveSet);
      expect(s.state.plain.get('k')).toBeInstanceOf(ReactiveMap);
    });

    it('is unwrapped as a ReactiveMap, without subscribing the reader', () => {
      const s = new ReactiveStore({ users: new ReactiveMap([[1, 'Ada']]) });
      const copy = watch(() => unwrap(s.state).users.size);
      s.state.users.set(2, 'Grace');
      settle();
      expect(copy.runs()).toBe(1);
      expect(unwrap(s.state).users).toBeInstanceOf(ReactiveMap);
    });
  });
});

describe('ReactiveSet', () => {
  describe('as a Set', () => {
    it('is a Set and takes values', () => {
      const set = new ReactiveSet([1, 2, 2]);
      expect(set).toBeInstanceOf(Set);
      expect(set.size).toBe(2);
      expect([...set]).toEqual([1, 2]);
    });

    it('does the Set operations', () => {
      const set = new ReactiveSet<string>();
      expect(set.add('a')).toBe(set);
      set.add('b').add('a');
      expect(set.size).toBe(2);
      expect(set.has('a')).toBe(true);
      expect(set.delete('a')).toBe(true);
      expect(set.delete('a')).toBe(false);
      expect([...set.values()]).toEqual(['b']);
      expect([...set.keys()]).toEqual(['b']);
      expect([...set.entries()]).toEqual([['b', 'b']]);
      const seen: unknown[] = [];
      set.forEach((value, same, self) =>
        seen.push([value, same, self === set])
      );
      expect(seen).toEqual([['b', 'b', true]]);
      set.clear();
      expect(set.size).toBe(0);
    });
  });

  describe('reactivity', () => {
    it('re-runs has() for that value only', () => {
      const set = new ReactiveSet<string>();
      const has = watch(() => set.has('a'));
      set.add('b');
      settle();
      expect(has.runs()).toBe(1);
      set.add('a');
      settle();
      set.delete('a');
      settle();
      expect(has.seen).toEqual([false, true, false]);
    });

    it('does not re-run for adding a value it already has', () => {
      const set = new ReactiveSet(['a']);
      const has = watch(() => set.has('a'));
      const size = watch(() => set.size);
      set.add('a');
      settle();
      expect(has.runs()).toBe(1);
      expect(size.runs()).toBe(1);
    });

    it('re-runs size, values(), keys(), entries(), forEach() and iteration on add and delete', () => {
      const set = new ReactiveSet<string>();
      const size = watch(() => set.size);
      const values = watch(() => [...set.values()].join());
      const keys = watch(() => [...set.keys()].join());
      const entries = watch(() => [...set.entries()].join('|'));
      const each = watch(() => {
        const out: string[] = [];
        set.forEach((v) => out.push(v));
        return out.join();
      });
      const iter = watch(() => [...set].join());
      set.add('a');
      settle();
      set.delete('a');
      settle();
      expect(size.seen).toEqual([0, 1, 0]);
      expect(values.seen).toEqual(['', 'a', '']);
      expect(keys.seen).toEqual(['', 'a', '']);
      expect(entries.seen).toEqual(['', 'a,a', '']);
      expect(each.seen).toEqual(['', 'a', '']);
      expect(iter.seen).toEqual(['', 'a', '']);
    });

    it('notifies nobody when deleting a value that is not there', () => {
      const set = new ReactiveSet<string>();
      const size = watch(() => set.size);
      expect(set.delete('a')).toBe(false);
      settle();
      expect(size.runs()).toBe(1);
    });

    it('clear() notifies every value reader and size', () => {
      const set = new ReactiveSet(['a', 'b']);
      const a = watch(() => set.has('a'));
      const size = watch(() => set.size);
      set.clear();
      settle();
      expect(a.seen).toEqual([true, false]);
      expect(size.seen).toEqual([2, 0]);
    });

    it('clear() on an empty set notifies nobody', () => {
      const set = new ReactiveSet<string>();
      const size = watch(() => set.size);
      set.clear();
      settle();
      expect(size.runs()).toBe(1);
    });
  });

  describe('nodes of values that are gone', () => {
    it('keeps no node for values that were added, read and deleted', () => {
      const set = new ReactiveSet<string>();
      for (let id = 0; id < 1000; id++) {
        const value = `row-${id}`;
        set.add(value);
        testRoot((dispose) => {
          effect(() => set.has(value));
          settle();
          set.delete(value);
          settle();
          dispose();
        });
      }
      expect(nodeCount(set)).toBe(0);
    });

    it('keeps the node of a value that is still there', () => {
      const set = new ReactiveSet(['a']);
      testRoot((dispose) => {
        effect(() => set.has('a'));
        settle();
        dispose();
      });
      expect(nodeCount(set)).toBe(1);
    });
  });

  describe('in a store', () => {
    it('is left alone by the store, tracks itself and is cloned as a ReactiveSet', () => {
      const original = new ReactiveSet(['a']);
      const s = new ReactiveStore({ tags: original });
      expect(s.state.tags).not.toBe(original);
      expect(s.state.tags).toBeInstanceOf(ReactiveSet);
      const has = watch(() => s.state.tags.has('b'));
      s.state.tags.add('b');
      settle();
      expect(has.seen).toEqual([false, true]);
    });
  });
});
