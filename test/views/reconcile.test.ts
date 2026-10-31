/**
 * Tests for keyed reconciliation algorithm
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  longestIncreasingSubsequence,
  reconcile,
  type KeyedItem,
  type ReconcileKey,
} from '../../src/views/reconcile';

describe('Keyed Reconciliation', () => {
  describe('longestIncreasingSubsequence', () => {
    it('should return empty array for empty input', () => {
      expect(longestIncreasingSubsequence([])).toEqual([]);
    });

    it('should return single element for single item', () => {
      expect(longestIncreasingSubsequence([5])).toEqual([0]);
    });

    it('should find LIS in sorted array', () => {
      const result = longestIncreasingSubsequence([0, 1, 2, 3, 4]);
      expect(result).toEqual([0, 1, 2, 3, 4]);
    });

    it('should find LIS in reverse sorted array', () => {
      const result = longestIncreasingSubsequence([4, 3, 2, 1, 0]);
      // Only one element can be in the LIS
      expect(result.length).toBe(1);
    });

    it('should find LIS with mixed values', () => {
      // [1, 3, 0, 2, 4] -> LIS could be [1, 2, 4] or [0, 2, 4] (indices [0, 3, 4] or [2, 3, 4])
      const result = longestIncreasingSubsequence([1, 3, 0, 2, 4]);
      const arr = [1, 3, 0, 2, 4];
      expect(result.length).toBe(3);
      // Verify it's actually increasing
      for (let i = 1; i < result.length; i++) {
        const currIdx = result[i]!;
        const prevIdx = result[i - 1]!;
        expect(arr[currIdx]!).toBeGreaterThan(arr[prevIdx]!);
      }
    });

    it('should skip -1 values (new items)', () => {
      const result = longestIncreasingSubsequence([-1, 0, -1, 1, 2]);
      // Should find [0, 1, 2] at indices [1, 3, 4]
      expect(result).toEqual([1, 3, 4]);
    });

    it('should handle all -1 values', () => {
      const result = longestIncreasingSubsequence([-1, -1, -1]);
      expect(result).toEqual([]);
    });
  });

  describe('reconcile', () => {
    let container: HTMLElement;
    let endMarker: Comment;

    function render(
      item: { id: number; text: string },
      index: () => number
    ): Node {
      const el = document.createElement('div');
      el.textContent = item.text;
      el.dataset['id'] = String(item.id);
      el.dataset['index'] = String(index());
      return el;
    }

    function getKey(item: { id: number; text: string }): ReconcileKey {
      return item.id;
    }

    function getRenderedIds(): number[] {
      return Array.from(container.querySelectorAll('div'))
        .filter((el) => el.dataset['id'])
        .map((el) => Number(el.dataset['id']));
    }

    function getRenderedTexts(): string[] {
      return Array.from(container.querySelectorAll('div'))
        .filter((el) => el.dataset['id'])
        .map((el) => el.textContent || '');
    }

    beforeEach(() => {
      container = document.createElement('div');
      endMarker = document.createComment('end');
      container.appendChild(endMarker);
    });

    it('should render initial items', () => {
      const items = [
        { id: 1, text: 'A' },
        { id: 2, text: 'B' },
        { id: 3, text: 'C' },
      ];

      const result = reconcile(container, [], items, getKey, render, endMarker);

      expect(result.items.length).toBe(3);
      // The rows and the end marker, nothing left behind
      expect(container.childNodes).toHaveLength(result.items.length + 1);
      expect(getRenderedIds()).toEqual([1, 2, 3]);
      expect(getRenderedTexts()).toEqual(['A', 'B', 'C']);
    });

    it('should handle empty next list', () => {
      const items = [
        { id: 1, text: 'A' },
        { id: 2, text: 'B' },
      ];

      const firstResult = reconcile(
        container,
        [],
        items,
        getKey,
        render,
        endMarker
      );
      const secondResult = reconcile(
        container,
        firstResult.items,
        [],
        getKey,
        render,
        endMarker
      );

      expect(secondResult.items.length).toBe(0);
      // The rows and the end marker, nothing left behind
      expect(container.childNodes).toHaveLength(secondResult.items.length + 1);
      expect(getRenderedIds()).toEqual([]);
    });

    it('should append new items', () => {
      const items1 = [
        { id: 1, text: 'A' },
        { id: 2, text: 'B' },
      ];

      const items2 = [
        { id: 1, text: 'A' },
        { id: 2, text: 'B' },
        { id: 3, text: 'C' },
        { id: 4, text: 'D' },
      ];

      const result1 = reconcile(
        container,
        [],
        items1,
        getKey,
        render,
        endMarker
      );
      const originalNodes = result1.items.map((i) => i.firstNode);

      const result2 = reconcile(
        container,
        result1.items,
        items2,
        getKey,
        render,
        endMarker
      );

      expect(result2.items.length).toBe(4);
      // The rows and the end marker, nothing left behind
      expect(container.childNodes).toHaveLength(result2.items.length + 1);
      expect(getRenderedIds()).toEqual([1, 2, 3, 4]);

      // Original nodes should be reused
      expect(result2.items[0]!.firstNode).toBe(originalNodes[0]);
      expect(result2.items[1]!.firstNode).toBe(originalNodes[1]);
    });

    it('should prepend new items', () => {
      const items1 = [
        { id: 2, text: 'B' },
        { id: 3, text: 'C' },
      ];

      const items2 = [
        { id: 1, text: 'A' },
        { id: 2, text: 'B' },
        { id: 3, text: 'C' },
      ];

      const result1 = reconcile(
        container,
        [],
        items1,
        getKey,
        render,
        endMarker
      );
      const originalNodes = result1.items.map((i) => i.firstNode);

      const result2 = reconcile(
        container,
        result1.items,
        items2,
        getKey,
        render,
        endMarker
      );

      expect(result2.items.length).toBe(3);
      expect(getRenderedIds()).toEqual([1, 2, 3]);

      // Original nodes should be reused (now at indices 1 and 2)
      expect(result2.items[1]!.firstNode).toBe(originalNodes[0]);
      expect(result2.items[2]!.firstNode).toBe(originalNodes[1]);
    });

    it('should remove items', () => {
      const items1 = [
        { id: 1, text: 'A' },
        { id: 2, text: 'B' },
        { id: 3, text: 'C' },
      ];

      const items2 = [
        { id: 1, text: 'A' },
        { id: 3, text: 'C' },
      ];

      const result1 = reconcile(
        container,
        [],
        items1,
        getKey,
        render,
        endMarker
      );
      const result2 = reconcile(
        container,
        result1.items,
        items2,
        getKey,
        render,
        endMarker
      );

      expect(result2.items.length).toBe(2);
      // The rows and the end marker, nothing left behind
      expect(container.childNodes).toHaveLength(result2.items.length + 1);
      expect(getRenderedIds()).toEqual([1, 3]);
    });

    it('should reorder items without recreating nodes', () => {
      const items1 = [
        { id: 1, text: 'A' },
        { id: 2, text: 'B' },
        { id: 3, text: 'C' },
      ];

      const items2 = [
        { id: 3, text: 'C' },
        { id: 1, text: 'A' },
        { id: 2, text: 'B' },
      ];

      const result1 = reconcile(
        container,
        [],
        items1,
        getKey,
        render,
        endMarker
      );
      const originalNodes = new Map(
        result1.items.map((i) => [i.key, i.firstNode])
      );

      const result2 = reconcile(
        container,
        result1.items,
        items2,
        getKey,
        render,
        endMarker
      );

      expect(result2.items.length).toBe(3);
      // The rows and the end marker, nothing left behind
      expect(container.childNodes).toHaveLength(result2.items.length + 1);
      expect(getRenderedIds()).toEqual([3, 1, 2]);

      // All original nodes should be reused
      expect(result2.items[0]!.firstNode).toBe(originalNodes.get(3));
      expect(result2.items[1]!.firstNode).toBe(originalNodes.get(1));
      expect(result2.items[2]!.firstNode).toBe(originalNodes.get(2));
    });

    it('should reverse list efficiently', () => {
      const items1 = [
        { id: 1, text: 'A' },
        { id: 2, text: 'B' },
        { id: 3, text: 'C' },
        { id: 4, text: 'D' },
        { id: 5, text: 'E' },
      ];

      const items2 = [
        { id: 5, text: 'E' },
        { id: 4, text: 'D' },
        { id: 3, text: 'C' },
        { id: 2, text: 'B' },
        { id: 1, text: 'A' },
      ];

      const result1 = reconcile(
        container,
        [],
        items1,
        getKey,
        render,
        endMarker
      );
      const originalNodes = new Map(
        result1.items.map((i) => [i.key, i.firstNode])
      );

      const result2 = reconcile(
        container,
        result1.items,
        items2,
        getKey,
        render,
        endMarker
      );

      expect(result2.items.length).toBe(5);
      expect(getRenderedIds()).toEqual([5, 4, 3, 2, 1]);

      // All nodes should be reused
      for (const item of result2.items) {
        expect(item.firstNode).toBe(originalNodes.get(item.key));
      }
    });

    it('should handle mixed add/remove/reorder', () => {
      const items1 = [
        { id: 1, text: 'A' },
        { id: 2, text: 'B' },
        { id: 3, text: 'C' },
        { id: 4, text: 'D' },
      ];

      // Remove 2, add 5, reorder
      const items2 = [
        { id: 4, text: 'D' },
        { id: 5, text: 'E' },
        { id: 1, text: 'A' },
        { id: 3, text: 'C' },
      ];

      const result1 = reconcile(
        container,
        [],
        items1,
        getKey,
        render,
        endMarker
      );
      const originalNodes = new Map(
        result1.items.map((i) => [i.key, i.firstNode])
      );

      const result2 = reconcile(
        container,
        result1.items,
        items2,
        getKey,
        render,
        endMarker
      );

      expect(result2.items.length).toBe(4);
      // The rows and the end marker, nothing left behind
      expect(container.childNodes).toHaveLength(result2.items.length + 1);
      expect(getRenderedIds()).toEqual([4, 5, 1, 3]);

      // Reused nodes should be the same instances
      expect(result2.items[0]!.firstNode).toBe(originalNodes.get(4));
      expect(result2.items[2]!.firstNode).toBe(originalNodes.get(1));
      expect(result2.items[3]!.firstNode).toBe(originalNodes.get(3));

      // New node should not be in original
      expect(originalNodes.has(5)).toBe(false);
    });

    it('should update reactive indices on reorder', () => {
      const items1 = [
        { id: 1, text: 'A' },
        { id: 2, text: 'B' },
        { id: 3, text: 'C' },
      ];

      const result1 = reconcile(
        container,
        [],
        items1,
        getKey,
        render,
        endMarker
      );

      // Check initial indices
      expect(result1.items[0]!.index.value).toBe(0);
      expect(result1.items[1]!.index.value).toBe(1);
      expect(result1.items[2]!.index.value).toBe(2);

      // Reorder
      const items2 = [
        { id: 3, text: 'C' },
        { id: 1, text: 'A' },
        { id: 2, text: 'B' },
      ];

      const result2 = reconcile(
        container,
        result1.items,
        items2,
        getKey,
        render,
        endMarker
      );

      // Find the original items by key and check their updated indices
      const itemById = new Map(result2.items.map((i) => [i.key, i]));
      expect(itemById.get(3)!.index.value).toBe(0);
      expect(itemById.get(1)!.index.value).toBe(1);
      expect(itemById.get(2)!.index.value).toBe(2);
    });

    it('should handle common prefix optimization', () => {
      const items1 = [
        { id: 1, text: 'A' },
        { id: 2, text: 'B' },
        { id: 3, text: 'C' },
      ];

      // Same prefix, different suffix
      const items2 = [
        { id: 1, text: 'A' },
        { id: 2, text: 'B' },
        { id: 4, text: 'D' },
        { id: 5, text: 'E' },
      ];

      const result1 = reconcile(
        container,
        [],
        items1,
        getKey,
        render,
        endMarker
      );
      const originalNodes = new Map(
        result1.items.map((i) => [i.key, i.firstNode])
      );

      const result2 = reconcile(
        container,
        result1.items,
        items2,
        getKey,
        render,
        endMarker
      );

      expect(result2.items.length).toBe(4);
      expect(getRenderedIds()).toEqual([1, 2, 4, 5]);

      // First two should be reused
      expect(result2.items[0]!.firstNode).toBe(originalNodes.get(1));
      expect(result2.items[1]!.firstNode).toBe(originalNodes.get(2));
    });

    it('should handle common suffix optimization', () => {
      const items1 = [
        { id: 1, text: 'A' },
        { id: 2, text: 'B' },
        { id: 3, text: 'C' },
      ];

      // Different prefix, same suffix
      const items2 = [
        { id: 4, text: 'D' },
        { id: 5, text: 'E' },
        { id: 2, text: 'B' },
        { id: 3, text: 'C' },
      ];

      const result1 = reconcile(
        container,
        [],
        items1,
        getKey,
        render,
        endMarker
      );
      const originalNodes = new Map(
        result1.items.map((i) => [i.key, i.firstNode])
      );

      const result2 = reconcile(
        container,
        result1.items,
        items2,
        getKey,
        render,
        endMarker
      );

      expect(result2.items.length).toBe(4);
      expect(getRenderedIds()).toEqual([4, 5, 2, 3]);

      // Last two should be reused
      expect(result2.items[2]!.firstNode).toBe(originalNodes.get(2));
      expect(result2.items[3]!.firstNode).toBe(originalNodes.get(3));
    });

    it('should handle large list efficiently', () => {
      const size = 1000;
      const items1 = Array.from({ length: size }, (_, i) => ({
        id: i,
        text: `Item ${i}`,
      }));

      // Shuffle the list
      const items2 = [...items1].sort(() => Math.random() - 0.5);

      const result1 = reconcile(
        container,
        [],
        items1,
        getKey,
        render,
        endMarker
      );
      const originalNodes = new Map(
        result1.items.map((i) => [i.key, i.firstNode])
      );

      const startTime = performance.now();
      const result2 = reconcile(
        container,
        result1.items,
        items2,
        getKey,
        render,
        endMarker
      );
      const elapsed = performance.now() - startTime;

      // Should complete in reasonable time (< 100ms for 1000 items)
      expect(elapsed).toBeLessThan(100);

      // All nodes should be reused
      for (const item of result2.items) {
        expect(item.firstNode).toBe(originalNodes.get(item.key));
      }
    });

    it('should handle items with same data but different keys', () => {
      const items1 = [
        { id: 1, text: 'Same' },
        { id: 2, text: 'Same' },
      ];

      const items2 = [
        { id: 2, text: 'Same' },
        { id: 1, text: 'Same' },
      ];

      const result1 = reconcile(
        container,
        [],
        items1,
        getKey,
        render,
        endMarker
      );
      const node1 = result1.items[0]!.firstNode;
      const node2 = result1.items[1]!.firstNode;

      const result2 = reconcile(
        container,
        result1.items,
        items2,
        getKey,
        render,
        endMarker
      );

      // Nodes should be swapped, not recreated
      expect(result2.items[0]!.firstNode).toBe(node2);
      expect(result2.items[1]!.firstNode).toBe(node1);
    });

    it('keeps an empty text node for a row that renders nothing', () => {
      const renderMaybe = (item: { id: number; text: string }) =>
        (item.id === 2 ? null : render(item, () => 0)) as Node;
      const rows = [1, 2, 3].map((id) => ({ id, text: String(id) }));

      const first = reconcile(
        container,
        [],
        rows,
        getKey,
        renderMaybe,
        endMarker
      );
      const empty = first.items[1]!.firstNode;
      expect(empty).toBeInstanceOf(Text);
      expect((empty as Text).data).toBe('');

      // The empty row still anchors the row inserted before it
      reconcile(
        container,
        first.items,
        [rows[0]!, { id: 4, text: '4' }, rows[1]!, rows[2]!],
        getKey,
        renderMaybe,
        endMarker
      );
      expect(getRenderedIds()).toEqual([1, 4, 3]);
      expect(container.textContent).toBe('143');
      expect(container.childNodes[2]).toBe(empty);
    });

    describe('clearAll', () => {
      const rows = (...ids: number[]) =>
        ids.map((id) => ({ id, text: String(id) }));
      const clearAll = () => {
        calls++;
        container.textContent = '';
        container.appendChild(endMarker);
      };
      let calls = 0;

      beforeEach(() => {
        calls = 0;
      });

      it('clears the parent once when no row is kept', () => {
        const first = reconcile(
          container,
          [],
          rows(1, 2, 3),
          getKey,
          render,
          endMarker
        );
        const result = reconcile(
          container,
          first.items,
          rows(4, 5),
          getKey,
          render,
          endMarker,
          null,
          clearAll
        );

        expect(calls).toBe(1);
        expect(getRenderedIds()).toEqual([4, 5]);
        expect(result.items.map((item) => item.key)).toEqual([4, 5]);
        expect(container.lastChild).toBe(endMarker);
      });

      it('does not clear when a row is kept in the middle', () => {
        const first = reconcile(
          container,
          [],
          rows(1, 2, 3),
          getKey,
          render,
          endMarker
        );
        const two = first.items[1]!.firstNode;
        reconcile(
          container,
          first.items,
          rows(5, 2, 4),
          getKey,
          render,
          endMarker,
          null,
          clearAll
        );

        expect(calls).toBe(0);
        expect(getRenderedIds()).toEqual([5, 2, 4]);
        expect(container.querySelectorAll('div')[1]).toBe(two);
      });

      it('does not clear when the first or last row is kept', () => {
        const first = reconcile(
          container,
          [],
          rows(1, 2, 3),
          getKey,
          render,
          endMarker
        );
        const second = reconcile(
          container,
          first.items,
          rows(1, 4, 5),
          getKey,
          render,
          endMarker,
          null,
          clearAll
        );
        reconcile(
          container,
          second.items,
          rows(6, 7, 5),
          getKey,
          render,
          endMarker,
          null,
          clearAll
        );

        expect(calls).toBe(0);
        expect(getRenderedIds()).toEqual([6, 7, 5]);
      });
    });
  });
});

describe('reconcile fast paths', () => {
  let container: HTMLElement;
  let endMarker: Comment;
  let renders: number;

  const render = (item: number) => {
    renders++;
    const li = document.createElement('li');
    li.textContent = String(item);
    return li;
  };
  const key = (item: number) => item;
  const texts = () =>
    Array.from(container.querySelectorAll('li')).map((li) => li.textContent);
  const run = (prev: KeyedItem<number>[], next: number[]) =>
    reconcile(container, prev, next, key, render, endMarker, null).items;

  beforeEach(() => {
    container = document.createElement('div');
    endMarker = container.appendChild(document.createComment('end'));
    renders = 0;
  });

  it.each([
    ['far apart', [1, 2, 3, 4, 5], [1, 4, 3, 2, 5]],
    ['adjacent', [1, 2, 3, 4], [1, 3, 2, 4]],
    ['at both ends', [1, 2, 3], [3, 2, 1]],
  ])('swaps two rows %s, keeping their nodes', (_name, before, after) => {
    const prev = run([], before);
    const nodes = new Map(prev.map((row) => [row.key, row.firstNode]));
    renders = 0;

    const next = run(prev, after);

    expect(texts()).toEqual(after.map(String));
    expect(renders).toBe(0);
    for (const row of next) expect(row.firstNode).toBe(nodes.get(row.key));
    expect(next.map((row) => row.index.value)).toEqual(after.map((_, i) => i));
  });

  it('replaces every row in order', () => {
    const prev = run([], [1, 2, 3]);
    run(prev, [4, 5, 6, 7]);
    expect(texts()).toEqual(['4', '5', '6', '7']);
  });

  it('inserts new rows before the next kept row', () => {
    const prev = run([], [1, 2, 3, 4]);
    run(prev, [1, 9, 2, 8, 7, 3, 6, 4]);
    expect(texts()).toEqual(['1', '9', '2', '8', '7', '3', '6', '4']);
  });

  it('inserts rows between a prefix and a suffix', () => {
    const prev = run([], [1, 2, 3]);
    const next = run(prev, [1, 7, 8, 2, 3]);
    expect(texts()).toEqual(['1', '7', '8', '2', '3']);
    expect(next.map((row) => row.index.value)).toEqual([0, 1, 2, 3, 4]);
  });

  it('gives an index read late the current position', () => {
    const prev = run([], [1, 2, 3]);
    const next = run(prev, [3, 1, 2]);
    expect(next.map((row) => [row.key, row.index.value])).toEqual([
      [3, 0],
      [1, 1],
      [2, 2],
    ]);
  });
});
