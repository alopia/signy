/**
 * Keyed List Reconciliation
 *
 * Provides efficient DOM reconciliation for keyed lists using the ivi algorithm.
 * This algorithm optimizes for common mutations (append, prepend, single insert/remove)
 * while falling back to LIS-based reordering for complex cases.
 *
 * Used by the `For` component, keyed by its `key` function or by item identity.
 *
 * @module views/reconcile
 *
 * @example
 * ```typescript
 * import { For, html, Signal } from 'signy';
 *
 * const items = new Signal([
 *   { id: 1, name: 'Apple' },
 *   { id: 2, name: 'Banana' },
 *   { id: 3, name: 'Cherry' },
 * ]);
 *
 * // With key function - enables efficient reconciliation
 * For({
 *   each: () => items.value,
 *   key: (item) => item.id,
 *   children: (item) => html`<li>${item.name}</li>`
 * });
 *
 * // Reordering only moves DOM nodes, doesn't recreate them
 * items.value = [
 *   { id: 3, name: 'Cherry' },
 *   { id: 1, name: 'Apple' },
 *   { id: 2, name: 'Banana' },
 * ];
 * ```
 *
 * ## Known limitations
 *
 * None.
 */

import type { Signal } from '../reactivity';
import { getOwner, runInRow, type Owner } from '../reactivity/effect';
import { IndexedRow } from '../reactivity/map-array';
import type { Accessor } from '../reactivity/render';
import { Markers } from '../constants';
import { contentFragment } from './insert';

//=============================================
// Types
//=============================================

/**
 * Key of a list item. Any value, compared with SameValueZero like Map keys.
 */
export type ReconcileKey = unknown;

/**
 * Key extraction function
 */
export type KeyFunction<T> = (item: T, index: number) => ReconcileKey;

/**
 * Internal representation of a keyed item with its DOM node and reactive index
 */
export interface KeyedItem<T> {
  /** Unique key for this item */
  readonly key: ReconcileKey;
  /** The data item */
  item: T;
  /** First DOM node of this item. Its nodes are siblings, up to `lastNode` */
  firstNode: Node;
  /** Last DOM node of this item, `firstNode` for a single node */
  lastNode: Node;
  /** Reactive index signal, created on its first read */
  readonly index: Signal<number>;
  /** Moves the item to a new index */
  setIndex(index: number): void;
  /** Disposes the bindings created when the item was rendered */
  dispose(): void;
}

/**
 * Result of reconciliation
 */
export interface ReconcileResult<T> {
  /** Updated keyed items array */
  items: KeyedItem<T>[];
}

//=============================================
// Longest Increasing Subsequence
//=============================================

/**
 * Finds the longest increasing subsequence indices using O(n log n) algorithm.
 * Returns indices into the input array that form the LIS.
 *
 * Used to determine which items don't need to be moved during reordering.
 *
 * @param arr - Array of numbers (positions in previous list, -1 for new items)
 * @returns Indices into arr that form the longest increasing subsequence
 */
export function longestIncreasingSubsequence(arr: number[]): number[] {
  const n = arr.length;
  if (n === 0) return [];

  // tails[i] = smallest ending value for LIS of length i+1
  const tails: number[] = [];
  // indices[i] = index in arr where tails[i] came from
  const indices: number[] = [];
  // prev[i] = previous index in LIS ending at i
  const prev: number[] = new Array<number>(n).fill(-1);

  for (let i = 0; i < n; i++) {
    const val = arr[i]!;
    // Skip new items (marked as -1)
    if (val === -1) continue;

    // Binary search for insertion position
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (tails[mid]! < val) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    // Update or extend
    if (lo === tails.length) {
      tails.push(val);
      indices.push(i);
    } else {
      tails[lo] = val;
      indices[lo] = i;
    }

    // Track predecessor
    if (lo > 0) {
      prev[i] = indices[lo - 1]!;
    }
  }

  // Reconstruct LIS indices
  // Pre-allocate with known size (length of tails = LIS length)
  // Performance: Single allocation instead of dynamic push() + reverse()
  const lisLength = indices.length;
  const result = new Array<number>(lisLength);
  let idx: number | undefined = indices[lisLength - 1];
  let writePos = lisLength - 1;
  while (idx !== undefined && idx !== -1 && writePos >= 0) {
    result[writePos] = idx;
    idx = prev[idx];
    writePos--;
  }

  return result;
}

//=============================================
// ivi-style Reconciliation Algorithm
//=============================================

/**
 * A row of the list. It is its own root, so a row is one object.
 */
class KeyedRow<T> extends IndexedRow implements KeyedItem<T> {
  readonly key: ReconcileKey;
  item: T;
  firstNode!: Node;
  lastNode!: Node;

  constructor(key: ReconcileKey, item: T, index: number) {
    super(index);
    this.key = key;
    this.item = item;
  }
}

/**
 * Creates a new keyed item with reactive index signal.
 *
 * @param item - The data item
 * @param key - Unique key for this item
 * @param index - Initial index value
 * @param render - Render function to create DOM nodes
 * @param owner - Owner of the item's root
 * @returns KeyedItem with DOM nodes and reactive index
 */
function createKeyedItem<T>(
  item: T,
  key: ReconcileKey,
  index: number,
  render: (item: T, index: Accessor<number>) => Node,
  owner: Owner | null
): KeyedItem<T> {
  // Each item gets its own root under the list's owner, so its bindings live
  // until the item is removed, not until the list's effect re-runs
  const row = new KeyedRow(key, item, index);
  // An array becomes a fragment inside the row, so its bindings belong to it
  const nodes: unknown = runInRow(row, owner, () => {
    const content: unknown = render(item, row.readIndex);
    return Array.isArray(content) ? contentFragment(content) : content;
  });
  if (nodes instanceof DocumentFragment) {
    // Control flow inside may insert after its own last node later, so the
    // row ends at a marker of its own and its range keeps those nodes
    const end = document.createComment(Markers.ROW_END);
    row.firstNode = nodes.firstChild ?? end;
    nodes.appendChild(end);
    row.lastNode = end;
  } else {
    // A row always has a node, so the rows around it can anchor to it
    row.firstNode = row.lastNode =
      (nodes as Node | null) ?? document.createTextNode('');
  }
  return row;
}

function removeKeyedItem<T>(keyedItem: KeyedItem<T>): void {
  keyedItem.dispose();
  const { firstNode, lastNode } = keyedItem;
  if (firstNode === lastNode) {
    firstNode.parentNode?.removeChild(firstNode);
    return;
  }
  let node: Node | null = firstNode;
  while (node) {
    const next: Node | null = node === lastNode ? null : node.nextSibling;
    node.parentNode?.removeChild(node);
    node = next;
  }
}

/**
 * Inserts a keyed item's nodes before an anchor.
 *
 * @param parent - Parent node
 * @param keyedItem - Item to insert
 * @param anchor - Node to insert before (null = append)
 */
function insertKeyedItem<T>(
  parent: Node,
  keyedItem: KeyedItem<T>,
  anchor: Node | null
): void {
  const { firstNode, lastNode } = keyedItem;
  if (firstNode === lastNode) {
    parent.insertBefore(firstNode, anchor);
    return;
  }
  // Read the next sibling before the move changes it
  let node: Node | null = firstNode;
  while (node) {
    const next: Node | null = node === lastNode ? null : node.nextSibling;
    parent.insertBefore(node, anchor);
    node = next;
  }
}

/**
 * Reconciles a keyed list using the ivi algorithm.
 *
 * The algorithm has four phases:
 * 1. Skip common prefix (items that haven't changed at the start)
 * 2. Skip common suffix (items that haven't changed at the end)
 * 3. Handle simple cases (pure append, prepend, or removal)
 * 4. Complex reconciliation using LIS for minimal moves
 *
 * @param parent - Parent DOM node containing the list
 * @param prevItems - Previous keyed items
 * @param nextData - New data array
 * @param getKey - Function to extract key from data item
 * @param render - Function to render a data item to DOM
 * @param endMarker - End marker node for insertion reference
 * @param owner - Owner of the item roots (defaults to the current owner)
 * @param clearAll - Empties the parent but keeps `endMarker`, when the list
 *   is all the parent holds. Used when no previous item is kept
 * @returns ReconcileResult with the updated items
 */
export function reconcile<T>(
  parent: Node,
  prevItems: KeyedItem<T>[],
  nextData: T[],
  getKey: KeyFunction<T>,
  render: (item: T, index: Accessor<number>) => Node,
  endMarker: Node,
  owner: Owner | null = getOwner(),
  clearAll?: () => void
): ReconcileResult<T> {
  const prevLength = prevItems.length;
  const nextLength = nextData.length;

  // Fast path: empty lists
  if (nextLength === 0) {
    for (const item of prevItems) {
      removeKeyedItem(item);
    }
    return { items: [] };
  }

  // Pre-allocate array with known size to avoid dynamic resizing
  const items = new Array<KeyedItem<T>>(nextLength);

  if (prevLength === 0) {
    for (let i = 0; i < nextLength; i++) {
      const data = nextData[i] as T;
      const keyedItem = createKeyedItem(
        data,
        getKey(data, i),
        i,
        render,
        owner
      );
      insertKeyedItem(parent, keyedItem, endMarker);
      items[i] = keyedItem;
    }
    return { items };
  }

  const nextKeys = new Array<ReconcileKey>(nextLength);
  for (let i = 0; i < nextLength; i++) {
    nextKeys[i] = getKey(nextData[i] as T, i);
  }

  let prevStart = 0;
  let prevEnd = prevLength - 1;
  let nextStart = 0;
  let nextEnd = nextLength - 1;

  // Phase 1 and 2: skip the common prefix and suffix, and swap the two ends
  // when they traded places, until none applies
  for (;;) {
    while (
      prevStart <= prevEnd &&
      nextStart <= nextEnd &&
      prevItems[prevStart]!.key === nextKeys[nextStart]
    ) {
      keep(prevItems[prevStart++]!, nextData, nextStart++, items);
    }

    while (
      prevStart <= prevEnd &&
      nextStart <= nextEnd &&
      prevItems[prevEnd]!.key === nextKeys[nextEnd]
    ) {
      keep(prevItems[prevEnd--]!, nextData, nextEnd--, items);
    }

    if (
      prevStart < prevEnd &&
      nextStart < nextEnd &&
      prevItems[prevStart]!.key === nextKeys[nextEnd] &&
      prevItems[prevEnd]!.key === nextKeys[nextStart]
    ) {
      const first = prevItems[prevStart]!;
      const last = prevItems[prevEnd]!;
      const afterLast = last.lastNode.nextSibling;
      insertKeyedItem(parent, last, first.firstNode);
      insertKeyedItem(parent, first, afterLast);
      keep(last, nextData, nextStart++, items);
      keep(first, nextData, nextEnd--, items);
      prevStart++;
      prevEnd--;
      continue;
    }
    break;
  }

  // The suffix is placed, so its first node is the anchor of the middle
  const suffixAnchor =
    nextEnd + 1 < nextLength ? items[nextEnd + 1]!.firstNode : endMarker;

  // Phase 3: Simple cases

  // Case 3a: All previous items matched - just insert the new items
  if (prevStart > prevEnd) {
    for (let i = nextStart; i <= nextEnd; i++) {
      const data = nextData[i] as T;
      const keyedItem = createKeyedItem(data, nextKeys[i], i, render, owner);
      insertKeyedItem(parent, keyedItem, suffixAnchor);
      items[i] = keyedItem;
    }
    return { items };
  }

  // Case 3b: All new items matched - just remove remaining old items
  if (nextStart > nextEnd) {
    for (let i = prevStart; i <= prevEnd; i++) removeKeyedItem(prevItems[i]!);
    return { items };
  }

  // Phase 4: Complex reconciliation
  return reconcileMiddle(
    parent,
    prevItems,
    prevStart,
    prevEnd,
    nextData,
    nextKeys,
    nextStart,
    nextEnd,
    items,
    suffixAnchor,
    render,
    owner,
    // Only when the middle is the whole previous list
    prevStart === 0 && prevEnd === prevLength - 1 ? clearAll : undefined
  );
}

/**
 * Gives a reused item its new data and index, at its place in `items`.
 */
function keep<T>(
  keyedItem: KeyedItem<T>,
  nextData: T[],
  index: number,
  items: KeyedItem<T>[]
): void {
  keyedItem.item = nextData[index] as T;
  keyedItem.setIndex(index);
  items[index] = keyedItem;
}

/**
 * Handles the complex middle section reconciliation using LIS. `items`
 * already holds the prefix and the suffix.
 */
function reconcileMiddle<T>(
  parent: Node,
  prevItems: KeyedItem<T>[],
  prevStart: number,
  prevEnd: number,
  nextData: T[],
  nextKeys: ReconcileKey[],
  nextStart: number,
  nextEnd: number,
  items: KeyedItem<T>[],
  suffixAnchor: Node,
  render: (item: T, index: Accessor<number>) => Node,
  owner: Owner | null,
  clearAll: (() => void) | undefined
): ReconcileResult<T> {
  const nextLength = nextEnd - nextStart + 1;

  // Key -> prev index in the middle range. A duplicate key has several,
  // used in order
  const prevKeyToIndex = new Map<ReconcileKey, number | number[]>();
  for (let i = prevStart; i <= prevEnd; i++) {
    const key = prevItems[i]!.key;
    const found = prevKeyToIndex.get(key);
    if (found === undefined) prevKeyToIndex.set(key, i);
    else if (typeof found === 'number') prevKeyToIndex.set(key, [found, i]);
    else found.push(i);
  }

  // sources[i] = prevIndex if item exists, -1 if new
  const sources = new Array<number>(nextLength).fill(-1);
  const used = new Uint8Array(prevEnd - prevStart + 1);

  let moved = false;
  let lastPrevIndex = -1;
  let kept = 0;

  for (let i = nextStart; i <= nextEnd; i++) {
    const found = prevKeyToIndex.get(nextKeys[i]);
    if (found === undefined) continue;

    let prevIndex = -1;
    if (typeof found === 'number') {
      if (used[found - prevStart] === 0) prevIndex = found;
    } else {
      for (const p of found) {
        if (used[p - prevStart] === 0) {
          prevIndex = p;
          break;
        }
      }
    }
    if (prevIndex === -1) continue;

    sources[i - nextStart] = prevIndex;
    used[prevIndex - prevStart] = 1;
    kept++;
    if (prevIndex < lastPrevIndex) moved = true;
    lastPrevIndex = prevIndex;
  }

  // Nothing is kept: dispose every row and empty the parent in one write
  if (kept === 0 && clearAll) {
    for (let i = prevStart; i <= prevEnd; i++) prevItems[i]!.dispose();
    clearAll();
    for (let i = nextStart; i <= nextEnd; i++) {
      const data = nextData[i] as T;
      const keyedItem = createKeyedItem(data, nextKeys[i], i, render, owner);
      insertKeyedItem(parent, keyedItem, suffixAnchor);
      items[i] = keyedItem;
    }
    return { items };
  }

  // Remove prev items not in next list
  for (let i = prevStart; i <= prevEnd; i++) {
    if (used[i - prevStart] === 0) removeKeyedItem(prevItems[i]!);
  }

  // The kept items are in order, so a new item goes before the next kept one
  if (!moved) {
    // Next position holding a kept item, found once for all new items before it
    let nextKept = nextStart;
    for (let i = nextStart; i <= nextEnd; i++) {
      const sourceIdx = sources[i - nextStart]!;

      if (sourceIdx === -1) {
        if (nextKept <= i) {
          nextKept = i + 1;
          while (nextKept <= nextEnd && sources[nextKept - nextStart] === -1) {
            nextKept++;
          }
        }
        const anchor =
          nextKept <= nextEnd
            ? prevItems[sources[nextKept - nextStart]!]!.firstNode
            : suffixAnchor;
        const data = nextData[i] as T;
        const keyedItem = createKeyedItem(data, nextKeys[i], i, render, owner);
        insertKeyedItem(parent, keyedItem, anchor);
        items[i] = keyedItem;
      } else {
        keep(prevItems[sourceIdx]!, nextData, i, items);
      }
    }

    return { items };
  }

  // Use LIS to find items that don't need to move
  const lis = longestIncreasingSubsequence(sources);

  // Process from right to left for correct insertion order
  let lisIdx = lis.length - 1;

  for (let i = nextLength - 1; i >= 0; i--) {
    const sourceIdx = sources[i]!;
    const resultIdx = nextStart + i;

    // Next item's first node, or the suffix anchor for the last one
    const anchor =
      i + 1 < nextLength ? items[resultIdx + 1]!.firstNode : suffixAnchor;

    if (sourceIdx === -1) {
      const data = nextData[resultIdx] as T;
      const key = nextKeys[resultIdx];
      const keyedItem = createKeyedItem(data, key, resultIdx, render, owner);
      insertKeyedItem(parent, keyedItem, anchor);
      items[resultIdx] = keyedItem;
    } else if (lisIdx < 0 || i !== lis[lisIdx]) {
      // Existing item that needs to move
      const keyedItem = prevItems[sourceIdx]!;
      keep(keyedItem, nextData, resultIdx, items);
      insertKeyedItem(parent, keyedItem, anchor);
    } else {
      // Item in LIS - no move needed
      keep(prevItems[sourceIdx]!, nextData, resultIdx, items);
      lisIdx--;
    }
  }

  return { items };
}
