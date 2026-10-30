/**
 * Reactive Array Mapping Primitives
 *
 * Provides efficient reactive array mapping with memoization strategies.
 * These primitives cache computations to avoid unnecessary re-renders
 * when array contents change.
 *
 * @module reactivity/map-array
 *
 * @example
 * ```typescript
 * import { Signal, mapByItem, mapByIndex } from 'signy';
 *
 * const users = new Signal([
 *   { id: 1, name: 'Alice' },
 *   { id: 2, name: 'Bob' },
 * ]);
 *
 * // mapByItem - caches by item reference, index is reactive
 * const userCards = mapByItem(() => users.value, (user, index) => {
 *   console.log('Mapping user:', user.id); // Only logs for new/changed items
 *   return { element: createUserCard(user), index: index() };
 * });
 *
 * // mapByIndex - caches by index position, item is reactive
 * const gridCells = mapByIndex(() => users.value, (user, index) => {
 *   console.log('Mapping index:', index); // Only logs for new positions
 *   return { element: createCell(user), position: index };
 * });
 * ```
 *
 * ## When to Use Which
 *
 * **mapByItem()** - Use when items have stable identity:
 * - List of objects with unique IDs
 * - Items may be added, removed, or reordered
 * - Item content rarely changes but position may change
 *
 * **mapByIndex()** - Use when indices are more stable than items:
 * - Fixed-size grids or slot-based layouts
 * - Paginated data where items swap positions
 * - Content at each position changes frequently
 *
 * ## Known limitations
 *
 * **Duplicate items share a row in mapByItem()**: the same item, or key,
 * twice maps to one result, so its nodes show once. A dev warning names it.
 */

import { Signal } from './signal';
import { setCurrentSubscriber } from './signal/internal';
import {
  effect,
  onCleanup,
  createRoot,
  getOwner,
  runWithOwner,
  runInRow,
  RowOwner,
  type Owner,
} from './effect';
import type { Accessor } from './render';
import { logger } from '../log';
import { ReactiveLogMessages } from './log-messages';

//=============================================
// Types
//=============================================

/**
 * A map function that receives an item and reactive index accessor.
 * Used with `mapByItem()` where the item is stable and index may change.
 *
 * @template T - Item type
 * @template U - Mapped result type
 */
export type MapByItemFn<T, U> = (item: T, index: Accessor<number>) => U;

/**
 * A map function that receives an item accessor and a fixed index.
 * Used with `mapByIndex()` where the index is stable and item may change.
 *
 * @template T - Item type
 * @template U - Mapped result type
 */
export type MapByIndexFn<T, U> = (item: Accessor<T>, index: number) => U;

/**
 * Options for array mapping functions
 */
export interface MapArrayOptions<T> {
  /**
   * Custom key function to identify items.
   * When provided, items are tracked by key instead of reference.
   * Required for primitive arrays or when object references change.
   *
   * @example
   * ```typescript
   * mapByItem(users, mapFn, { keyFn: (user) => user.id });
   * ```
   */
  keyFn?: (item: T) => unknown;
}

/**
 * A list row whose index signal is created on the first read of its index,
 * as most rows never read it. Shared by `mapByItem()` and `For`.
 *
 * @internal
 */
export class IndexedRow extends RowOwner {
  /** Reads the index, tracked. The accessor handed to the map function */
  readonly readIndex: Accessor<number>;

  private _index: Signal<number> | null = null;
  private _position: number;

  constructor(position: number) {
    super();
    this._position = position;
    this.readIndex = () => this.index.value;
  }

  get index(): Signal<number> {
    return (this._index ??= new Signal(this._position));
  }

  setIndex(position: number): void {
    if (position === this._position) return;
    this._position = position;
    if (this._index) this._index.value = position;
  }
}

/**
 * Cache entry and row root of mapByItem
 */
class ItemEntry<U> extends IndexedRow {
  result!: U;
  /** Stamp of the last list run that saw this entry */
  seen = 0;
}

/**
 * Cache entry of mapByIndex
 */
interface IndexCacheEntry<T, U> {
  result: U;
  itemSignal: Signal<T>;
  dispose: () => void;
}

//=============================================
// Helpers
//=============================================

/**
 * Creates a row root under the owner of the mapping, not the list effect,
 * so the effect's next run does not dispose the cached rows. The map
 * function runs untracked, so what it reads does not re-run the list.
 */
function createRow<U>(owner: Owner | null, fn: (dispose: () => void) => U): U {
  const prevSubscriber = setCurrentSubscriber(null);
  try {
    return runWithOwner(owner, () => createRoot(fn));
  } finally {
    setCurrentSubscriber(prevSubscriber);
  }
}

//=============================================
// mapByItem
//=============================================

/**
 * Creates a reactive array mapping that caches results by item identity.
 *
 * Each item's mapping function runs only once when the item first appears
 * in the array. When items are reordered, the cached results are reused
 * and only the reactive index accessor updates.
 *
 * This is ideal for lists where items have stable identity (like objects
 * with IDs) and may be added, removed, or reordered.
 *
 * @template T - Item type
 * @template U - Mapped result type
 * @param list - Accessor returning the array to map
 * @param mapFn - Function to map each item (runs once per item)
 * @param options - Optional configuration
 * @returns Accessor returning array of mapped results
 *
 * @example
 * ```typescript
 * import { Signal, mapByItem, html } from 'signy';
 *
 * const todos = new Signal([
 *   { id: 1, text: 'Learn Signy' },
 *   { id: 2, text: 'Build app' },
 * ]);
 *
 * // Map function runs once per todo, index updates reactively
 * const todoElements = mapByItem(
 *   () => todos.value,
 *   (todo, index) => {
 *     console.log('Creating element for:', todo.id); // Only once per item
 *     return html`<li>${() => index() + 1}. ${todo.text}</li>`;
 *   },
 *   { keyFn: (todo) => todo.id }
 * );
 *
 * // Adding a new todo only creates one new element
 * todos.value = [...todos.value, { id: 3, text: 'Deploy' }];
 *
 * // Reordering doesn't recreate elements, just updates indices
 * todos.value = [...todos.value].reverse();
 * ```
 */
export function mapByItem<T, U>(
  list: Accessor<readonly T[]>,
  mapFn: MapByItemFn<T, U>,
  options?: MapArrayOptions<T>
): Accessor<U[]> {
  const keyFn = options?.keyFn;
  const owner = getOwner();

  // By key when keyFn is given, else by item reference
  const cache = new Map<unknown, ItemEntry<U>>();
  let stamp = 0;

  const result = new Signal<U[]>([]);

  onCleanup(() => {
    for (const entry of cache.values()) entry.dispose();
    cache.clear();
  });

  effect(() => {
    const items = list();
    const length = items.length;

    if (length === 0) {
      for (const entry of cache.values()) entry.dispose();
      cache.clear();
      if (result.peek().length > 0) result.value = [];
      return;
    }

    // Entries not stamped by this run are the removed ones
    const run = ++stamp;
    let seen = 0;
    const newResult = new Array<U>(length);

    for (let i = 0; i < length; i++) {
      const item = items[i] as T;
      const key = keyFn ? keyFn(item) : item;
      let entry = cache.get(key);

      if (entry) {
        entry.setIndex(i);
      } else {
        const row = (entry = new ItemEntry<U>(i));
        row.result = runInRow(row, owner, () => mapFn(item, row.readIndex));
        cache.set(key, row);
      }

      if (entry.seen !== run) {
        entry.seen = run;
        seen++;
      } else if (__DEV__) {
        // One row cannot be in two places: the DOM shows it once
        logger.warn(ReactiveLogMessages.MAP_DUPLICATE_KEY, { key, index: i });
      }
      newResult[i] = entry.result;
    }

    if (cache.size > seen) {
      for (const [key, entry] of cache) {
        if (entry.seen !== run) {
          entry.dispose();
          cache.delete(key);
        }
      }
    }

    result.value = newResult;
  });

  return () => result.value;
}

//=============================================
// mapByIndex
//=============================================

/**
 * Creates a reactive array mapping that caches results by index position.
 *
 * Each index slot's mapping function runs only once when that index first
 * appears. When items at an index change, the reactive item accessor
 * updates but the mapping is not re-run.
 *
 * This is ideal for fixed-size grids, slot-based layouts, or any case
 * where the number of positions is relatively stable but the content
 * at each position changes frequently.
 *
 * @template T - Item type
 * @template U - Mapped result type
 * @param list - Accessor returning the array to map
 * @param mapFn - Function to map each index (runs once per index)
 * @returns Accessor returning array of mapped results
 *
 * @example
 * ```typescript
 * import { Signal, mapByIndex, html } from 'signy';
 *
 * const items = new Signal(['a', 'b', 'c']);
 *
 * // Map function runs once per index, item updates reactively
 * const cells = mapByIndex(() => items.value, (item, index) => {
 *   console.log('Creating cell for index:', index); // Only once per index
 *   return html`<div class="cell">${index}: ${item}</div>`;
 * });
 *
 * // Swapping items doesn't recreate cells, just updates content
 * items.value = ['c', 'b', 'a']; // Cell elements stay the same
 *
 * // Adding a new item creates one new cell
 * items.set(prev => [...prev, 'd']);
 *
 * // Removing items disposes extra cells
 * items.set(prev => prev.slice(0, 2));
 * ```
 */
export function mapByIndex<T, U>(
  list: Accessor<readonly T[]>,
  mapFn: MapByIndexFn<T, U>
): Accessor<U[]> {
  // Cache by index position
  const cache: IndexCacheEntry<T, U>[] = [];
  // The items of the last run, compared in one array instead of per entry
  let prevItems: readonly T[] = [];
  const owner = getOwner();

  const result = new Signal<U[]>([]);

  onCleanup(() => {
    for (const entry of cache) entry.dispose();
    cache.length = 0;
  });

  effect(() => {
    const items = list();
    const length = items.length;
    // The row at each index stays, so a list of the same length gives the
    // same result and consumers have nothing to re-run for
    const resized = length !== cache.length;
    const newResult = resized ? new Array<U>(length) : null;
    const kept = Math.min(length, cache.length);

    for (let i = 0; i < kept; i++) {
      const item = items[i] as T;
      if (!Object.is(prevItems[i], item)) cache[i]!.itemSignal.value = item;
    }
    if (newResult) {
      for (let i = 0; i < kept; i++) newResult[i] = cache[i]!.result;
    }

    for (let i = kept; i < length; i++) {
      const item = items[i] as T;
      let itemSignal!: Signal<T>;
      let disposeEntry!: () => void;

      const entryResult = createRow(owner, (dispose) => {
        disposeEntry = dispose;
        itemSignal = new Signal<T>(item);
        return mapFn(() => itemSignal.value, i);
      });

      cache.push({
        result: entryResult,
        itemSignal,
        dispose: disposeEntry,
      });
      newResult![i] = entryResult;
    }

    // Dispose entries for removed indices (shrinking array)
    while (cache.length > length) {
      cache.pop()!.dispose();
    }

    // A copy, as the caller may change its array in place
    prevItems = items.slice();
    if (newResult) result.value = newResult;
  });

  return () => result.value;
}
