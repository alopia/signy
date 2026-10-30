/**
 * Transitions
 *
 * Transitions provide a way to mark state updates as non-urgent, allowing
 * the UI to remain responsive during expensive updates. Updates inside a
 * transition are deferred and batched, with a pending state signal to show
 * loading indicators.
 *
 * Provides both class-based and functional APIs for flexibility.
 *
 * Inspired by Solid.js and React 18 concurrent features.
 *
 * @module reactivity/transition
 *
 * @example
 * ```typescript
 * import { Signal, startTransition, useTransition, Transition } from 'signy';
 *
 * const data = new Signal([]);
 *
 * // Simple transition - fire and forget (uses global instance)
 * startTransition(() => {
 *   data.value = expensiveComputation();
 * });
 *
 * // With isolated pending state (each useTransition gets its own)
 * const [isPending, start] = useTransition();
 *
 * start(() => {
 *   data.value = expensiveComputation();
 * }).then(() => {
 *   console.log('Transition complete!');
 * });
 *
 * // Class-based for advanced control
 * const transition = new Transition();
 * await transition.start(() => data.value = newValue);
 * console.log(transition.isPending.value); // false
 * ```
 *
 * ## Known limitations
 *
 * **No interruptible rendering**: Unlike React's concurrent mode, Signy's
 * transitions don't support time-slicing or interruption. They only defer
 * updates until after the next paint and batch them together.
 */

import { Signal, batch, untrack } from './signal';
import { effect, getOwner, onCleanup } from './effect';

// Fallback for hidden tabs, where requestAnimationFrame does not fire
const AFTER_PAINT_TIMEOUT_MS = 100;

/**
 * Runs fn in a task after the browser painted what is pending, so a pending
 * state set before it shows. Without requestAnimationFrame, in the next task.
 */
function afterPaint(fn: () => void): void {
  if (typeof requestAnimationFrame !== 'function') {
    setTimeout(fn, 0);
    return;
  }
  let done = false;
  const run = (): void => {
    if (done) return;
    done = true;
    cancelAnimationFrame(frame);
    clearTimeout(fallback);
    fn();
  };
  const frame = requestAnimationFrame(() => setTimeout(run, 0));
  const fallback = setTimeout(run, AFTER_PAINT_TIMEOUT_MS);
}

//=============================================
// Types
//=============================================

/**
 * Return type of useTransition
 * [isPending accessor, start function that returns Promise]
 */
export type TransitionResult = [
  isPending: Signal<boolean>,
  start: (fn: () => void) => Promise<void>,
];

/**
 * Options for creating a Transition instance
 */
export interface TransitionOptions {
  /**
   * Name for debugging purposes.
   * Shown in DevTools and error messages.
   */
  name?: string;
}

//=============================================
// Transition Class
//=============================================

/** A function queued in a transition, with the promise of its caller */
interface PendingUpdate {
  fn: () => void;
  resolve: () => void;
  reject: (error: unknown) => void;
}

/**
 * A transition controller that manages deferred, batched state updates.
 *
 * Each Transition instance has its own isolated pending state, allowing
 * multiple independent transitions to run concurrently without interfering.
 *
 * @example
 * ```typescript
 * // Create a transition for search results
 * const searchTransition = new Transition({ name: 'search' });
 *
 * // Create a transition for filter updates
 * const filterTransition = new Transition({ name: 'filter' });
 *
 * // Each has its own pending state
 * searchTransition.start(() => (results.value = search(query.peek())));
 * filterTransition.start(() => (filtered.value = filter(items.peek())));
 *
 * console.log(searchTransition.isPending.value); // true
 * console.log(filterTransition.isPending.value); // true
 * ```
 */
export class Transition {
  //-------------------------------------------
  // Static Members
  //-------------------------------------------

  /** Counter for generating unique transition IDs */
  private static idCounter = 0;

  //-------------------------------------------
  // Public Instance Fields
  //-------------------------------------------

  /** Unique identifier for this transition */
  readonly id: number;

  /** Name for debugging purposes */
  readonly name: string;

  //-------------------------------------------
  // Private Instance Fields
  //-------------------------------------------

  /** Signal for pending state */
  private readonly _isPending: Signal<boolean>;

  /** Resolves when the current transition is done, null if none runs */
  private _currentPromise: Promise<void> | null = null;

  /** Resolver for current transition */
  private _resolve: (() => void) | null = null;

  /** Whether the queued functions are running */
  private _running = false;

  /** Functions to run together after the next paint, each with its caller */
  private _pendingFns: PendingUpdate[] = [];

  //-------------------------------------------
  // Constructor
  //-------------------------------------------

  /**
   * Creates a new Transition instance.
   *
   * @param options - Configuration options
   *
   * @example
   * ```typescript
   * const transition = new Transition({ name: 'data-load' });
   * ```
   */
  constructor(options?: TransitionOptions) {
    this.id = ++Transition.idCounter;
    this.name = options?.name ?? `transition-${this.id}`;

    this._isPending = new Signal(false, {
      name: `${this.name}:isPending`,
    });
  }

  //-------------------------------------------
  // Getters
  //-------------------------------------------

  /**
   * Signal for the pending state.
   * Access `.value` to check if a transition is in progress.
   *
   * @example
   * ```typescript
   * const transition = new Transition();
   *
   * effect(() => {
   *   if (transition.isPending.value) {
   *     showSpinner();
   *   } else {
   *     hideSpinner();
   *   }
   * });
   * ```
   */
  get isPending(): Signal<boolean> {
    return this._isPending;
  }

  /**
   * Whether this transition is currently running (has pending work).
   * Returns true from when `start()` is called until the transition completes.
   */
  get isRunning(): boolean {
    return this._currentPromise !== null;
  }

  /**
   * Whether this transition is currently executing its batch.
   * Only true while the queued functions run.
   */
  get isExecuting(): boolean {
    return this._running;
  }

  /**
   * The current transition promise, or null if not running.
   */
  get promise(): Promise<void> | null {
    return this._currentPromise;
  }

  //-------------------------------------------
  // Public Methods
  //-------------------------------------------

  /**
   * Starts a transition to defer and batch state updates.
   *
   * Updates inside a transition are:
   * 1. Deferred until after the next paint, so `isPending` shows first
   * 2. Batched together
   * 3. Tracked with this instance's pending state
   *
   * If called while a transition is already running on this instance,
   * the updates are added to the existing transition.
   *
   * @param fn - Function containing state updates
   * @returns Promise that resolves when the transition completes, or
   *   rejects with the error `fn` threw. The other updates still run.
   *
   * @example
   * ```typescript
   * const transition = new Transition();
   *
   * await transition.start(() => {
   *   items.value = computeExpensiveList();
   * });
   *
   * console.log(transition.isPending.value); // false
   * ```
   */
  start(fn: () => void): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // Added while the queued functions run: it joins their batch now
      if (this._running) {
        try {
          batch(fn);
          resolve();
        } catch (error) {
          reject(error);
        }
        return;
      }

      this._pendingFns.push({ fn, resolve, reject });
      // Already scheduled: runs with the others after the paint
      if (this._currentPromise) return;

      this._currentPromise = new Promise<void>((done) => {
        this._resolve = done;
      });
      this._isPending.value = true;
      afterPaint(() => this._flush());
    });
  }

  /**
   * Runs the queued functions in one batch. Each stands alone: one that throws
   * rejects its own caller, and the others still run.
   */
  private _flush(): void {
    const pending = this._pendingFns;
    this._pendingFns = [];
    const failures = new Map<PendingUpdate, unknown>();
    this._running = true;
    try {
      batch(() => {
        for (const update of pending) {
          try {
            update.fn();
          } catch (error) {
            failures.set(update, error);
          }
        }
      });
    } catch (error) {
      // The batch itself failed while flushing: every caller hears it
      for (const update of pending) {
        if (!failures.has(update)) failures.set(update, error);
      }
    } finally {
      this._running = false;
      this._isPending.value = false;
      const done = this._resolve;
      this._resolve = null;
      this._currentPromise = null;
      done?.();
    }

    for (const update of pending) {
      if (failures.has(update)) update.reject(failures.get(update));
      else update.resolve();
    }
  }

  toTuple(): TransitionResult {
    return [this._isPending, this.start.bind(this)];
  }
}

//=============================================
// Module State (for global startTransition)
//=============================================

/**
 * Default global transition instance.
 * Used by startTransition() for simple fire-and-forget transitions.
 */
const defaultTransition = new Transition({ name: 'global' });

//=============================================
// Functional API
//=============================================

/**
 * Starts a transition using the global instance.
 *
 * This is a convenience function for simple transitions where you
 * don't need isolated pending state. For isolated pending state,
 * use `useTransition()` or create a `Transition` instance.
 *
 * @param fn - Function containing state updates
 * @returns Promise that resolves when the transition completes
 *
 * @example
 * ```typescript
 * import { Signal, startTransition } from 'signy';
 *
 * const items = new Signal([]);
 *
 * // Defer expensive update
 * await startTransition(() => {
 *   items.value = computeExpensiveList();
 * });
 *
 * console.log('Transition complete');
 * ```
 */
export function startTransition(fn: () => void): Promise<void> {
  return defaultTransition.start(fn);
}

/**
 * Creates a new transition with isolated pending state.
 *
 * Each call returns a new Transition instance, so each component
 * or feature can have its own independent pending state.
 *
 * @returns Tuple of [isPending accessor, start function]
 *
 * @example
 * ```typescript
 * import { useTransition, Signal, For, html } from 'signy';
 *
 * const query = new Signal('');
 * const results = new Signal<string[]>([]);
 * const [isPending, start] = useTransition();
 *
 * function search(text: string) {
 *   // Urgent: the input shows it right away
 *   query.value = text;
 *   // Runs after the next paint, so isPending shows first
 *   start(() => (results.value = searchAll(text)));
 * }
 *
 * html`
 *   <input onInput=${(e) => search(e.currentTarget.value)} />
 *   <ul class=${() => (isPending.value ? 'loading' : '')}>
 *     ${For({ each: () => results.value, children: (r) => html`<li>${r}</li>` })}
 *   </ul>
 * `;
 * ```
 */
export function useTransition(): TransitionResult {
  const transition = new Transition();
  return transition.toTuple();
}

/**
 * Creates a named transition with isolated pending state.
 *
 * Factory function shorthand for `new Transition({ name }).toTuple()`.
 * Useful for debugging when you have multiple transitions.
 *
 * @param name - Name for the transition (shown in DevTools)
 * @returns Tuple of [isPending accessor, start function]
 *
 * @example
 * ```typescript
 * const [isSearchPending, startSearch] = transition('search');
 * const [isFilterPending, startFilter] = transition('filter');
 * ```
 */
export function transition(name?: string): TransitionResult {
  const t = new Transition({ name });
  return t.toTuple();
}

/**
 * Checks if the global transition is currently running (has pending work).
 * Returns true from when `startTransition()` is called until completion.
 *
 * @returns True if a global transition is currently running
 *
 * @example
 * ```typescript
 * import { isTransition, startTransition } from 'signy';
 *
 * console.log(isTransition()); // false
 *
 * startTransition(() => {
 *   console.log(isTransition()); // true (during execution)
 * });
 *
 * // Also true right after calling startTransition, before the updates run
 * startTransition(() => (data.value = next));
 * console.log(isTransition()); // true
 * ```
 */
export function isTransition(): boolean {
  return defaultTransition.isRunning;
}

/**
 * Gets the global transition's pending signal.
 *
 * @returns Signal for global pending state
 */
export function getGlobalPending(): Signal<boolean> {
  return defaultTransition.isPending;
}

/**
 * Gets the global transition's done promise, if any.
 * Returns null if no transition is active.
 *
 * @returns The current transition's promise or null
 * @internal
 */
export function getTransitionPromise(): Promise<void> | null {
  return defaultTransition.promise;
}

//=============================================
// Deferred Values
//=============================================

/**
 * Options for createDeferred
 */
export interface DeferredOptions<T> {
  /**
   * Custom equality function to determine if the value has changed.
   * By default, uses Object.is for comparison.
   */
  equals?: (prev: T, next: T) => boolean;

  /**
   * Name for debugging purposes.
   */
  name?: string;

  /**
   * Time in milliseconds to wait before updating.
   * Default: 0, which commits after the next paint like a transition
   */
  timeoutMs?: number;
}

/**
 * Creates a deferred value that updates with low priority.
 *
 * A deferred value is a signal that lags behind another signal,
 * updating only during transitions. This is useful for expensive
 * derived computations that can be slightly stale while the UI
 * remains responsive.
 *
 * Inspired by React 18's useDeferredValue.
 *
 * @template T - Type of the value
 * @param source - Source signal or accessor to defer
 * @param options - Configuration options
 * @returns Accessor for the deferred value
 *
 * @example
 * ```typescript
 * import { Signal, createDeferred } from 'signy';
 *
 * const query = new Signal('');
 *
 * // deferredQuery updates with low priority
 * const deferredQuery = createDeferred(() => query.value);
 *
 * // The input stays immediate
 * html`<input onInput=${(e) => (query.value = e.currentTarget.value)} />`;
 *
 * // Use the deferred value for expensive rendering
 * const results = new Computed(() => {
 *   const q = deferredQuery();
 *   return expensiveSearch(q); // Uses stale value while typing
 * });
 * ```
 *
 * @example
 * ```typescript
 * // With timeout for guaranteed staleness limit
 * const deferredItems = createDeferred(items, { timeoutMs: 200 });
 *
 * // Deferred value will update within 200ms even if main thread is busy
 * ```
 *
 * @example
 * ```typescript
 * // Show stale indicator while deferred value catches up
 * const text = new Signal('');
 * const deferredText = createDeferred(() => text.value);
 *
 * const isStale = new Computed(() => text.value !== deferredText());
 *
 * html`
 *   <div class=${() => (isStale.value ? 'stale' : '')}>
 *     ${() => expensiveRender(deferredText())}
 *   </div>
 * `;
 * ```
 */
export function createDeferred<T>(
  source: () => T,
  options?: DeferredOptions<T>
): () => T {
  const equals = options?.equals ?? Object.is;
  const name = options?.name;
  const timeoutMs = options?.timeoutMs;

  // Untracked, so the caller does not subscribe to the source
  const value = new Signal<T>(untrack(source), {
    equals,
    name: name ? `${name}:deferred` : undefined,
  });

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let latest = value.peek();
  let disposed = false;

  const transition = new Transition({
    name: name ? `${name}:transition` : undefined,
  });

  const commit = (): void => {
    if (!disposed) value.value = latest;
  };

  effect(() => {
    const next = source();
    if (equals(next, latest)) return;
    latest = next;

    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (timeoutMs !== undefined && timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        timeoutId = null;
        commit();
      }, timeoutMs);
    } else {
      void transition.start(commit);
    }
  });

  if (getOwner()) {
    onCleanup(() => {
      disposed = true;
      if (timeoutId !== null) clearTimeout(timeoutId);
      timeoutId = null;
    });
  }

  return (): T => value.value;
}
