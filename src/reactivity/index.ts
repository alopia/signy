/**
 * Reactivity module
 *
 * Provides fine-grained reactive primitives for building reactive UIs.
 * This module contains the reactive signal core and signy framework-specific
 * primitives like effects, stores, resources, and transitions.
 *
 * ## Architecture
 *
 * ```
 * reactivity/
 *   ├── signal/      <- Core signal implementation (internal)
 *   │   ├── state       <- Signal class implementation
 *   │   ├── computed    <- Computed class implementation
 *   │   └── subtle      <- Advanced APIs (untrack, isTracking, currentComputed)
 *   │
 *   ├── primitives  <- Factory functions (signal, computed)
 *   ├── effect      <- Ownership-based effects
 *   ├── store       <- Proxy-based reactive stores
 *   ├── resource    <- Async data fetching
 *   ├── transition  <- Concurrent updates
 *   └── ...         <- Other utilities
 * ```
 *
 * @module reactivity
 *
 * @example
 * ```typescript
 * import { Signal, Computed, signal, computed, effect, batch } from 'signy';
 *
 * // Class-based (recommended)
 * const count = new Signal(0);
 * const double = new Computed(() => count.value * 2);
 *
 * // Or factory functions
 * const name = signal('Alice');
 * const upper = computed(() => name.value.toUpperCase());
 *
 * // Effects - signy framework feature
 * effect(() => {
 *   console.log('Count is:', count.value);
 * });
 *
 * // Batch multiple updates
 * batch(() => {
 *   count.value = 1;
 *   count.value = 2;
 * }); // Effect runs once with count = 2
 * ```
 *
 * ## Known limitations
 *
 * None.
 */

//=============================================
// Public API - Reactive Primitives
//=============================================

// Signal class (public name for internal State class)
export { State as Signal, isState as isSignal } from './signal/state';

// Computed class
export { Computed } from './signal/computed';
export type { ComputedOptions } from './signal/computed';

// Factory functions and options type
export {
  signal,
  computed,
  store,
  resource,
  type SignalOptions,
} from './primitives';

// Batch utilities (signy framework feature)
export { batch, isBatching, flushSync } from './batch';

// Unified flush (flushes both signal notifications and pending effects)
export { flushAll } from './signal/scheduler';

// Subtle utilities (advanced use)
export { untrack, isTracking, currentComputed } from './signal/subtle';

//=============================================
// signy Framework Primitives
//=============================================

export {
  ReactiveStore,
  ReactiveMap,
  ReactiveSet,
  unwrap,
  produce,
  replaceWith,
  type StoreSetter,
  type StoreOptions,
} from './store';

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
} from './effect';

export {
  Transition,
  startTransition,
  useTransition,
  transition,
  createDeferred,
  isTransition,
  getTransitionPromise,
  getGlobalPending,
  type TransitionResult,
  type TransitionOptions,
  type DeferredOptions,
} from './transition';

export {
  createRenderEffect,
  createSyncEffect,
  text,
  dynamic,
  type Accessor,
} from './render';

export {
  Resource,
  type ResourceState,
  type ResourceOptions,
  type Fetcher,
  type SimpleFetcher,
  type FetcherInfo,
} from './resource';

export {
  createSelector,
  type Selector,
  type SelectorComparator,
} from './selector';

export {
  mapByItem,
  mapByIndex,
  type MapByItemFn,
  type MapByIndexFn,
  type MapArrayOptions,
} from './map-array';

//=============================================
// Log Messages
//=============================================

export { ReactiveLogMessages } from './log-messages';
