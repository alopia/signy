/**
 * Reactive primitives - factory functions
 *
 * Provides convenient factory functions for creating reactive primitives.
 * These are thin wrappers around the Signal, Computed, ReactiveStore, and
 * Resource classes for developers who prefer function-based APIs.
 *
 * @module reactivity/primitives
 *
 * @example
 * ```typescript
 * import { signal, computed, store, resource } from 'signy';
 *
 * // Factory functions
 * const count = signal(0);
 * const double = computed(() => count.value * 2);
 * const state = store({ name: 'Alice' });
 * const users = resource(async () => fetch('/api/users').then(r => r.json()));
 *
 * // Equivalent to class-based:
 * import { Signal, Computed, ReactiveStore, Resource } from 'signy';
 * const count = new Signal(0);
 * const double = new Computed(() => count.value * 2);
 * const storeInstance = new ReactiveStore({ name: 'Alice' });
 * const usersResource = new Resource(async () => fetch('/api/users').then(r => r.json()));
 * ```
 *
 * ## Known limitations
 *
 * None.
 */

import { State, type StateOptions } from './signal/state';
import { Computed, type ComputedOptions } from './signal/computed';
// Lives with ReactiveStore, so the signy/store entry has it too
export { store } from './store';
import {
  Resource,
  type ResourceOptions,
  type Fetcher,
  type SimpleFetcher,
} from './resource';

// Type alias for public API (uses internal StateOptions)
export type SignalOptions<T = unknown> = StateOptions<T>;

//=============================================
// Factory functions
//=============================================

/**
 * Creates a new reactive signal.
 *
 * Factory function shorthand for `new Signal(value, options)`.
 *
 * @template T - Type of the signal value
 * @param value - Initial value of the signal
 * @param options - Optional signal configuration
 * @returns A new Signal instance
 *
 * @example
 * ```typescript
 * import { signal } from 'signy';
 *
 * const count = signal(0);
 * const user = signal({ name: 'Alice' });
 *
 * // With options
 * const score = signal(0, { name: 'score' });
 *
 * // Read and write
 * console.log(count.value); // 0
 * count.value = 5;
 * ```
 */
export function signal<T>(value: T, options?: SignalOptions<T>): State<T> {
  return new State(value, options);
}

/**
 * Creates a new computed value.
 *
 * Factory function shorthand for `new Computed(fn, options)`.
 *
 * @template T - Type of the computed value
 * @param fn - Computation function that derives the value
 * @param options - Optional computed configuration
 * @returns A new Computed instance
 *
 * @example
 * ```typescript
 * import { signal, computed } from 'signy';
 *
 * const count = signal(0);
 * const double = computed(() => count.value * 2);
 * const triple = computed(() => count.value * 3, { name: 'triple' });
 *
 * console.log(double.value); // 0
 * count.value = 5;
 * console.log(double.value); // 10
 * ```
 */
export function computed<T>(
  fn: () => T,
  options?: ComputedOptions<T>
): Computed<T> {
  return new Computed(fn, options);
}

/**
 * Creates a new reactive resource.
 *
 * Factory function shorthand for `new Resource(fetcher, options)`.
 *
 * @template T - Type of the fetched data
 * @param fetcher - Async function to fetch data
 * @param options - Optional resource configuration
 * @returns A new Resource instance
 *
 * @example Without source (fetches once)
 * ```typescript
 * import { resource } from 'signy';
 *
 * const users = resource(async () => {
 *   const response = await fetch('/api/users');
 *   return response.json();
 * });
 *
 * console.log(users.value);   // Data or undefined
 * console.log(users.loading); // true while fetching
 * await users.refetch();      // Manual refetch
 * ```
 *
 * @example With source (refetches on source change)
 * ```typescript
 * import { signal, resource } from 'signy';
 *
 * const userId = signal(1);
 *
 * const user = resource(
 *   () => userId.value,
 *   async (id) => fetch(`/api/users/${id}`).then(r => r.json())
 * );
 *
 * userId.value = 2; // Triggers refetch
 * ```
 */
export function resource<T>(
  fetcher: SimpleFetcher<T>,
  options?: ResourceOptions<T>
): Resource<unknown, T>;

export function resource<S, T>(
  source: (() => S) | false | null | undefined,
  fetcher: Fetcher<S, T>,
  options?: ResourceOptions<T>
): Resource<S, T>;

export function resource<S, T>(
  sourceOrFetcher: (() => S) | false | null | undefined | SimpleFetcher<T>,
  fetcherOrOptions?: Fetcher<S, T> | ResourceOptions<T>,
  maybeOptions?: ResourceOptions<T>
): Resource<S, T> {
  if (
    typeof sourceOrFetcher === 'function' &&
    typeof fetcherOrOptions !== 'function'
  ) {
    // resource(fetcher, options?) - no source
    return new Resource<unknown, T>(
      sourceOrFetcher as SimpleFetcher<T>,
      fetcherOrOptions as ResourceOptions<T>
    ) as Resource<S, T>;
  } else {
    // resource(source, fetcher, options?) - with source
    return new Resource<S, T>(
      sourceOrFetcher as (() => S) | null,
      fetcherOrOptions as Fetcher<S, T>,
      maybeOptions
    );
  }
}
