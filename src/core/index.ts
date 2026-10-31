/**
 * Signy Core - Minimal reactive primitives
 *
 * This is the minimal core of signy, containing only the essential
 * reactive primitives needed to build reactive applications.
 * It has no DOM dependencies and can be used in any JavaScript environment.
 *
 * For DOM-specific utilities, use `signy/web`.
 * For the full framework, use `signy`.
 *
 * @module core
 *
 * @example
 * ```typescript
 * import {
 *   Signal,
 *   Computed,
 *   signal,
 *   computed,
 *   effect,
 *   batch
 * } from 'signy/core';
 *
 * // Class-based
 * const count = new Signal(0);
 * const double = new Computed(() => count.value * 2);
 *
 * // Or factory functions
 * const name = signal('Alice');
 * const upper = computed(() => name.value.toUpperCase());
 *
 * effect(() => {
 *   console.log('Count:', count.value);
 * });
 *
 * batch(() => {
 *   count.value = 1;
 *   count.value = 2;
 * }); // Effect runs once with count = 2
 * ```
 *
 * ## What's in core?
 *
 * - **Signals**: Reactive state primitives (`Signal`, `signal`, `untrack`, `isTracking`)
 * - **Computed**: Cached derived values (`Computed`, `computed`)
 * - **Effects**: Side-effect functions that track dependencies (`effect`, `createRenderEffect`)
 * - **Batching**: Coalesce multiple updates (`batch`, `flushSync`)
 * - **Lifecycle**: Cleanup and mount hooks (`onCleanup`, `onMount`, `on`)
 * - **Owner**: Ownership tracking for automatic cleanup (`createRoot`, `getOwner`)
 *
 * ## What's NOT in core?
 *
 * - DOM utilities (use `signy/web`)
 * - Components (use `signy/web`)
 * - Views/Templates (use `signy/web`)
 * - Router (use `signy/router`)
 * - Store (use `signy/store`)
 * - Application framework (use `signy/app`)
 */

//=============================================
// Signals - Reactive state
//=============================================

export {
  Signal,
  isSignal,
  signal,
  computed,
  untrack,
  isTracking,
} from '../reactivity';

export type { SignalOptions } from '../reactivity';

// Internal APIs (for framework internals only)
import {
  getCurrentSubscriber as _getCurrentSubscriber,
  setCurrentSubscriber as _setCurrentSubscriber,
} from '../reactivity/signal/internal';
export const getCurrentSubscriber = _getCurrentSubscriber;
export const setCurrentSubscriber = _setCurrentSubscriber;

//=============================================
// Computed - Derived/cached values
//=============================================

export { Computed } from '../reactivity';
export type { ComputedOptions } from '../reactivity';

//=============================================
// Effects - Side effects
//=============================================

export {
  Effect,
  EffectMode,
  effect,
  createRoot,
  onCleanup,
  onMount,
  on,
  getOwner,
  runWithOwner,
  type Owner,
  type EffectFunction,
  type EffectOptions,
  type OnOptions,
} from '../reactivity/effect';

//=============================================
// Batching - Update coalescing
//=============================================

export { batch, isBatching, flushSync } from '../reactivity';

// Internal APIs (for framework internals only). The store global build reads
// these off window.Signy, so it shares the scheduler with signy.core.global.js.
import {
  bumpGlobalVersion as _bumpGlobalVersion,
  clearSubscribers as _clearSubscribers,
  getPendingCount as _getPendingCount,
  notifySubscribers as _notifySubscribers,
  registerSource as _registerSource,
  subscribersOf as _subscribersOf,
  trackSource as _trackSource,
  type Subscriber as _Subscriber,
} from '../reactivity/signal/internal';
export const bumpGlobalVersion = _bumpGlobalVersion;
export const clearSubscribers = _clearSubscribers;
export const getPendingCount = _getPendingCount;
export const notifySubscribers = _notifySubscribers;
export const registerSource = _registerSource;
export const subscribersOf = _subscribersOf;
export const trackSource = _trackSource;
export type Subscriber = _Subscriber;

//=============================================
// Render Effects - DOM-aware Effects
//=============================================

export { createRenderEffect, type Accessor } from '../reactivity/render';

//=============================================
// Selector - Optimized Selection
//=============================================

export {
  createSelector,
  type Selector,
  type SelectorComparator,
} from '../reactivity/selector';

//=============================================
// Logging - Error Handling and Diagnostics
//=============================================

export * from '../log';

//=============================================
// Feature Registry - Dev Tools Plugin System
//=============================================

export {
  features,
  devEmit,
  isFeaturesActive,
  type DevFeature,
  type DevEmit,
  type FeatureContext,
  type ComponentLike,
  type SignalLike,
  type EffectLike,
  type ApplicationLike,
  type LifecycleHandlers,
  type ReactivityHandlers,
  type AppHandlers,
} from './features';

export {
  getDevToolsHook,
  initDevToolsHook,
  type DevToolsHook,
  type DevToolsEvents,
} from './devtools-hook';
