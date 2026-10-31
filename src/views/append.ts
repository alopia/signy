/**
 * Appends rendered content to a parent: nodes, text, live text bindings,
 * component instances and arrays of them, at any depth. Shared by h() for
 * element children and by Component for render() results.
 *
 * @module views/append
 */

import { insert } from './insert';

/**
 * Appends each child to the parent. null, undefined and booleans are
 * skipped, a function is bound with insert(), and arrays are flattened.
 *
 * @internal
 */
export function appendChildren(
  parent: Element | DocumentFragment,
  childList: readonly unknown[]
): void {
  for (const child of childList) insert(parent, child);
}
