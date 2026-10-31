/**
 * Insert
 *
 * Inserts rendered content into a parent: nodes, text, component instances,
 * arrays of them, and accessors that return any of these. An accessor gets a
 * render effect that swaps its nodes in place when it changes. Shared by
 * `h()`, `html`, components and the JSX runtime.
 *
 * @module views/insert
 *
 * ## Known limitations
 *
 * None.
 */

import { IS_COMPONENT } from '../context/owner';
import { renderEffect, type Accessor } from '../reactivity/render';

//=============================================
// Types
//=============================================

/**
 * Base insertable types (non-recursive)
 */
type InsertableBase = Node | string | number | boolean | null | undefined;

/**
 * Something that can be inserted into the DOM
 */
export type Insertable =
  | InsertableBase
  | InsertableBase[]
  | Accessor<InsertableBase | InsertableBase[]>;

//=============================================
// Public API
//=============================================

/**
 * Inserts content into a parent element, before `marker` or at the end.
 *
 * When the content is an accessor, a render effect keeps the inserted nodes
 * up to date: text updates in place, other content replaces the previous
 * nodes at the same position. Components rendered by the accessor belong to
 * the effect and are unmounted when it re-runs.
 *
 * @param parent - Parent node to insert into
 * @param value - Content to insert, or an accessor returning it
 * @param marker - Node to insert before. Defaults to the end of the parent
 *
 * @example
 * ```typescript
 * const items = new Signal(['a', 'b', 'c']);
 *
 * insert(container, () => items.value.map(item => {
 *   const li = document.createElement('li');
 *   li.textContent = item;
 *   return li;
 * }));
 * ```
 */
export function insert(
  parent: Node,
  value: unknown,
  marker?: Node | null
): void {
  if (typeof value !== 'function') {
    for (const node of toNodes(value)) {
      parent.insertBefore(node, marker ?? null);
    }
    return;
  }

  let current: Node[] = [];
  renderEffect(() => {
    current = replaceNodes(
      parent,
      current,
      (value as Accessor<unknown>)(),
      marker ?? null
    );
  });
}

/**
 * Turns an array of content, as an `html` template with several roots returns,
 * into a fragment. A function in it becomes a binding owned by the caller.
 *
 * @internal
 */
export function contentFragment(items: readonly unknown[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const add = (item: unknown): void => {
    if (Array.isArray(item)) item.forEach(add);
    else insert(fragment, item);
  };
  items.forEach(add);
  return fragment;
}

//=============================================
// Helpers
//=============================================

/**
 * Converts content to the list of nodes it renders. A fragment gives its
 * children, so they can be tracked after the fragment empties.
 */
function toNodes(value: unknown, out: Node[] = []): Node[] {
  if (value == null || typeof value === 'boolean') return out;
  if (typeof value === 'function') return toNodes(value(), out);
  if (Array.isArray(value)) {
    for (const item of value) toNodes(item, out);
    return out;
  }
  if (value instanceof DocumentFragment) {
    out.push(...value.childNodes);
    return out;
  }
  if (value instanceof Node) {
    out.push(value);
    return out;
  }
  if (typeof value === 'object' && IS_COMPONENT in value) {
    // _renderAsChild handles shadow DOM
    const component = value as unknown as { _renderAsChild(): unknown };
    return toNodes(component._renderAsChild(), out);
  }
  out.push(document.createTextNode(String(value)));
  return out;
}

/**
 * Replaces the nodes of the previous run with the content of this one. An
 * empty result leaves an empty text node, so the next run knows its place.
 */
function replaceNodes(
  initialParent: Node,
  current: Node[],
  value: unknown,
  marker: Node | null
): Node[] {
  // The nodes may have moved, from a fragment into the document
  const first = current[0];
  const parent = first?.parentNode ?? initialParent;

  if (typeof value === 'string' || typeof value === 'number') {
    const str = String(value);
    if (first === undefined) {
      // First run of a text binding, the common case
      const node = document.createTextNode(str);
      parent.insertBefore(node, marker);
      return [node];
    }
    if (current.length === 1 && first instanceof Text) {
      if (first.data !== str) first.data = str;
      return current;
    }
    value = document.createTextNode(str);
  }

  const nodes = toNodes(value);
  if (nodes.length === 0) {
    if (current.length === 1 && first instanceof Text && first.data === '') {
      return current;
    }
    nodes.push(document.createTextNode(''));
  }
  if (sameNodes(current, nodes)) return current;

  const anchor = first && first.parentNode === parent ? first : marker;
  for (const node of nodes) parent.insertBefore(node, anchor);

  if (current.length > 0) {
    const kept = new Set(nodes);
    for (const node of current) {
      if (!kept.has(node) && node.parentNode === parent) {
        parent.removeChild(node);
      }
    }
  }
  return nodes;
}

function sameNodes(a: Node[], b: Node[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
