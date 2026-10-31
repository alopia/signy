/**
 * Reactive Effects
 *
 * Effects are side-effect functions that automatically track their reactive
 * dependencies and re-run when those dependencies change. Unlike computeds,
 * effects are push-based and run eagerly.
 *
 * Inspired by Solid.js with ownership-based automatic disposal.
 *
 * @module reactivity/effect
 *
 * @example
 * ```typescript
 * import { Signal, effect, onCleanup } from 'signy';
 *
 * const count = new Signal(0);
 *
 * effect(() => {
 *   console.log('Count is:', count.value);
 *
 *   // Cleanup runs before re-execution and on disposal
 *   onCleanup(() => {
 *     console.log('Cleaning up previous effect');
 *   });
 * });
 *
 * count.value = 1; // Logs cleanup, then new count
 * ```
 *
 * ## Async Effects
 *
 * Effects don't have special async handling. For async operations,
 * use `onCleanup` to handle cancellation:
 *
 * ```typescript
 * effect(() => {
 *   const id = userId.value;
 *   const controller = new AbortController();
 *
 *   fetch(`/api/user/${id}`, { signal: controller.signal })
 *     .then(r => r.json())
 *     .then(setUser);
 *
 *   onCleanup(() => controller.abort());
 * });
 * ```
 *
 * ## Known limitations
 *
 * None.
 */

import {
  setCurrentSubscriber,
  startTracking,
  endTracking,
  dropSources,
  unlinkSources,
  scheduleEffect,
  scheduleTask,
  registerEffectFlush,
  getPendingEffects,
  clearPendingEffects,
  enterBatch,
  exitBatch,
  isFlushingEffectsNow,
  setFlushingEffects,
  registerRunner,
  onResetForTests,
  getDerivedReads,
  hasSourcesChanged,
  type Link,
  type Runnable,
  type Tracker,
  type SubscriberTarget,
} from './signal/internal';
import { logger } from '../log';
import { ReactiveLogMessages } from './log-messages';
import { features, isFeaturesActive } from '../core/features';

//=============================================
// Types
//=============================================

/**
 * Owner node in the reactive ownership tree.
 * Tracks owned computations and cleanup functions.
 */
export interface Owner {
  /** Parent owner in the tree */
  owner: Owner | null;
  /** First and last owned child. Children form a doubly linked list */
  ownedHead: Owner | null;
  ownedTail: Owner | null;
  /** Neighbors in the parent's list, so leaving it is O(1) */
  ownedNext: Owner | null;
  ownedPrev: Owner | null;
  /** Cleanup functions to run on disposal */
  cleanups: (() => void)[] | null;
  /** Values set by runWithContext(), inherited by owned children */
  context: Record<symbol, unknown> | null;
  /** Own disposal, run instead of the default when the parent is disposed */
  [OWNER_DISPOSE]?(): void;
}

/**
 * Effect function type - receives previous value, returns next value
 */
export type EffectFunction<Prev, Next extends Prev = Prev> = (v: Prev) => Next;

/**
 * Options for creating an effect
 */
export interface EffectOptions {
  /**
   * Name for debugging purposes.
   * Shown in DevTools and error messages.
   */
  name?: string;
  /**
   * When the effect runs. Defaults to `EffectMode.USER`.
   */
  mode?: EffectMode;
}

/**
 * Options for the `on` helper
 */
export interface OnOptions {
  /**
   * If true, skip the initial run and only run on subsequent changes.
   * @default false
   */
  defer?: boolean;
}

//=============================================
// Module State
//=============================================

/**
 * Sentinel value for unowned computations.
 * Effects created outside any root will never be disposed.
 */
const UNOWNED: Owner = {
  owner: null,
  ownedHead: null,
  ownedTail: null,
  ownedNext: null,
  ownedPrev: null,
  cleanups: null,
  context: null,
};

/**
 * Current owner context.
 * New effects/computations are attached to this owner.
 */
let CurrentOwner: Owner | null = null;

/**
 * Maximum number of flush iterations before the flush gives up on a cycle and
 * logs an error. This happens when effects re-trigger themselves in a cycle.
 */
const MAX_FLUSH_ITERATIONS = 100;

//=============================================
// Effect Flush Registration
//=============================================

/**
 * Register the effect flush callback with the scheduler.
 * This allows `flushAll()` to flush both signal notifications and pending effects.
 */
registerEffectFlush(flushEffects);
onResetForTests(() => {
  CurrentOwner = null;
  dropPendingEffects();
});

/**
 * Clears the effect queue without running it. The effects in it can be
 * queued again.
 */
function dropPendingEffects(): void {
  for (const effect of getPendingEffects() ?? []) {
    if (effect instanceof Effect) effect._queued = false;
  }
  clearPendingEffects();
}

//=============================================
// Effect Class
//=============================================

/**
 * When an effect runs.
 *
 * - `USER`: first run and re-runs deferred to the effect queue, so a user
 *   effect runs after mount. Created by `effect()`.
 * - `RENDER`: first run synchronous, so templates return finished DOM.
 *   Re-runs go through the DOM task queue. Created by `createRenderEffect()`.
 * - `SYNC`: every run synchronous. Created by `createSyncEffect()`.
 */
export const EffectMode = {
  USER: 0,
  RENDER: 1,
  SYNC: 2,
} as const;

export type EffectMode = (typeof EffectMode)[keyof typeof EffectMode];

/**
 * Method an owner can define to run its own disposal when its parent is
 * disposed. Components use it to unmount.
 *
 * @internal
 */
export const OWNER_DISPOSE: unique symbol = Symbol('signy.ownerDispose');

/**
 * Context key of the error handler set by catchError(). An effect that throws
 * hands its error to the nearest one.
 *
 * @internal
 */
const ERROR_HANDLER: unique symbol = Symbol('signy.errorHandler');

/**
 * A reactive computation that tracks the signals it reads and re-runs when
 * they change. Every effect, whatever its mode, belongs to the owner that was
 * current when it was created, and before each re-run disposes what it
 * created on the previous run. One class for every mode keeps a single
 * object shape on the hot paths.
 *
 * @template T - Type of the effect's return value
 *
 * @example
 * ```typescript
 * const count = new Signal(0);
 *
 * const effect = new Effect(() => {
 *   console.log('Count is:', count.value);
 * });
 *
 * // Later: manually dispose
 * effect.dispose();
 * ```
 */
export class Effect<T = void> implements Owner, Runnable, Tracker {
  //=============================================
  // Public Fields (Owner interface)
  //=============================================

  owner: Owner | null = null;
  ownedHead: Owner | null = null;
  ownedTail: Owner | null = null;
  ownedNext: Owner | null = null;
  ownedPrev: Owner | null = null;
  cleanups: (() => void)[] | null = null;
  context: Record<symbol, unknown> | null;

  //=============================================
  // Private Fields
  //=============================================

  private readonly _fn: EffectFunction<T | undefined, T>;

  private _value: T | undefined;

  private readonly _name: string | undefined;

  private readonly _mode: EffectMode;

  private _disposed = false;

  /**
   * Whether the last run read a computed. Only then can a notification come
   * with nothing changed, so only then is it worth checking the versions.
   */
  private _checkVersions = false;

  /** Set while the effect runs, when dispose() must leave the links to the run */
  private _running = false;

  /**
   * A re-run is already queued, so more notifications before it skip the
   * queue. Reset wherever the queue is dropped without running it.
   *
   * @internal
   */
  _queued = false;

  /**
   * Subscriber flags. The effect is its own subscriber, so it needs no
   * closure. A user or render effect only queues on notify, which is safe
   * inside a batch. A sync effect runs, so it waits for the batch to end.
   *
   * @internal
   */
  readonly eager: boolean;

  /** @internal Set to the effect itself while tests track, for checkInvariants() */
  target: SubscriberTarget | undefined = undefined;

  /** @internal See Tracker */
  _sourcesHead: Link | null = null;
  /** @internal */
  _sourcesTail: Link | null = null;
  /** @internal False once disposed, so a read during the run links nothing */
  _linked = true;

  //=============================================
  // Constructor
  //=============================================

  constructor(
    fn: EffectFunction<T | undefined, T>,
    value?: T,
    options?: EffectOptions
  ) {
    this._fn = fn;
    this._value = value;
    this._name = options?.name;
    this._mode = options?.mode ?? EffectMode.USER;
    this.eager = this._mode !== EffectMode.SYNC;
    if (registerRunner(this)) this.target = this;

    this.context = CurrentOwner?.context ?? null;
    // Only user effects warn. A render effect outside any owner is a template
    // built outside a component (a script, a test, a static snippet), which is
    // fine: it lives as long as its nodes.
    if (__DEV__ && CurrentOwner === null && this._mode === EffectMode.USER) {
      logger.warn(ReactiveLogMessages.EFFECT_UNOWNED);
    }
    adoptOwner(this);

    if (isFeaturesActive()) {
      features.emit.effectCreate(this);
    }

    if (this._mode === EffectMode.USER) {
      this._queued = true;
      scheduleEffect(this as Effect<unknown>);
    } else {
      this.run();
    }
  }

  //=============================================
  // Getters
  //=============================================

  get disposed(): boolean {
    return this._disposed;
  }

  get value(): T | undefined {
    return this._value;
  }

  get name(): string | undefined {
    return this._name;
  }

  get mode(): EffectMode {
    return this._mode;
  }

  //=============================================
  // Public Methods
  //=============================================

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    if (isFeaturesActive()) {
      features.emit.effectDispose(this);
    }

    detachOwner(this);
    this._linked = false;
    if (this._running) unlinkSources(this);
    else dropSources(this);
    this._checkVersions = false;

    runCleanups(this);
    disposeOwned(this);
  }

  run(): void {
    this._queued = false;
    if (this._disposed) return;
    // Only computeds notified, and each came out equal: nothing changed
    if (this._unchanged()) return;

    if (isFeaturesActive()) {
      features.emit.effectRun(this);
    }

    // Release the previous run before starting the next
    runCleanups(this);
    disposeOwned(this);

    const derivedBefore = getDerivedReads();
    const prevOwner = CurrentOwner;
    const prevSubscriber = startTracking(this);
    CurrentOwner = this;
    this._running = true;

    let failed = false;
    let error: unknown;
    try {
      this._value = this._fn(this._value);
    } catch (e) {
      failed = true;
      error = e;
    } finally {
      CurrentOwner = prevOwner;
      this._running = false;
      endTracking(this, prevSubscriber);
      this._checkVersions = getDerivedReads() !== derivedBefore;
      // Disposed by its own run: the links it made after dispose() go too
      if (this._disposed) dropSources(this);
    }
    if (this._disposed) {
      // Registered after the dispose, so nothing else would run them
      runCleanups(this);
      disposeOwned(this);
    }
    if (failed) handleError(this, error);
  }

  /**
   * Called by the sources the effect read when they change.
   *
   * @internal
   */
  notify(): void {
    if (this._disposed) return;
    if (this._mode === EffectMode.SYNC) {
      this.run();
      return;
    }
    if (this._queued) return;
    this._queued = true;
    if (this._mode === EffectMode.USER) {
      scheduleEffect(this as Effect<unknown>);
    } else {
      scheduleTask(this);
    }
  }

  //=============================================
  // Private Methods
  //=============================================

  private _unchanged(): boolean {
    return this._checkVersions && !hasSourcesChanged(this);
  }
}

//=============================================
// Helper Functions
//=============================================

/**
 * Attaches an owner to the current owner, so it is disposed with it.
 *
 * @internal
 */
export function adoptOwner(child: Owner): void {
  const parent = CurrentOwner;
  child.owner = parent;
  // Components are created without one, so error handlers reach inside them
  if (child.context === null && parent) child.context = parent.context;
  if (parent && parent !== UNOWNED) {
    const tail = parent.ownedTail;
    child.ownedPrev = tail;
    if (tail) tail.ownedNext = child;
    else parent.ownedHead = child;
    parent.ownedTail = child;
  }
}

/**
 * Removes an owner from its parent's owned list.
 *
 * @internal
 */
export function detachOwner(child: Owner): void {
  const parent = child.owner;
  if (parent && parent !== UNOWNED) {
    const { ownedPrev: prev, ownedNext: next } = child;
    if (prev) prev.ownedNext = next;
    else parent.ownedHead = next;
    if (next) next.ownedPrev = prev;
    else parent.ownedTail = prev;
  }
  child.owner = null;
  child.ownedNext = null;
  child.ownedPrev = null;
}

/**
 * Hands an error to the nearest error handler above `owner`, or rethrows it.
 */
function handleError(owner: Owner, error: unknown): void {
  const handler = owner.context?.[ERROR_HANDLER] as
    ((error: unknown) => void) | undefined;
  if (!handler) throw error;
  handler(error);
}

function runCleanups(owner: Owner): void {
  const cleanups = owner.cleanups;
  if (!cleanups) return;
  owner.cleanups = null;
  for (let i = cleanups.length - 1; i >= 0; i--) {
    const cleanup = cleanups[i];
    if (cleanup) {
      try {
        cleanup();
      } catch (error) {
        // Log error but continue running other cleanups
        logger.error(ReactiveLogMessages.CLEANUP_ERROR, { error });
      }
    }
  }
}

/**
 * Disposes a plain owner (a root) and everything it owns.
 *
 * @internal
 */
export function disposeOwner(owner: Owner): void {
  detachOwner(owner);
  runCleanups(owner);
  disposeOwned(owner);
}

/**
 * Disposes what an owner owns, without running its own cleanups.
 *
 * @internal
 */
export function disposeOwned(owner: Owner): void {
  let child = owner.ownedHead;
  if (!child) return;
  // Detached as a whole first, so each child skips unlinking itself
  owner.ownedHead = null;
  owner.ownedTail = null;
  while (child) {
    const next: Owner | null = child.ownedNext;
    child.owner = null;
    child.ownedNext = null;
    child.ownedPrev = null;
    if (child instanceof Effect) {
      child.dispose();
    } else if (child[OWNER_DISPOSE]) {
      child[OWNER_DISPOSE]();
    } else {
      disposeOwner(child);
    }
    child = next;
  }
}

/**
 * Flushes all pending effects.
 * Uses the unified scheduler's pending effects queue. A disposed effect stays
 * in it until then and is skipped.
 */
function flushEffects(): void {
  if (isFlushingEffectsNow()) return;

  const pending = getPendingEffects();
  if (!pending || pending.length === 0) return;

  setFlushingEffects(true);
  let iterations = 0;

  try {
    // Effects that schedule new effects during their run go to the next round
    while (true) {
      const effects = getPendingEffects();
      if (!effects || effects.length === 0) break;

      iterations++;

      if (iterations > MAX_FLUSH_ITERATIONS) {
        logger.error(ReactiveLogMessages.EFFECT_FLUSH_EXCEEDED);
        dropPendingEffects();
        break;
      }

      clearPendingEffects();

      // A batch without batch(), to skip a closure per flush
      enterBatch();
      try {
        for (let i = 0; i < effects.length; i++) runEffect(effects[i]!);
      } finally {
        exitBatch();
      }
    }
  } finally {
    setFlushingEffects(false);
  }
}

/**
 * Runs one effect of a flush. A throwing effect is logged, not rethrown, so
 * the other effects still run.
 */
function runEffect(effect: Runnable): void {
  try {
    effect.run();
  } catch (error) {
    logger.error(ReactiveLogMessages.EFFECT_ERROR, { error });
  }
}

//=============================================
// Public API Functions
//=============================================

/**
 * Gets the current reactive owner.
 * Useful for storing owner reference for later use with `runWithOwner`.
 *
 * @returns The current owner or null if outside reactive context
 *
 * @example
 * ```typescript
 * const owner = getOwner();
 *
 * // Later, in an async callback:
 * setTimeout(() => {
 *   runWithOwner(owner, () => {
 *     effect(() => { ... }); // Properly owned
 *   });
 * }, 1000);
 * ```
 */
export function getOwner(): Owner | null {
  return CurrentOwner;
}

/**
 * Runs a function with a specific owner context.
 * Effects created inside will be owned by the provided owner.
 *
 * @template T - Return type of the function
 * @param owner - The owner context to use
 * @param fn - Function to run
 * @returns The result of the function
 *
 * @example
 * ```typescript
 * const owner = getOwner();
 *
 * setTimeout(() => {
 *   runWithOwner(owner, () => {
 *     // This effect is owned by the original context
 *     effect(() => console.log(count.value));
 *   });
 * }, 1000);
 * ```
 */
export function runWithOwner<T>(owner: Owner | null, fn: () => T): T {
  const prev = CurrentOwner;
  CurrentOwner = owner;
  try {
    return fn();
  } finally {
    CurrentOwner = prev;
  }
}

/**
 * Creates a new reactive root for scoped disposal.
 *
 * All effects and computations created inside the root are "owned" by it.
 * When the root is disposed, all owned effects are cleaned up automatically.
 *
 * @template T - Return type of the function
 * @param fn - Function that receives a dispose callback. If fn takes no arguments,
 *             the root is unowned and won't auto-dispose.
 * @returns The result of the function
 *
 * @example
 * ```typescript
 * // With disposal function
 * const dispose = createRoot(dispose => {
 *   const count = new Signal(0);
 *
 *   effect(() => {
 *     console.log('Count:', count.value);
 *   });
 *
 *   return dispose;
 * });
 *
 * // Later: clean up everything
 * dispose();
 *
 * // Without disposal (unowned, for top-level)
 * createRoot(() => {
 *   // These effects run forever
 *   effect(() => { ... });
 * });
 * ```
 */
export function createRoot<T>(fn: ((dispose: () => void) => T) | (() => T)): T {
  const prevOwner = CurrentOwner;
  // Check function signature to determine if it expects a dispose callback
  // fn.length === 0 is unreliable for default/rest params,
  // but this matches Solid.js behavior which in this case I like.
  // Users should use explicit arrow functions:
  // `() => {}` for unowned, `(dispose) => {}` for owned
  const unowned = fn.length === 0;

  if (unowned) {
    // Unowned root - use sentinel
    CurrentOwner = UNOWNED;
    try {
      return (fn as () => T)();
    } finally {
      CurrentOwner = prevOwner;
    }
  } else {
    // Owned root - create plain owner object
    const root: Owner = {
      owner: null,
      ownedHead: null,
      ownedTail: null,
      ownedNext: null,
      ownedPrev: null,
      cleanups: null,
      context: prevOwner?.context ?? null,
    };
    adoptOwner(root);

    CurrentOwner = root;
    try {
      return (fn as (dispose: () => void) => T)(() => disposeOwner(root));
    } finally {
      CurrentOwner = prevOwner;
    }
  }
}

/**
 * A root that is also the row object of a list, so a row is one allocation
 * instead of a row, a root and a dispose closure.
 *
 * @internal
 */
export class RowOwner implements Owner {
  owner: Owner | null = null;
  ownedHead: Owner | null = null;
  ownedTail: Owner | null = null;
  ownedNext: Owner | null = null;
  ownedPrev: Owner | null = null;
  cleanups: (() => void)[] | null = null;
  context: Record<symbol, unknown> | null = null;

  dispose(): void {
    disposeOwner(this);
  }
}

/**
 * Runs `fn` untracked with `row` as a new root under `owner`, as
 * `runWithOwner(owner, () => createRoot(fn))` would.
 *
 * @internal
 */
export function runInRow<T>(row: Owner, owner: Owner | null, fn: () => T): T {
  const prevOwner = CurrentOwner;
  const prevSubscriber = setCurrentSubscriber(null);
  CurrentOwner = owner;
  adoptOwner(row);
  CurrentOwner = row;
  try {
    return fn();
  } finally {
    CurrentOwner = prevOwner;
    setCurrentSubscriber(prevSubscriber);
  }
}

/**
 * Runs `fn` in a new owner whose effects hand the errors they throw to
 * `handler`, now and on later runs, instead of throwing them. A handler can
 * rethrow to pass the error up. Errors thrown by `fn` itself are not caught.
 *
 * @param fn - Function to run
 * @param handler - Receives the errors of the effects created inside
 * @returns The result of `fn`
 *
 * @example
 * ```typescript
 * catchError(
 *   () => effect(() => riskyRead()),
 *   (error) => showError(error)
 * );
 * ```
 */
export function catchError<T>(
  fn: () => T,
  handler: (error: unknown) => void
): T {
  return runWithContext(ERROR_HANDLER, handler, fn);
}

/**
 * Runs fn under a new owner whose context adds `key`. Owners and components
 * created inside inherit it.
 *
 * @internal
 */
export function runWithContext<T>(key: symbol, value: unknown, fn: () => T): T {
  const owner: Owner = {
    owner: null,
    ownedHead: null,
    ownedTail: null,
    ownedNext: null,
    ownedPrev: null,
    cleanups: null,
    context: { ...CurrentOwner?.context, [key]: value },
  };
  adoptOwner(owner);
  const prevOwner = CurrentOwner;
  CurrentOwner = owner;
  try {
    return fn();
  } finally {
    CurrentOwner = prevOwner;
  }
}

/**
 * Reads `key` from the current owner's context.
 *
 * @internal
 */
export function getContextValue(key: symbol): unknown {
  return CurrentOwner?.context?.[key];
}

/**
 * Registers a cleanup function to run on disposal or re-execution.
 *
 * Can be called multiple times to register multiple cleanups.
 * Cleanups run in reverse order of registration (LIFO).
 *
 * @param fn - Cleanup function to register
 * @returns The same function (for convenience)
 *
 * @example
 * ```typescript
 * effect(() => {
 *   const handler = () => console.log('click');
 *   document.addEventListener('click', handler);
 *
 *   // Runs when effect re-executes or is disposed
 *   onCleanup(() => {
 *     document.removeEventListener('click', handler);
 *   });
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Multiple cleanups
 * effect(() => {
 *   const sub1 = subscribe(source1);
 *   onCleanup(() => sub1.unsubscribe());
 *
 *   const sub2 = subscribe(source2);
 *   onCleanup(() => sub2.unsubscribe());
 * });
 * ```
 */
export function onCleanup<T extends () => void>(fn: T): T {
  if (CurrentOwner === null) {
    if (__DEV__) logger.warn(ReactiveLogMessages.CLEANUP_UNOWNED);
  } else if (CurrentOwner !== UNOWNED) {
    if (!CurrentOwner.cleanups) CurrentOwner.cleanups = [fn];
    else CurrentOwner.cleanups.push(fn);
  }
  return fn;
}

/**
 * Creates a reactive effect that runs when dependencies change.
 *
 * Effects automatically track reactive values accessed during execution
 * and re-run when those values change. The initial run is scheduled
 * as a microtask (after current synchronous code completes).
 *
 * @template T - Type of the effect's return value
 * @param fn - Effect function. Receives previous return value.
 * @param value - Optional initial value passed to first run
 * @param options - Effect options
 * @returns The Effect instance (for advanced use cases)
 *
 * @example
 * ```typescript
 * // Basic effect
 * const count = new Signal(0);
 *
 * effect(() => {
 *   console.log('Count is:', count.value);
 * });
 *
 * count.value = 1; // Logs: "Count is: 1"
 * ```
 *
 * @example
 * ```typescript
 * // Effect with cleanup
 * effect(() => {
 *   const timer = setInterval(() => tick(), 1000);
 *   onCleanup(() => clearInterval(timer));
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Effect with previous value
 * effect(prev => {
 *   const current = count.value;
 *   if (prev !== undefined) {
 *     console.log(`Changed from ${prev} to ${current}`);
 *   }
 *   return current;
 * });
 * ```
 */
export function effect<T>(
  fn: EffectFunction<T | undefined, T>,
  value?: T,
  options?: EffectOptions
): Effect<T> {
  return new Effect(fn, value, options);
}

/**
 * Creates an effect wrapper with explicit dependencies.
 *
 * This is useful when you want to:
 * - Skip the initial run with `defer: true`
 * - Access previous values of dependencies
 * - Explicitly control what triggers the effect
 *
 * Only `deps` are tracked. Signals read inside `fn` do not re-run the effect.
 *
 * @template T - Type of dependency value(s)
 * @template U - Type of effect return value
 * @param deps - Single accessor or array of accessors to track
 * @param fn - Effect function receiving (value, prevValue, prevReturn)
 * @param options - Options including defer
 * @returns An effect function to pass to effect()
 *
 * @example
 * ```typescript
 * // Skip initial run
 * effect(
 *   on(count, (value, prev) => {
 *     console.log(`Changed from ${prev} to ${value}`);
 *   }, { defer: true })
 * );
 * ```
 *
 * @example
 * ```typescript
 * // Multiple dependencies
 * effect(
 *   on(
 *     [firstName, lastName],
 *     ([first, last], [prevFirst, prevLast]) => {
 *       console.log(`Name: ${first} ${last}`);
 *     }
 *   )
 * );
 * ```
 */
export function on<T, U>(
  deps: (() => T) | Array<() => unknown>,
  fn: (value: T, prevValue: T | undefined, prevReturn: U | undefined) => U,
  options?: OnOptions
): EffectFunction<U | undefined, U | undefined> {
  const isArray = Array.isArray(deps);
  let defer = options?.defer ?? false;
  let prevValue: T | undefined;

  return (prevReturn: U | undefined) => {
    // Read dependencies (this creates the tracking)
    let value: T;
    if (isArray) {
      value = deps.map((d) => d()) as unknown as T;
    } else {
      value = (deps as () => T)();
    }

    // Skip first run if deferred
    if (defer) {
      defer = false;
      prevValue = value;
      return prevReturn;
    }

    // Untracked, so only deps re-run the effect, like Solid's on()
    const prevSubscriber = setCurrentSubscriber(null);
    let result: U;
    try {
      result = fn(value, prevValue, prevReturn);
    } finally {
      setCurrentSubscriber(prevSubscriber);
    }
    prevValue = value;
    return result;
  };
}

/**
 * Runs a function once after the component/root is mounted.
 * Equivalent to an effect that doesn't track any dependencies.
 *
 * Any `onCleanup` calls inside the mount callback are registered on
 * the parent owner (component/root), not on the temporary mount effect.
 * This ensures cleanups run when the component unmounts, not immediately
 * after the mount callback executes.
 *
 * @param fn - Function to run on mount
 *
 * @example
 * ```typescript
 * function Component() {
 *   onMount(() => {
 *     console.log('Component mounted!');
 *     // DOM is available here
 *
 *     // Cleanup is registered on the component, not the mount effect
 *     onCleanup(() => console.log('Component unmounted!'));
 *   });
 * }
 * ```
 */
export function onMount(fn: () => void): void {
  // Capture parent owner for cleanup registration
  const parentOwner = CurrentOwner;

  // Create an effect that runs once and doesn't track
  const e = effect(() => {
    // Run untracked so no dependencies are created
    const prevSubscriber = setCurrentSubscriber(null);

    // Restore parent owner so onCleanup calls register on the parent,
    // not on this temporary effect that will be disposed immediately
    const prevOwner = CurrentOwner;
    CurrentOwner = parentOwner;

    try {
      fn();
    } finally {
      CurrentOwner = prevOwner;
      setCurrentSubscriber(prevSubscriber);
      // Self-dispose after running once (scheduled to avoid disposing during run)
      queueMicrotask(() => e.dispose());
    }
  });
}
