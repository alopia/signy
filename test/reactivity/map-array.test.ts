/**
 * @file Tests for mapByItem and mapByIndex reactive array mapping primitives
 */

import { describe, it, expect } from 'vitest';
import {
  Signal,
  createRoot,
  effect,
  mapByItem,
  mapByIndex,
  onCleanup,
} from '../../src/reactivity';
import { settle } from '../support/tick';
import { testRoot } from '../support/root';
import { expectLogged } from '../support/console';

describe('mapByItem', () => {
  describe('basic functionality', () => {
    it('maps an array of items', async () => {
      testRoot(() => {
        const list = new Signal([1, 2, 3]);
        const mapped = mapByItem(
          () => list.value,
          (item) => item * 2
        );
        settle();

        expect(mapped()).toEqual([2, 4, 6]);
      });
    });

    it('returns empty array for empty input', async () => {
      testRoot(() => {
        const list = new Signal<number[]>([]);
        const mapped = mapByItem(
          () => list.value,
          (item) => item * 2
        );
        settle();

        expect(mapped()).toEqual([]);
      });
    });

    it('provides reactive index accessor', async () => {
      testRoot(() => {
        const list = new Signal(['a', 'b', 'c']);
        const indices: number[] = [];
        const mapped = mapByItem(
          () => list.value,
          (item, index) => {
            indices.push(index());
            return `${index()}: ${item}`;
          }
        );
        settle();

        expect(indices).toEqual([0, 1, 2]);
        expect(mapped()).toEqual(['0: a', '1: b', '2: c']);
      });
    });
  });

  describe('caching behavior', () => {
    it('caches results by reference for objects', async () => {
      testRoot(() => {
        const obj1 = { id: 1 };
        const obj2 = { id: 2 };
        const obj3 = { id: 3 };
        const list = new Signal([obj1, obj2]);
        const mapCalls: number[] = [];

        const mapped = mapByItem(
          () => list.value,
          (item) => {
            mapCalls.push(item.id);
            return `item-${item.id}`;
          }
        );
        settle();

        expect(mapCalls).toEqual([1, 2]);
        expect(mapped()).toEqual(['item-1', 'item-2']);

        // Add a new item
        list.value = [obj1, obj2, obj3];
        settle();

        // Only the new item should trigger mapping
        expect(mapCalls).toEqual([1, 2, 3]);
        expect(mapped()).toEqual(['item-1', 'item-2', 'item-3']);
      });
    });

    it('reuses cached results when items are reordered', async () => {
      testRoot(() => {
        const obj1 = { id: 1 };
        const obj2 = { id: 2 };
        const obj3 = { id: 3 };
        const list = new Signal([obj1, obj2, obj3]);
        const mapCalls: number[] = [];

        const mapped = mapByItem(
          () => list.value,
          (item) => {
            mapCalls.push(item.id);
            return `item-${item.id}`;
          }
        );
        settle();

        expect(mapCalls).toEqual([1, 2, 3]);

        // Reorder - reverse the list
        list.value = [obj3, obj2, obj1];
        settle();

        // No new mapping calls should occur
        expect(mapCalls).toEqual([1, 2, 3]);
        expect(mapped()).toEqual(['item-3', 'item-2', 'item-1']);
      });
    });

    it('removes cached entries when items are removed', async () => {
      testRoot(() => {
        const obj1 = { id: 1 };
        const obj2 = { id: 2 };
        const obj3 = { id: 3 };
        const list = new Signal([obj1, obj2, obj3]);
        const mapCalls: number[] = [];

        const mapped = mapByItem(
          () => list.value,
          (item) => {
            mapCalls.push(item.id);
            return `item-${item.id}`;
          }
        );
        settle();

        // Remove middle item
        list.value = [obj1, obj3];
        settle();

        expect(mapped()).toEqual(['item-1', 'item-3']);
        expect(mapCalls).toEqual([1, 2, 3]); // No new calls

        // Re-add obj2 should create new mapping
        list.value = [obj1, obj2, obj3];
        settle();

        expect(mapCalls).toEqual([1, 2, 3, 2]); // obj2 mapped again
      });
    });
  });

  describe('keyFn option', () => {
    it('uses keyFn for tracking instead of reference', async () => {
      testRoot(() => {
        const list = new Signal([
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ]);
        const mapCalls: number[] = [];

        const mapped = mapByItem(
          () => list.value,
          (item) => {
            mapCalls.push(item.id);
            return `user-${item.id}`;
          },
          { keyFn: (item) => item.id }
        );
        settle();

        expect(mapCalls).toEqual([1, 2]);

        // Update with new object references but same keys
        list.value = [
          { id: 1, name: 'Alice Updated' },
          { id: 2, name: 'Bob Updated' },
        ];
        settle();

        // Should reuse cached results because keys match
        expect(mapCalls).toEqual([1, 2]);
        expect(mapped()).toEqual(['user-1', 'user-2']);
      });
    });

    it('handles primitive arrays with keyFn', async () => {
      testRoot(() => {
        const list = new Signal([1, 2, 3]);
        const mapCalls: number[] = [];

        const mapped = mapByItem(
          () => list.value,
          (item) => {
            mapCalls.push(item);
            return item * 10;
          },
          { keyFn: (item) => item }
        );
        settle();

        expect(mapCalls).toEqual([1, 2, 3]);
        expect(mapped()).toEqual([10, 20, 30]);

        // Reorder
        list.value = [3, 1, 2];
        settle();

        // No new mapping
        expect(mapCalls).toEqual([1, 2, 3]);
        expect(mapped()).toEqual([30, 10, 20]);
      });
    });
  });

  describe('reactive index', () => {
    it('updates index when items are reordered', async () => {
      testRoot(() => {
        const obj1 = { id: 1 };
        const obj2 = { id: 2 };
        const obj3 = { id: 3 };
        const list = new Signal([obj1, obj2, obj3]);
        const indexResults: Array<{ id: number; index: () => number }> = [];

        const mapped = mapByItem(
          () => list.value,
          (item, index) => {
            const result = { id: item.id, index };
            indexResults.push(result);
            return result;
          }
        );
        void mapped; // Unused - we only care about indexResults
        settle();

        expect(indexResults[0]!.index()).toBe(0);
        expect(indexResults[1]!.index()).toBe(1);
        expect(indexResults[2]!.index()).toBe(2);

        // Reverse order
        list.value = [obj3, obj2, obj1];
        settle();

        // Same objects, but indices should update
        expect(indexResults[0]!.index()).toBe(2); // obj1 now at index 2
        expect(indexResults[1]!.index()).toBe(1); // obj2 still at index 1
        expect(indexResults[2]!.index()).toBe(0); // obj3 now at index 0
      });
    });
  });

  describe('cleanup', () => {
    it('disposes all entries when root is disposed', async () => {
      const mapCalls: number[] = [];

      const dispose = await createRoot(async (dispose) => {
        const obj1 = { id: 1 };
        const obj2 = { id: 2 };
        const list = new Signal([obj1, obj2]);

        mapByItem(
          () => list.value,
          (item) => {
            mapCalls.push(item.id);
            return `item-${item.id}`;
          }
        );
        settle();

        return dispose;
      });

      expect(mapCalls).toEqual([1, 2]);

      // Dispose the root
      dispose();

      // After disposal, the cache should be cleared
      // We can't directly test this, but we can verify no errors occur
    });
  });
});

describe('mapByIndex', () => {
  describe('basic functionality', () => {
    it('maps an array by index', async () => {
      testRoot(() => {
        const list = new Signal([10, 20, 30]);
        const mapped = mapByIndex(
          () => list.value,
          (itemSignal, index) => {
            return { index, value: itemSignal() };
          }
        );
        settle();

        const result = mapped();
        expect(result[0]!).toEqual({ index: 0, value: 10 });
        expect(result[1]!).toEqual({ index: 1, value: 20 });
        expect(result[2]!).toEqual({ index: 2, value: 30 });
      });
    });

    it('returns empty array for empty input', async () => {
      testRoot(() => {
        const list = new Signal<number[]>([]);
        const mapped = mapByIndex(
          () => list.value,
          (_item, index) => index
        );
        settle();

        expect(mapped()).toEqual([]);
      });
    });

    it('provides reactive item accessor', async () => {
      testRoot(() => {
        const list = new Signal(['a', 'b', 'c']);
        const itemAccessors: Array<() => string> = [];

        const mapped = mapByIndex(
          () => list.value,
          (itemSignal, index) => {
            itemAccessors.push(itemSignal);
            return `${index}: ${itemSignal()}`;
          }
        );
        void mapped; // Unused - we only care about itemAccessors
        settle();

        expect(itemAccessors[0]!()).toBe('a');
        expect(itemAccessors[1]!()).toBe('b');
        expect(itemAccessors[2]!()).toBe('c');
      });
    });
  });

  describe('caching behavior', () => {
    it('caches results by index position', async () => {
      testRoot(() => {
        const list = new Signal(['a', 'b']);
        const mapCalls: number[] = [];

        const mapped = mapByIndex(
          () => list.value,
          (_itemSignal, index) => {
            mapCalls.push(index);
            return `cell-${index}`;
          }
        );
        settle();

        expect(mapCalls).toEqual([0, 1]);
        expect(mapped()).toEqual(['cell-0', 'cell-1']);

        // Add a new item
        list.value = ['a', 'b', 'c'];
        settle();

        // Only the new index should trigger mapping
        expect(mapCalls).toEqual([0, 1, 2]);
        expect(mapped()).toEqual(['cell-0', 'cell-1', 'cell-2']);
      });
    });

    it('reuses cached results when items at indices change', async () => {
      testRoot(() => {
        const list = new Signal(['a', 'b', 'c']);
        const mapCalls: number[] = [];
        const itemAccessors: Array<() => string> = [];

        const mapped = mapByIndex(
          () => list.value,
          (itemSignal, index) => {
            mapCalls.push(index);
            itemAccessors.push(itemSignal);
            return `cell-${index}`;
          }
        );
        void mapped; // Unused - we only care about mapCalls and itemAccessors
        settle();

        expect(mapCalls).toEqual([0, 1, 2]);

        // Swap items - same length
        list.value = ['c', 'b', 'a'];
        settle();

        // No new mapping calls (same indices)
        expect(mapCalls).toEqual([0, 1, 2]);
        // But item signals should update
        expect(itemAccessors[0]!()).toBe('c');
        expect(itemAccessors[1]!()).toBe('b');
        expect(itemAccessors[2]!()).toBe('a');
      });
    });

    it('disposes entries when array shrinks', async () => {
      testRoot(() => {
        const list = new Signal(['a', 'b', 'c', 'd']);
        const mapCalls: number[] = [];

        const mapped = mapByIndex(
          () => list.value,
          (_itemSignal, index) => {
            mapCalls.push(index);
            return `cell-${index}`;
          }
        );
        settle();

        expect(mapCalls).toEqual([0, 1, 2, 3]);
        expect(mapped()).toEqual(['cell-0', 'cell-1', 'cell-2', 'cell-3']);

        // Shrink the array
        list.value = ['a', 'b'];
        settle();

        expect(mapped()).toEqual(['cell-0', 'cell-1']);
        // No new mapping calls
        expect(mapCalls).toEqual([0, 1, 2, 3]);
      });
    });

    it('creates new entries when array grows after shrinking', async () => {
      testRoot(() => {
        const list = new Signal(['a', 'b', 'c']);
        const mapCalls: number[] = [];

        const mapped = mapByIndex(
          () => list.value,
          (_itemSignal, index) => {
            mapCalls.push(index);
            return `cell-${index}`;
          }
        );
        settle();

        expect(mapCalls).toEqual([0, 1, 2]);

        // Shrink
        list.value = ['a'];
        settle();
        expect(mapped()).toEqual(['cell-0']);

        // Grow again
        list.value = ['a', 'b', 'c', 'd'];
        settle();

        // Should create new entries for indices 1, 2, 3
        expect(mapCalls).toEqual([0, 1, 2, 1, 2, 3]);
        expect(mapped()).toEqual(['cell-0', 'cell-1', 'cell-2', 'cell-3']);
      });
    });
  });

  describe('reactive item updates', () => {
    it('item signal updates when content at index changes', async () => {
      testRoot(() => {
        const list = new Signal([100, 200, 300]);
        const itemAccessors: Array<() => number> = [];

        mapByIndex(
          () => list.value,
          (itemSignal, _index) => {
            itemAccessors.push(itemSignal);
            return itemSignal();
          }
        );
        settle();

        expect(itemAccessors[0]!()).toBe(100);
        expect(itemAccessors[1]!()).toBe(200);
        expect(itemAccessors[2]!()).toBe(300);

        // Change values
        list.value = [999, 888, 777];
        settle();

        expect(itemAccessors[0]!()).toBe(999);
        expect(itemAccessors[1]!()).toBe(888);
        expect(itemAccessors[2]!()).toBe(777);
      });
    });
  });

  describe('cleanup', () => {
    it('disposes all entries when root is disposed', async () => {
      const mapCalls: number[] = [];

      const dispose = await createRoot(async (dispose) => {
        const list = new Signal([1, 2, 3]);

        mapByIndex(
          () => list.value,
          (_itemSignal, index) => {
            mapCalls.push(index);
            return `cell-${index}`;
          }
        );
        settle();

        return dispose;
      });

      expect(mapCalls).toEqual([0, 1, 2]);

      // Dispose the root
      dispose();

      // Cache should be cleared (no observable effect, but no errors)
    });
  });
});

describe('mapByItem vs mapByIndex comparison', () => {
  it('mapByItem preserves mapping when items reorder, mapByIndex does not', async () => {
    testRoot(() => {
      const obj1 = { id: 1, name: 'Alice' };
      const obj2 = { id: 2, name: 'Bob' };
      const list = new Signal([obj1, obj2]);

      const byItemCalls: string[] = [];
      const byIndexCalls: number[] = [];

      // mapByItem tracks by item reference
      const byItem = mapByItem(
        () => list.value,
        (item) => {
          byItemCalls.push(item.name);
          return `by-item-${item.id}`;
        }
      );

      // mapByIndex tracks by position
      const byIndex = mapByIndex(
        () => list.value,
        (_itemSignal, index) => {
          byIndexCalls.push(index);
          return `by-index-${index}`;
        }
      );

      settle();

      expect(byItemCalls).toEqual(['Alice', 'Bob']);
      expect(byIndexCalls).toEqual([0, 1]);

      // Swap order
      list.value = [obj2, obj1];
      settle();

      // mapByItem: No new calls, results reordered
      expect(byItemCalls).toEqual(['Alice', 'Bob']);
      expect(byItem()).toEqual(['by-item-2', 'by-item-1']);

      // mapByIndex: No new calls, results unchanged (same indices)
      expect(byIndexCalls).toEqual([0, 1]);
      expect(byIndex()).toEqual(['by-index-0', 'by-index-1']);
    });
  });

  it('mapByItem runs mapFn for new items, mapByIndex for new indices', async () => {
    testRoot(() => {
      const obj1 = { id: 1 };
      const list = new Signal([obj1]);

      const byItemCalls: number[] = [];
      const byIndexCalls: number[] = [];

      mapByItem(
        () => list.value,
        (item) => {
          byItemCalls.push(item.id);
          return item.id;
        }
      );

      mapByIndex(
        () => list.value,
        (_itemSignal, index) => {
          byIndexCalls.push(index);
          return index;
        }
      );

      settle();

      expect(byItemCalls).toEqual([1]);
      expect(byIndexCalls).toEqual([0]);

      // Add a new item
      const obj2 = { id: 2 };
      list.value = [obj1, obj2];
      settle();

      // Both run for new item/index
      expect(byItemCalls).toEqual([1, 2]);
      expect(byIndexCalls).toEqual([0, 1]);

      // Add obj1 again at a new position (duplicate reference)
      list.value = [obj1, obj2, obj1];
      settle();
      expectLogged('warn', 'reactivity:map-duplicate-key');

      // mapByItem uses same cached result for obj1
      expect(byItemCalls).toEqual([1, 2]);
      // mapByIndex creates new entry for index 2
      expect(byIndexCalls).toEqual([0, 1, 2]);
    });
  });
});

describe('row reactivity across list changes', () => {
  it('mapByItem keeps every cached row reactive', () => {
    const list = new Signal(['a', 'b']);
    const tick = new Signal(0);
    const runs: string[] = [];

    testRoot(() => {
      const rows = mapByItem(
        () => list.value,
        (item) => {
          effect(() => {
            runs.push(`${item}${tick.value}`);
          });
          return item;
        }
      );
      effect(() => rows());
    });
    settle();

    list.value = [...list.value, 'c'];
    settle();
    runs.length = 0;

    tick.value = 1;
    settle();

    expect(runs.sort()).toEqual(['a1', 'b1', 'c1']);
  });

  it('mapByIndex keeps every cached row reactive', () => {
    const list = new Signal(['a', 'b']);
    const tick = new Signal(0);
    const runs: number[] = [];

    testRoot(() => {
      const rows = mapByIndex(
        () => list.value,
        (_item, index) => {
          effect(() => {
            runs.push(index * 10 + tick.value);
          });
          return index;
        }
      );
      effect(() => rows());
    });
    settle();

    list.value = [...list.value, 'c'];
    settle();
    runs.length = 0;

    tick.value = 1;
    settle();

    expect(runs.sort()).toEqual([1, 11, 21]);
  });

  it('mapByItem does not re-run the list for reads in the map function', () => {
    const list = new Signal(['a']);
    const other = new Signal(0);
    let maps = 0;

    testRoot(() => {
      const rows = mapByItem(
        () => list.value,
        (item) => {
          maps++;
          return `${item}${other.value}`;
        }
      );
      effect(() => rows());
    });
    settle();

    other.value = 1;
    settle();

    expect(maps).toBe(1);
  });
});

describe('mapByItem rows', () => {
  it('disposes every row when the list empties and maps them again after', () => {
    testRoot(() => {
      const list = new Signal([1, 2, 3]);
      const label = new Signal('a');
      let runs = 0;
      let maps = 0;
      const mapped = mapByItem(
        () => list.value,
        (item) => {
          maps++;
          effect(() => {
            runs++;
            return `${item}${label.value}`;
          });
          return item;
        }
      );
      effect(() => mapped());
      settle();

      list.value = [];
      settle();
      expect(mapped()).toEqual([]);
      runs = 0;
      label.value = 'b';
      settle();
      expect(runs).toBe(0);

      list.value = [1, 2];
      settle();
      expect(mapped()).toEqual([1, 2]);
      expect(maps).toBe(5);
    });
  });

  it('keeps a duplicate item as one row and removes it once both are gone', () => {
    testRoot(() => {
      const list = new Signal([1, 1, 2]);
      let disposed = 0;
      const mapped = mapByItem(
        () => list.value,
        (item) => {
          onCleanup(() => disposed++);
          return item;
        }
      );
      settle();
      expect(mapped()).toEqual([1, 1, 2]);
      expectLogged('warn', 'reactivity:map-duplicate-key');

      list.value = [1, 2];
      settle();
      expect(disposed).toBe(0);

      list.value = [2];
      settle();
      expect(disposed).toBe(1);
    });
  });

  it('updates an index read only after a move', () => {
    testRoot(() => {
      const list = new Signal(['a', 'b', 'c']);
      const mapped = mapByItem(
        () => list.value,
        (item, index) => ({ item, index })
      );
      settle();

      list.value = ['c', 'a', 'b'];
      settle();
      expect(mapped().map((row) => [row.item, row.index()])).toEqual([
        ['c', 0],
        ['a', 1],
        ['b', 2],
      ]);
    });
  });
});

describe('mapByIndex result', () => {
  it('keeps the result when the length is unchanged, and updates the items', () => {
    testRoot(() => {
      const list = new Signal([1, 2, 3]);
      const mapped = mapByIndex(
        () => list.value,
        (item) => item
      );
      let consumerRuns = 0;
      effect(() => {
        consumerRuns++;
        mapped();
      });
      settle();
      const first = mapped();
      consumerRuns = 0;

      list.value = [1, 5, 3];
      settle();
      expect(mapped()).toBe(first);
      expect(consumerRuns).toBe(0);
      expect(first[1]!()).toBe(5);

      list.value = [1, 5, 3, 4];
      settle();
      expect(consumerRuns).toBe(1);
      expect(mapped().map((item) => item())).toEqual([1, 5, 3, 4]);
    });
  });

  it('sees an item changed in place in the same array', () => {
    testRoot(() => {
      const items = [1, 2, 3];
      const list = new Signal(items, { equals: () => false });
      const mapped = mapByIndex(
        () => list.value,
        (item) => item
      );
      settle();

      items[1] = 7;
      list.value = items;
      settle();
      expect(mapped().map((item) => item())).toEqual([1, 7, 3]);
    });
  });
});

describe('mapByItem with duplicate items', () => {
  it('warns that they share one row', () => {
    const list = new Signal(['a', 'b', 'a']);
    testRoot(() => {
      const mapped = mapByItem(
        () => list.value,
        (item) => item.toUpperCase()
      );
      settle();
      expect(mapped()).toEqual(['A', 'B', 'A']);
    });
    expectLogged('warn', 'reactivity:map-duplicate-key');
  });
});
