/**
 * Children Utilities
 *
 * Provides utilities for working with component children, including
 * resolving reactive children and tracking their changes.
 *
 * Inspired by Solid.js children helper.
 *
 * @module views/children
 *
 * @example
 * ```typescript
 * import { children, resolveChildren } from 'signy';
 *
 * class List extends Component {
 *   constructor(props: { children: () => Node[] }) {
 *     super();
 *
 *     // Resolve and track children reactively
 *     const resolved = children(() => props.children);
 *
 *     effect(() => {
 *       const nodes = resolved();
 *       console.log('Children count:', nodes.length);
 *     });
 *   }
 * }
 * ```
 *
 * ## Known limitations
 *
 * None.
 */

import { Computed } from '../reactivity';

//=============================================
// Types
//=============================================

/**
 * Valid child types that can be rendered
 */
export type Child =
  Node | string | number | boolean | null | undefined | Child[] | (() => Child);

/**
 * Resolved child (after calling functions and filtering nullish values)
 */
export type ResolvedChild = Node | string | number;

/**
 * Children accessor function
 */
export type ChildrenAccessor = () => ResolvedChild[];

//=============================================
// Children Helpers
//=============================================

/**
 * Resolves a single child value to its concrete form.
 *
 * - Functions are called to get their value
 * - null, undefined, and booleans are filtered out
 * - Arrays are recursively resolved
 *
 * @param child - Child value to resolve
 * @returns Array of resolved children
 *
 * @internal
 */
function resolveChild(child: Child): ResolvedChild[] {
  if (child === null || child === undefined || typeof child === 'boolean') {
    return [];
  }

  if (typeof child === 'function') {
    return resolveChild(child());
  }

  if (Array.isArray(child)) {
    const result: ResolvedChild[] = [];
    for (const c of child) {
      result.push(...resolveChild(c));
    }
    return result;
  }

  // Node, string, or number
  return [child as ResolvedChild];
}

/**
 * Creates a reactive children accessor that resolves and caches children.
 *
 * This is useful when you need to:
 * - Count children
 * - Map over children
 * - Access children multiple times (avoids re-resolving)
 *
 * The result is memoized - children are only resolved again when a signal
 * read while resolving them changes.
 *
 * @param fn - Function that returns children (or the children directly)
 * @returns A reactive accessor that returns resolved children array
 *
 * @example
 * ```typescript
 * class Tabs extends Component {
 *   constructor(props: TabsProps) {
 *     super();
 *
 *     // Create reactive children accessor
 *     const tabs = children(() => props.children);
 *
 *     effect(() => {
 *       const tabNodes = tabs();
 *       console.log(`Rendering ${tabNodes.length} tabs`);
 *     });
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Map over children
 * const items = children(() => props.children);
 *
 * effect(() => {
 *   items().forEach((item, index) => {
 *     if (item instanceof Element) {
 *       item.setAttribute('data-index', String(index));
 *     }
 *   });
 * });
 * ```
 */
export function children(fn: () => Child): ChildrenAccessor {
  // Create a computed that resolves children when fn() changes
  const computed = new Computed(() => resolveChild(fn()));
  return () => computed.get();
}

/**
 * Resolves children immediately (non-reactive).
 *
 * Use this when you don't need reactivity and just want
 * to get the current children once.
 *
 * @param value - Children value to resolve
 * @returns Array of resolved children
 *
 * @example
 * ```typescript
 * const nodes = resolveChildren(props.children);
 * console.log('Got', nodes.length, 'children');
 * ```
 */
export function resolveChildren(value: Child): ResolvedChild[] {
  return resolveChild(value);
}

/**
 * Flattens nested children arrays into a single flat array.
 *
 * @param value - Children value (may contain nested arrays)
 * @returns Flat array of resolved children
 *
 * @example
 * ```typescript
 * const children = [
 *   'text',
 *   [node1, node2],
 *   [[nested]]
 * ];
 *
 * const flat = flattenChildren(children);
 * // ['text', node1, node2, nested]
 * ```
 */
export function flattenChildren(value: Child): ResolvedChild[] {
  return resolveChild(value);
}

/**
 * Counts the number of resolved children.
 *
 * @param value - Children value
 * @returns Number of non-null children
 *
 * @example
 * ```typescript
 * const count = countChildren(props.children);
 * if (count === 0) {
 *   return html`<p>No items</p>`;
 * }
 * ```
 */
export function countChildren(value: Child): number {
  return resolveChild(value).length;
}

/**
 * Checks if children is empty (no renderable content).
 *
 * @param value - Children value
 * @returns True if no children exist
 *
 * @example
 * ```typescript
 * if (isEmptyChildren(props.children)) {
 *   return html`<slot>Default content</slot>`;
 * }
 * ```
 */
export function isEmptyChildren(value: Child): boolean {
  return resolveChild(value).length === 0;
}

/**
 * Gets only Element children (filters out text nodes).
 *
 * @param value - Children value
 * @returns Array of Element children only
 *
 * @example
 * ```typescript
 * const elements = getElementChildren(props.children);
 * elements.forEach(el => el.classList.add('list-item'));
 * ```
 */
export function getElementChildren(value: Child): Element[] {
  return resolveChild(value).filter(
    (child): child is Element => child instanceof Element
  );
}

/**
 * Maps over resolved children with a transform function.
 *
 * @template T - Return type of the map function
 * @param value - Children value
 * @param fn - Map function
 * @returns Array of mapped values
 *
 * @example
 * ```typescript
 * const wrapped = mapChildren(props.children, (child, index) => {
 *   const wrapper = document.createElement('div');
 *   wrapper.className = `item-${index}`;
 *   if (child instanceof Node) {
 *     wrapper.appendChild(child);
 *   } else {
 *     wrapper.textContent = String(child);
 *   }
 *   return wrapper;
 * });
 * ```
 */
export function mapChildren<T>(
  value: Child,
  fn: (child: ResolvedChild, index: number) => T
): T[] {
  return resolveChild(value).map(fn);
}

/**
 * Creates a reactive children accessor that only includes Element nodes.
 *
 * @param fn - Function that returns children
 * @returns Reactive accessor for element children only
 *
 * @example
 * ```typescript
 * const elements = elementChildren(() => props.children);
 *
 * effect(() => {
 *   elements().forEach((el, i) => {
 *     el.style.order = String(i);
 *   });
 * });
 * ```
 */
export function elementChildren(fn: () => Child): () => Element[] {
  const computed = new Computed(() => getElementChildren(fn()));
  return () => computed.get();
}
