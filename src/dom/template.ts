/**
 * Template Utilities for High-Performance Element Creation
 *
 * Provides optimized element creation using template cloning.
 * When creating many similar elements, cloning a template is significantly
 * faster than creating elements individually with `createElement()`.
 *
 * @module dom/template
 *
 * @example High-performance list rendering
 * ```typescript
 * import { createTemplate, createMany, createFragment } from 'signy';
 *
 * // Create a template for repeated elements (cached and cloned)
 * const itemTemplate = createTemplate(
 *   '<div class="item"><span class="label"></span><button>Action</button></div>'
 * );
 *
 * // Use template for high-performance rendering
 * const items = data.map((item, i) => {
 *   const el = itemTemplate() as HTMLDivElement;
 *   el.id = `item-${i}`;
 *   (el.firstChild as HTMLSpanElement).textContent = item.label;
 *   return el;
 * });
 *
 * // Batch append using fragment
 * const fragment = createFragment(...items);
 * container.appendChild(fragment);
 * ```
 *
 * @example Bulk creation with createMany
 * ```typescript
 * const rows = createMany(
 *   '<tr><td class="name"></td><td class="age"></td></tr>',
 *   users,
 *   (row, user) => {
 *     const cells = (row as HTMLTableRowElement).cells;
 *     cells[0]!.textContent = user.name;
 *     cells[1]!.textContent = String(user.age);
 *   }
 * );
 * table.append(...rows);
 * ```
 *
 * ## Known limitations
 *
 * None.
 */

import { setBounded } from '../utils/bounded-cache';

//=============================================
// Template Caching
//=============================================

/**
 * Cache for template nodes to enable fast cloning.
 */
const templateNodeCache = new Map<string, Node>();

/**
 * Creates a cached template function from an HTML string.
 *
 * The template is parsed once and cloned on each call, which is significantly
 * faster than creating elements individually for repeated structures.
 *
 * @param html - Static HTML string
 * @returns A function that returns a cloned DOM node
 *
 * @example
 * ```typescript
 * // Create template once (outside loop)
 * const rowTemplate = createTemplate(
 *   '<tr><td class="name"></td><td class="value"></td></tr>'
 * );
 *
 * // Clone and customize for each row (very fast)
 * data.forEach((item) => {
 *   const row = rowTemplate() as HTMLTableRowElement;
 *   (row.cells[0] as HTMLTableCellElement).textContent = item.name;
 *   (row.cells[1] as HTMLTableCellElement).textContent = String(item.value);
 *   table.appendChild(row);
 * });
 * ```
 */
export function createTemplate(html: string): () => Node {
  let cachedNode = templateNodeCache.get(html);

  if (!cachedNode) {
    const tmpl = document.createElement('template');
    tmpl.innerHTML = html;
    // The element, not the whitespace of a multiline template literal
    cachedNode = tmpl.content.firstElementChild ?? tmpl.content.firstChild!;
    setBounded(templateNodeCache, html, cachedNode);
  }

  return () => cachedNode!.cloneNode(true);
}

/**
 * Clears the template cache.
 * Useful for testing or memory management.
 */
export function clearTemplateCache(): void {
  templateNodeCache.clear();
}

/**
 * Gets the current size of the template cache.
 * Useful for debugging and monitoring.
 */
export function getTemplateCacheSize(): number {
  return templateNodeCache.size;
}

//=============================================
// Batch Element Creation
//=============================================

/**
 * Creates multiple elements efficiently using a template and data array.
 *
 * This is the fastest way to create many similar elements.
 * The template is cloned for each item and customized via a callback.
 *
 * @param template - HTML template string or template function
 * @param data - Array of data items
 * @param customize - Callback to customize each cloned element
 * @returns Array of created elements
 *
 * @example
 * ```typescript
 * const rows = createMany(
 *   '<tr><td class="name"></td><td class="age"></td></tr>',
 *   users,
 *   (row, user, index) => {
 *     const cells = (row as HTMLTableRowElement).cells;
 *     cells[0]!.textContent = user.name;
 *     cells[1]!.textContent = String(user.age);
 *   }
 * );
 * table.append(...rows);
 * ```
 */
export function createMany<T, E extends Node = Node>(
  template: string | (() => Node),
  data: T[],
  customize: (element: E, item: T, index: number) => void
): E[] {
  const templateFn =
    typeof template === 'string' ? createTemplate(template) : template;
  const results: E[] = [];

  for (let i = 0; i < data.length; i++) {
    const element = templateFn() as E;
    customize(element, data[i]!, i);
    results.push(element);
  }

  return results;
}

/**
 * Creates a DocumentFragment containing multiple elements.
 *
 * More efficient than appending elements one by one because the fragment
 * is inserted as a single DOM operation.
 *
 * @param elements - Elements to add to the fragment
 * @returns DocumentFragment containing all elements
 *
 * @example
 * ```typescript
 * const items = data.map(item => h('li', null, item.name));
 * const fragment = createFragment(...items);
 * list.appendChild(fragment); // Single DOM operation
 * ```
 */
export function createFragment(...elements: Node[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const el of elements) {
    fragment.appendChild(el);
  }
  return fragment;
}
