/**
 * Reactive Rendering Primitives
 *
 * Provides utilities for creating reactive DOM that automatically updates
 * when reactive dependencies change. These primitives form the foundation
 * of Signy's fine-grained reactivity system.
 *
 * Inspired by Solid.js's reactive rendering approach.
 *
 * @module reactivity/render
 *
 * @example
 * ```typescript
 * import { Signal, text } from 'signy';
 *
 * const count = new Signal(0);
 *
 * // Create a reactive text node
 * container.appendChild(text(() => `Count: ${count.value}`));
 * ```
 *
 * `insert()` lives in `views/insert`, `spread()` and the attribute bindings
 * in `views/attributes`.
 *
 * ## Known limitations
 *
 * None.
 */

import { Effect, EffectMode } from './effect';

//=============================================
// Types
//=============================================

/**
 * A reactive accessor function - returns a value and tracks dependencies
 */
export type Accessor<T> = () => T;

//=============================================
// Render Effect
//=============================================

const RENDER_OPTIONS = { mode: EffectMode.RENDER } as const;

/**
 * Creates a render effect specifically for DOM updates.
 *
 * Unlike regular effects, render effects:
 * - Run synchronously on first execution (not as microtask)
 * - Re-run through the DOM task queue when dependencies change (for batching)
 * - Belong to the current owner and are disposed with it
 * - Are designed for DOM manipulation
 *
 * Compiled JSX uses it as its effect wrapper, passing the previous return
 * value back in.
 *
 * @template T - Return type of the effect
 * @param fn - Effect function that performs DOM updates. Receives the value
 *   it returned on the previous run
 * @param value - Value passed to the first run
 * @returns Cleanup function to dispose the effect
 *
 * @example
 * ```typescript
 * const show = new Signal(true);
 *
 * createRenderEffect(() => {
 *   if (show.value) {
 *     container.textContent = 'Visible';
 *   } else {
 *     container.textContent = 'Hidden';
 *   }
 * });
 * ```
 */
export function createRenderEffect<T>(
  fn: (prev: T | undefined) => T,
  value?: T
): () => void {
  const e = new Effect(fn, value, RENDER_OPTIONS);
  return () => e.dispose();
}

/**
 * createRenderEffect() without the dispose function, for bindings that live
 * as long as their owner. A row creates two or three of these.
 *
 * @internal
 */
export function renderEffect<T>(
  fn: (prev: T | undefined) => T,
  value?: T
): void {
  new Effect(fn, value, RENDER_OPTIONS);
}

/**
 * Creates a synchronous render effect that runs immediately on every update.
 *
 * Unlike `createRenderEffect`, this effect:
 * - Runs synchronously on first execution
 * - Re-runs synchronously when dependencies change (no microtask batching)
 * - Is designed for cases requiring immediate updates
 *
 * WARNING: Synchronous effects can cause performance issues in production if
 * dependencies change rapidly. Use `createRenderEffect` for normal DOM updates.
 *
 * @template T - Return type of the effect
 * @param fn - Effect function that performs DOM updates
 * @returns Cleanup function to dispose the effect
 *
 * @example
 * ```typescript
 * const count = new Signal(0);
 *
 * createSyncEffect(() => {
 *   container.textContent = `Count: ${count.value}`;
 * });
 *
 * count.value = 1; // DOM updates immediately, synchronously
 * console.log(container.textContent); // "Count: 1" - already updated!
 * ```
 */
export function createSyncEffect<T>(fn: () => T): () => void {
  const e = new Effect(fn, undefined, { mode: EffectMode.SYNC });
  return () => e.dispose();
}

//=============================================
// Reactive Text
//=============================================

/**
 * Creates a reactive text node that updates when dependencies change.
 *
 * @param accessor - Function that returns the text content
 * @returns A Text node that updates reactively
 *
 * @example
 * ```typescript
 * const name = new Signal('World');
 *
 * const greeting = text(() => `Hello, ${name.value}!`);
 * container.appendChild(greeting);
 *
 * name.value = 'Signy'; // Text automatically updates to "Hello, Signy!"
 * ```
 */
export function text(
  accessor: Accessor<string | number | boolean | null | undefined>
): Text {
  const node = document.createTextNode('');

  renderEffect(() => {
    const value = accessor();
    const str = value == null ? '' : String(value);
    // Skip DOM write if value unchanged (avoids layout/reflow)
    if (node.textContent !== str) {
      node.textContent = str;
    }
  });

  return node;
}

//=============================================
// Dynamic Value
//=============================================

/**
 * Creates a reactive computation for use in templates.
 * Returns a function that when called, tracks dependencies.
 *
 * @template T - Type of the computed value
 * @param accessor - Function that computes the value
 * @returns An accessor function
 *
 * @example
 * ```typescript
 * const a = new Signal(1);
 * const b = new Signal(2);
 *
 * const sum = dynamic(() => a.value + b.value);
 * console.log(sum()); // 3
 * ```
 */
export function dynamic<T>(accessor: Accessor<T>): Accessor<T> {
  return accessor;
}
