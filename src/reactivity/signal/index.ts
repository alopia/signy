/**
 * Signal Module - TC39 Signals Aligned Core
 *
 * This module provides the core signal primitives aligned with the
 * TC39 Signals proposal (Stage 1). It exports a `Signal` namespace
 * that matches the proposed standard API.
 *
 * @module reactivity/signal
 * @internal
 *
 * ## Internal use only
 *
 * This module is for Signy framework internals. End users should import
 * from `signy` or `signy/core` using the public API:
 *
 * ```typescript
 * // Public API (for end users)
 * import { Signal, Computed, signal, computed, untrack } from 'signy';
 *
 * const count = new Signal(0);  // or: signal(0)
 * const double = new Computed(() => count.value * 2);  // or: computed(() => ...)
 * ```
 *
 * ## TC39 Alignment (internal)
 *
 * The internal implementation aligns with TC39 Signals proposal:
 *
 * | TC39 API               | Internal Signy API     | Public Signy API |
 * |------------------------|------------------------|------------------|
 * | `Signal.State`         | `State` (`Signal`)     | `Signal` class   |
 * | `Signal.Computed`      | `Computed`             | `Computed` class |
 * | `untrack`| `subtle.untrack`       | `untrack()`      |
 *
 * @example Internal usage (framework code only)
 * ```typescript
 * // Internal import (framework internals only)
 * import { Signal, Computed, subtle } from './signal';
 *
 * // Create a state signal (TC39 Signal.State)
 * const count = new Signal(0);
 *
 * // Create a computed signal (TC39 Signal.Computed)
 * const double = new Computed(() => count.get() * 2);
 *
 * // Read values
 * console.log(count.get());   // 0
 * console.log(double.get());  // 0
 *
 * // Update state
 * count.set(5);
 * console.log(double.get());  // 10
 *
 * // Or use .value for ergonomic access
 * count.value = 10;
 * console.log(double.value);  // 20
 *
 * // Advanced: untrack to avoid dependency tracking
 * subtle.untrack(() => count.get());
 * ```
 *
 * ## Known limitations
 *
 * None.
 */

//=============================================
// Public API Exports
//=============================================

// Core classes
export { State, isState } from './state';
export type { StateOptions } from './state';
export { Computed } from './computed';
export type { ComputedOptions } from './computed';

// Batch utilities (public) - signy framework feature, not TC39
export { batch, isBatching, flushSync } from '../batch';

// Unified flush (public) - flushes both signal notifications and pending effects
export { flushAll } from './scheduler';

// Subtle namespace (public)
export { subtle, untrack, isTracking, currentComputed } from './subtle';

// Internal code uses Signal as the State class, the same as the public name
export { State as Signal } from './state';
