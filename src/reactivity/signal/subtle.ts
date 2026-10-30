/**
 * Signal.subtle - Advanced Signal APIs
 *
 * This namespace contains advanced APIs intended for framework authors
 * rather than application developers. Named after `crypto.subtle` to
 * indicate these are powerful but require careful usage.
 *
 * Aligned with TC39 Signals proposal `Signal.subtle` namespace.
 *
 * @module reactivity/signal/subtle
 * @internal
 *
 * ## Internal use only
 *
 * This module is for Signy framework internals. End users should import
 * the `untrack` function directly from `signy`:
 *
 * ```typescript
 * // Public API (for end users)
 * import { untrack } from 'signy';
 * const value = untrack(() => someSignal.value);
 * ```
 *
 * The examples below use the internal `subtle` object for
 * illustration of framework internals only.
 *
 * @example Internal usage (framework code only)
 * ```typescript
 * // Internal import (framework internals only)
 * import { subtle } from './signal';
 *
 * // Opt out of dependency tracking
 * subtle.untrack(() => {
 *   return someSignal.value; // Not tracked
 * });
 *
 * // Get the current computed being evaluated
 * const current = subtle.currentComputed();
 * ```
 *
 * ## Known limitations
 *
 * None.
 */

import { getCurrentSubscriber, setCurrentSubscriber } from './links';

//=============================================
// Untrack
//=============================================

/**
 * Runs a function with tracking disabled.
 * Useful for reading signal values without creating dependencies.
 *
 * This is an "escape hatch" that allows reading signals without
 * triggering dependency tracking. Use with caution - computed values
 * that use untrack may not update when expected.
 *
 * Aligned with TC39 Signals proposal `untrack`.
 *
 * @template T - Return type of the function
 * @param fn - Function to run without tracking
 * @returns The result of the function
 *
 * @example Internal usage (framework code only)
 * ```typescript
 * // Internal import (framework internals only)
 * import { State } from './signal/state';
 * import { untrack } from './signal/subtle';
 *
 * const count = new State(0);
 *
 * // This read is NOT tracked
 * const snapshot = untrack(() => count.value);
 *
 * // Or use peek() method directly:
 * const snapshot2 = count.peek();
 * ```
 */
export function untrack<T>(fn: () => T): T {
  const prev = getCurrentSubscriber();
  setCurrentSubscriber(null);
  try {
    return fn();
  } finally {
    setCurrentSubscriber(prev);
  }
}

/**
 * Whether a read here is tracked, so the running effect or computed
 * re-runs when what it reads changes. False outside any, and inside
 * `untrack()`.
 *
 * Lets a library do the work a tracked read needs only when someone tracks,
 * such as listening to an outside source.
 *
 * @returns True inside a running effect or computed
 *
 * @example
 * ```typescript
 * import { isTracking, onCleanup, Signal } from 'signy';
 *
 * const query = matchMedia('(prefers-color-scheme: dark)');
 * const dark = new Signal(query.matches);
 *
 * function isDark(): boolean {
 *   if (!isTracking()) return query.matches;
 *   const update = () => (dark.value = query.matches);
 *   query.addEventListener('change', update);
 *   onCleanup(() => query.removeEventListener('change', update));
 *   return dark.value;
 * }
 * ```
 */
export function isTracking(): boolean {
  return getCurrentSubscriber() !== null;
}

//=============================================
// Current Computed
//=============================================

/**
 * Returns the currently evaluating computed signal, if any.
 *
 * Useful for advanced patterns like conditional dependency tracking
 * or debugging the reactive graph.
 *
 * Aligned with TC39 Signals proposal `Signal.subtle.currentComputed`.
 *
 * @returns The running effect or computed, or null outside any
 *
 * @example
 * ```typescript
 * import { subtle } from './signal';
 *
 * const tracked = subtle.currentComputed() !== null;
 * ```
 */
export function currentComputed(): object | null {
  return getCurrentSubscriber();
}

//=============================================
// Subtle Namespace Object
//=============================================

/**
 * The subtle namespace object containing advanced signal APIs.
 * Aligned with TC39 Signals proposal `Signal.subtle`.
 */
export const subtle = {
  untrack,
  currentComputed,
} as const;
