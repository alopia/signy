/**
 * Async Resource Primitive
 *
 * Provides a reactive way to handle async data fetching with automatic
 * loading and error states. Resources track a source signal and
 * automatically refetch when it changes.
 *
 * Provides both class-based and factory function APIs:
 * - `new Resource(fetcher, options)` - Class for full control
 * - `resource(source?, fetcher, options?)` - Factory function
 *
 * Inspired by Solid.js's createResource.
 *
 * @module reactivity/resource
 *
 * @example Class-based API
 * ```typescript
 * import { Resource, Signal } from 'signy';
 *
 * const userId = new Signal(1);
 *
 * // Class-based - full control
 * const userResource = new Resource(
 *   () => userId.value,
 *   async (id) => {
 *     const response = await fetch(`/api/users/${id}`);
 *     return response.json();
 *   }
 * );
 *
 * // Access data reactively
 * console.log(userResource.value);    // User data or undefined
 * console.log(userResource.loading);  // true while fetching
 * console.log(userResource.error);    // Error if fetch failed
 * console.log(userResource.state);    // 'unresolved' | 'pending' | 'ready' | 'errored'
 *
 * // Manual control
 * await userResource.refetch();
 * userResource.mutate(newUser);
 * ```
 *
 * @example Factory function API
 * ```typescript
 * import { resource, Signal } from 'signy';
 *
 * const userId = new Signal(1);
 *
 * // Factory function - returns Resource instance
 * const user = resource(
 *   () => userId.value,
 *   async (id) => {
 *     const response = await fetch(`/api/users/${id}`);
 *     return response.json();
 *   }
 * );
 *
 * console.log(user.value);     // User data or undefined
 * console.log(user.loading);   // true while fetching
 * ```
 *
 * ## Known limitations
 *
 * **No deduplication**: Multiple resources with the same source and fetcher
 * will make duplicate requests. Consider implementing a cache layer for
 * production use.
 */

import { Signal, batch, untrack } from './signal';
import { Effect, EffectMode, getOwner, onCleanup } from './effect';
import {
  getSuspenseBoundary,
  type SuspenseBoundary,
} from './suspense-boundary';

//=============================================
// Types
//=============================================

/**
 * Resource state - tracks the lifecycle of async data
 */
export type ResourceState =
  'unresolved' | 'pending' | 'ready' | 'errored' | 'refreshing';

/**
 * Fetcher function type - takes source value and returns promise
 */
export type Fetcher<S, T> = (source: S, info: FetcherInfo<T>) => Promise<T>;

/**
 * Simple fetcher without source dependency
 */
export type SimpleFetcher<T> = (info: FetcherInfo<T>) => Promise<T>;

/**
 * Information passed to fetcher function
 */
export interface FetcherInfo<T> {
  /** Previous value (if any) */
  value: T | undefined;
  /** Whether this is a refetch */
  refetching: boolean | unknown;
  /** Aborted when a newer fetch starts or the resource is disposed */
  signal: AbortSignal;
}

/**
 * Options for Resource class
 */
export interface ResourceOptions<T> {
  /** Initial value before first fetch */
  initialValue?: T;
  /** Custom name for debugging */
  name?: string;
}

//=============================================
// Resource Class
//=============================================

/**
 * A reactive resource that manages async data fetching with automatic
 * loading and error states.
 *
 * The Resource class provides full control over async data fetching,
 * with reactive state tracking, automatic refetching on source changes,
 * and manual control via `refetch()` and `mutate()`.
 *
 * @template S - Source type (for dependent fetching)
 * @template T - Data type returned by fetcher
 *
 * @example
 * ```typescript
 * const userId = new Signal(1);
 *
 * const user = new Resource(
 *   () => userId.value,
 *   async (id) => fetch(`/api/users/${id}`).then(r => r.json())
 * );
 *
 * // Access data
 * console.log(user.value);   // User data or undefined
 * console.log(user.loading); // true while fetching
 * console.log(user.state);   // 'pending' | 'ready' | 'errored' | ...
 *
 * // Manual control
 * await user.refetch();
 * user.mutate({ name: 'Updated' });
 * ```
 */
export class Resource<S = unknown, T = unknown> {
  //=============================================
  // Private Fields
  //=============================================

  /** Internal signal holding the value */
  private readonly _value: Signal<T | undefined>;

  /** Internal signal for resource state */
  private readonly _state: Signal<ResourceState>;

  /** Internal signal for error */
  private readonly _error: Signal<Error | undefined>;

  /** Source accessor (if provided) */
  private readonly _source: (() => S) | null;

  /** Fetcher function */
  private readonly _fetcher: Fetcher<S, T> | SimpleFetcher<T>;

  /** Current fetch operation ID (for cancellation) */
  private _fetchId = 0;

  /** Aborts the fetch in flight */
  private _controller: AbortController | null = null;

  /** Effect that refetches on source changes */
  private _sourceEffect: Effect | null = null;

  private _disposed = false;

  /** Suspense boundaries the pending first fetch is registered with */
  private _suspense: {
    promise: Promise<void>;
    settle: () => void;
    boundaries: Set<SuspenseBoundary>;
  } | null = null;

  /** Debug name */
  private readonly _name: string | undefined;

  //=============================================
  // Constructor
  //=============================================

  /**
   * Creates a new Resource without a source (fetches once).
   *
   * @param fetcher - Async function to fetch data
   * @param options - Resource options
   */
  constructor(fetcher: SimpleFetcher<T>, options?: ResourceOptions<T>);

  /**
   * Creates a new Resource with a source (refetches on source change).
   *
   * @param source - Accessor returning source value
   * @param fetcher - Async function to fetch data
   * @param options - Resource options
   */
  constructor(
    source: (() => S) | false | null | undefined,
    fetcher: Fetcher<S, T>,
    options?: ResourceOptions<T>
  );

  constructor(
    sourceOrFetcher: (() => S) | false | null | undefined | SimpleFetcher<T>,
    fetcherOrOptions?: Fetcher<S, T> | ResourceOptions<T>,
    maybeOptions?: ResourceOptions<T>
  ) {
    // Parse overloaded arguments
    let source: (() => S) | null = null;
    let fetcher: Fetcher<S, T> | SimpleFetcher<T>;
    let options: ResourceOptions<T>;

    if (
      typeof sourceOrFetcher === 'function' &&
      typeof fetcherOrOptions !== 'function'
    ) {
      // new Resource(fetcher, options?) - no source
      fetcher = sourceOrFetcher as SimpleFetcher<T>;
      options = (fetcherOrOptions as ResourceOptions<T>) || {};
    } else {
      // new Resource(source, fetcher, options?) - with source
      source = sourceOrFetcher as (() => S) | null;
      fetcher = fetcherOrOptions as Fetcher<S, T>;
      options = maybeOptions || {};
    }

    this._source = source;
    this._fetcher = fetcher;
    this._name = options.name;

    // Initialize signals
    this._value = new Signal<T | undefined>(options.initialValue, {
      name: this._name ? `${this._name}:value` : undefined,
    });
    this._state = new Signal<ResourceState>('unresolved', {
      name: this._name ? `${this._name}:state` : undefined,
    });
    this._error = new Signal<Error | undefined>(undefined, {
      name: this._name ? `${this._name}:error` : undefined,
    });

    if (getOwner()) onCleanup(() => this.dispose());

    // Set up automatic fetching
    if (source) {
      // Runs right away, so the first fetch is pending in the first render
      this._sourceEffect = new Effect(
        () => {
          const sourceValue = source!();

          // A falsy source fetches nothing, and drops a fetch for the old one
          if (
            sourceValue === false ||
            sourceValue === null ||
            sourceValue === undefined
          ) {
            untrack(() => this._cancel());
            return;
          }

          // Untracked, so what the fetcher reads does not refetch
          untrack(() => void this._load(undefined, sourceValue));
        },
        undefined,
        { mode: EffectMode.RENDER }
      );
    } else {
      // No source - fetch immediately
      untrack(() => void this._load());
    }
  }

  //=============================================
  // Getters
  //=============================================

  /**
   * The last resolved value, or undefined before the first one. It stays
   * during a refetch and after a failed one, and changes when a fetch
   * resolves or on mutate(). Tracks as a dependency in reactive contexts.
   */
  get value(): T | undefined {
    if (this._state.peek() === 'pending') this._suspend();
    return this._value.value;
  }

  /**
   * Current resource state.
   * One of: 'unresolved' | 'pending' | 'ready' | 'errored' | 'refreshing'
   */
  get state(): ResourceState {
    return this._state.value;
  }

  /**
   * Whether the resource is currently loading (initial or refresh).
   */
  get loading(): boolean {
    const s = this._state.value;
    return s === 'pending' || s === 'refreshing';
  }

  /**
   * The error if the fetch failed, or undefined.
   */
  get error(): Error | undefined {
    return this._error.value;
  }

  /**
   * Debug name for this resource.
   */
  get name(): string | undefined {
    return this._name;
  }

  /**
   * Whether this resource has been disposed.
   */
  get disposed(): boolean {
    return this._disposed;
  }

  //=============================================
  // Public Methods
  //=============================================

  /**
   * Manually trigger a refetch.
   *
   * @param info - Optional info passed to fetcher
   * @returns Promise resolving to fetched value or undefined
   *
   * @example
   * ```typescript
   * const resource = new Resource(fetchData);
   *
   * // Trigger refetch
   * const data = await resource.refetch();
   *
   * // Pass custom info to fetcher
   * await resource.refetch({ force: true });
   * ```
   */
  refetch(info?: unknown): Promise<T | undefined> {
    return untrack(() => this._load(info));
  }

  /**
   * Manually set the resource value (optimistic update).
   *
   * @param valueOrFn - New value or updater function
   * @returns The new value
   *
   * @example
   * ```typescript
   * const resource = new Resource(fetchUser);
   *
   * // Optimistic update
   * resource.mutate({ ...resource.value, name: 'Updated' });
   *
   * // Functional update
   * resource.mutate(prev => ({ ...prev, count: (prev?.count ?? 0) + 1 }));
   * ```
   */
  mutate(valueOrFn: T | ((prev: T | undefined) => T)): T {
    const newValue =
      typeof valueOrFn === 'function'
        ? (valueOrFn as (prev: T | undefined) => T)(this._value.peek())
        : valueOrFn;

    batch(() => {
      this._value.value = newValue;
      this._state.value = 'ready';
      this._error.value = undefined;
    });
    this._settleSuspense();

    return newValue;
  }

  /**
   * Stops refetching on source changes and aborts the fetch in flight. A
   * fetch that resolves later is ignored.
   */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._sourceEffect?.dispose();
    this._sourceEffect = null;
    this._cancel();
  }

  //=============================================
  // Private Methods
  //=============================================

  /**
   * Drops the fetch in flight. It will not report back, so nothing is loading
   * any more: a first fetch ends unresolved, a refresh keeps its value.
   */
  private _cancel(): void {
    this._fetchId++;
    this._controller?.abort();
    this._controller = null;
    const state = this._state.peek();
    if (state === 'pending') this._state.value = 'unresolved';
    else if (state === 'refreshing') this._state.value = 'ready';
    this._settleSuspense();
  }

  /**
   * Registers the pending first fetch with the Suspense boundary of the
   * current owner, once per boundary.
   */
  private _suspend(): void {
    const boundary = getSuspenseBoundary();
    if (!boundary) return;
    if (!this._suspense) {
      let settle!: () => void;
      const promise = new Promise<void>((resolve) => (settle = resolve));
      this._suspense = { promise, settle, boundaries: new Set() };
    }
    const { promise, boundaries } = this._suspense;
    if (boundaries.has(boundary)) return;
    boundaries.add(boundary);
    boundary.register(promise);
  }

  /** Releases the boundaries once the first fetch is no longer pending. */
  private _settleSuspense(): void {
    const suspense = this._suspense;
    if (!suspense) return;
    this._suspense = null;
    suspense.settle();
    for (const boundary of suspense.boundaries) {
      boundary.unregister(suspense.promise);
    }
  }

  /**
   * Perform the fetch operation.
   */
  private async _load(
    refetchInfo?: unknown,
    sourceValue: S = this._source ? this._source() : (undefined as S)
  ): Promise<T | undefined> {
    if (this._disposed) return undefined;

    // Don't fetch if source is falsy (when source is provided)
    if (
      this._source &&
      (sourceValue === false ||
        sourceValue === null ||
        sourceValue === undefined)
    ) {
      return undefined;
    }

    // Increment fetch ID to track this operation
    const currentFetchId = ++this._fetchId;
    this._controller?.abort();
    const controller = new AbortController();
    this._controller = controller;

    // Set loading state
    // peek() so the source effect does not subscribe to its own state
    const current = this._state.peek();
    const isRefresh = current !== 'unresolved' && current !== 'pending';
    this._state.value = isRefresh ? 'refreshing' : 'pending';

    try {
      // Call fetcher with source value and info
      const info: FetcherInfo<T> = {
        value: this._value.peek(),
        refetching: refetchInfo !== undefined ? refetchInfo : isRefresh,
        signal: controller.signal,
      };

      const result = this._source
        ? await (this._fetcher as Fetcher<S, T>)(sourceValue, info)
        : await (this._fetcher as SimpleFetcher<T>)(info);

      // Check if this fetch is still current (not superseded)
      if (currentFetchId !== this._fetchId) {
        return undefined;
      }
      this._controller = null;

      // Update state
      batch(() => {
        this._value.value = result;
        this._state.value = 'ready';
        this._error.value = undefined;
      });
      this._settleSuspense();

      return result;
    } catch (err) {
      // Check if this fetch is still current
      if (currentFetchId !== this._fetchId) {
        return undefined;
      }
      this._controller = null;

      // Update error state
      batch(() => {
        this._state.value = 'errored';
        this._error.value = err instanceof Error ? err : new Error(String(err));
      });
      this._settleSuspense();

      return undefined;
    }
  }
}
