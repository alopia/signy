/**
 * Selector - Efficient Selection Tracking
 *
 * Provides a way to efficiently track selection state in lists.
 * Only notifies subscribers when their specific item's selection changes,
 * avoiding unnecessary re-renders of the entire list.
 *
 * Inspired by Solid.js's createSelector.
 *
 * @module reactivity/selector
 *
 * @example
 * ```typescript
 * import { Signal, createSelector, For, html } from 'signy';
 *
 * const selectedId = new Signal<number | null>(null);
 * const isSelected = createSelector(() => selectedId.value);
 *
 * // In list - only affected items re-render on selection change
 * For({
 *   each: items,
 *   children: (item) => {
 *     const selected = isSelected(item.id);
 *     return html`
 *       <div
 *         class=${() => selected.value ? 'selected' : ''}
 *         onClick=${() => selectedId.value = item.id}
 *       >
 *         ${item.name}
 *       </div>
 *     `;
 *   }
 * });
 * ```
 *
 * ## Known limitations
 *
 * None.
 */

import { Signal } from './signal';
import { untrack } from './signal/subtle';
import { effect, onCleanup } from './effect';

//=============================================
// Types
//=============================================

/**
 * Comparator function to determine if two values match.
 *
 * @template K - Key type (the value being checked)
 * @template T - Source type (the current selection)
 */
export type SelectorComparator<K, T> = (key: K, source: T) => boolean;

/**
 * Function returned by createSelector that checks if a key is selected.
 * Returns a Signal that tracks the selection state for that key.
 *
 * @template K - Key type
 */
export type Selector<K> = (key: K) => Signal<boolean>;

/**
 * The selection signal of one key and how many readers hold it
 */
class KeySignal extends Signal<boolean> {
  readers = 1;
}

//=============================================
// createSelector
//=============================================

/**
 * Creates an efficient selection tracker that only updates affected items.
 *
 * When the source signal changes, only the previously selected and newly
 * selected items are notified - all other items remain unchanged. This is
 * much more efficient than having every item check the selection state.
 *
 * @template T - The type of the source value (selected item)
 * @template K - The type of keys to check against (defaults to T)
 * @param source - A signal getter returning the current selection
 * @param fn - Optional comparator function (defaults to strict equality)
 * @returns A function that takes a key and returns a signal getter for its selection state
 *
 * @example
 * ```typescript
 * // Basic usage with IDs
 * const selectedId = new Signal<number | null>(null);
 * const isSelected = createSelector(() => selectedId.value);
 *
 * // Check if item 5 is selected
 * const item5Selected = isSelected(5);
 * console.log(item5Selected.value); // false
 *
 * selectedId.value = 5;
 * console.log(item5Selected.value); // true
 * ```
 *
 * @example
 * ```typescript
 * // With custom comparator for object matching
 * const selected = new Signal<User | null>(null);
 * const isSelected = createSelector(
 *   () => selected.value,
 *   (userId: number, user: User | null) => user?.id === userId
 * );
 *
 * const isUser5Selected = isSelected(5);
 * ```
 */
export function createSelector<T, K = T>(
  source: () => T,
  fn?: SelectorComparator<K, T>
): Selector<K> {
  const compare: SelectorComparator<K, T> =
    fn ?? ((a, b) => (a as unknown) === (b as unknown));

  // One signal per key, shared by its readers and released with the last one
  const subs = new Map<K, KeySignal>();

  // Track keys that were previously selected
  let prevKeys = new Set<K>();

  // The source value of the last run, current while the watcher is not queued
  let current: T;

  const setKey = (key: K, value: boolean) => {
    const signal = subs.get(key);
    if (signal) signal.value = value;
  };

  // Create an effect to watch the source and notify affected subscribers
  const watcher = effect(() => {
    const currentValue = source();
    current = currentValue;
    const nextKeys = new Set<K>();

    if (fn) {
      for (const key of subs.keys()) {
        if (fn(key, currentValue)) nextKeys.add(key);
      }
    } else if (subs.has(currentValue as unknown as K)) {
      // Strict equality matches at most the key equal to the value
      nextKeys.add(currentValue as unknown as K);
    }

    for (const key of prevKeys) {
      if (!nextKeys.has(key)) setKey(key, false);
    }
    for (const key of nextKeys) {
      if (!prevKeys.has(key)) setKey(key, true);
    }

    prevKeys = nextKeys;
  });

  // Return the selector function
  return (key: K): Signal<boolean> => {
    let signal = subs.get(key);
    if (signal) {
      signal.readers++;
    } else {
      // Untracked: a consumer must depend on its own key's signal, not on the
      // source, or every consumer re-runs on every selection change
      const initialValue = compare(
        key,
        watcher._queued ? untrack(source) : current
      );
      signal = new KeySignal(initialValue);
      subs.set(key, signal);
      if (initialValue) prevKeys.add(key);
    }

    // The signal leaves the map when its last reader goes, so the map holds
    // it until then. Only a selected key is in prevKeys.
    const owned = signal;
    onCleanup(() => {
      if (--owned.readers === 0) {
        subs.delete(key);
        if (owned.peek()) prevKeys.delete(key);
      }
    });

    return signal;
  };
}
