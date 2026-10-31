/**
 * Computed Values (TC39 Signal.Computed aligned)
 *
 * Computed values are derived reactive values that cache their result and only
 * recompute when their dependencies change. They provide automatic
 * dependency tracking and lazy evaluation.
 *
 * Aligned with TC39 Signals proposal `Signal.Computed`:
 * - Class-based API: `new Computed(() => ...)`
 * - `.get()` method for reading with dependency tracking
 * - `.value` getter as ergonomic shorthand
 *
 * ## Version-based Dirty Checking
 *
 * Computed values use version-based dirty checking for efficiency.
 * Instead of immediately recomputing when marked dirty, they check
 * if any source's version has actually changed at read time.
 * This avoids unnecessary recomputations in diamond dependency graphs.
 *
 * @module reactivity/signal/computed
 * @internal
 *
 * ## Internal use only
 *
 * This module is for Signy framework internals. End users should import
 * from `signy` or `signy/core` using the public API:
 *
 * ```typescript
 * // Public API (for end users)
 * import { Computed, computed, Signal, signal } from 'signy';
 * const count = new Signal(0);  // or: signal(0)
 * const double = new Computed(() => count.value * 2);  // or: computed(() => ...)
 * ```
 *
 * The examples below use internal names for illustration of framework
 * internals only.
 *
 * @example Internal usage (framework code only)
 * ```typescript
 * // Internal imports (framework internals only)
 * import { State } from './signal/state';
 * import { Computed } from './signal/computed';
 *
 * const count = new State(0);
 * const double = new Computed(() => count.get() * 2);
 *
 * console.log(double.value); // 0
 * count.set(5);
 * console.log(double.value); // 10 (recomputed)
 * console.log(double.value); // 10 (cached, no recompute)
 *
 * // Or using .get() like TC39
 * console.log(double.get()); // 10
 * ```
 *
 * ## Known limitations
 *
 * None.
 *
 * ## Known Behaviors
 *
 * **Exception during computation**: If the computation function throws, the
 * error is cached like a value and rethrown on every read until one of the
 * sources it read changes, as in the TC39 proposal.
 *
 * **Unwatched computeds**: A computed without subscribers does not subscribe
 * to its sources. It checks their versions on each read instead, so a dropped
 * computed can be garbage collected even while its sources live on.
 *
 * **Lazy evaluation**: Computed values don't compute until first read.
 */

import {
  getGlobalVersion,
  countDerivedRead,
  registerSource,
  type Subscriber,
  type SubscriberTarget,
} from './scheduler';
import {
  clearSubscribers,
  dropSources,
  endTracking,
  getCurrentSubscriber,
  hasSourcesChanged,
  linkSources,
  notifySubscribers,
  setCurrentSubscriber,
  startTracking,
  subscribe,
  subscribersOf,
  trackSource,
  unlinkSources,
  unsubscribe,
  type Link,
  type Source,
  type Tracker,
} from './links';
import { panic } from '../../log';
import { SignalLogMessages } from './log-messages';
import { features, isFeaturesActive } from '../../core/features';

//=============================================
// Types
//=============================================

/**
 * Options for creating a computed value
 */
export interface ComputedOptions<T> {
  /**
   * Custom equality function to determine if the computed value has changed.
   * By default, uses Object.is for comparison.
   *
   * @param prev - Previous computed value
   * @param next - Next computed value
   * @returns True if values are equal (no update needed)
   */
  equals?: (prev: T, next: T) => boolean;

  /**
   * Name for debugging purposes.
   */
  name?: string;
}

/**
 * Computation state enum
 */
const enum ComputationState {
  /** Value is valid and cached */
  CLEAN = 0,
  /** Value needs recomputation */
  DIRTY = 1,
  /** Currently computing (for circular dependency detection) */
  COMPUTING = 2,
}

//=============================================
// Computed Class
//=============================================

/**
 * A computed value that caches its result and only recomputes
 * when dependencies change.
 *
 * Aligned with TC39 Signals proposal `Signal.Computed`.
 * Provides automatic dependency tracking, lazy evaluation, and
 * caching. Pull-based - values are only computed when read.
 *
 * @template T - Type of the computed value
 *
 * @example
 * ```typescript
 * import { Signal, Computed } from 'signy';
 *
 * const count = new Signal(0);
 * const double = new Computed(() => count.get() * 2);
 *
 * console.log(double.value); // 0
 * count.set(5);
 * console.log(double.value); // 10
 *
 * // Using .get() like TC39 Signal.Computed
 * console.log(double.get()); // 10
 *
 * // Chained computed values
 * const quadruple = new Computed(() => double.get() * 2);
 * console.log(quadruple.value); // 20
 *
 * // With custom equality
 * const user = new Computed(
 *   () => ({ name: `${firstName.get()} ${lastName.get()}` }),
 *   { equals: (a, b) => a.name === b.name }
 * );
 *
 * // Later: manually dispose
 * double.dispose();
 * ```
 */
export class Computed<T> implements Source, Tracker {
  //=============================================
  // Public Fields
  //=============================================

  /**
   * Subscriber flags. The computed is its own subscriber, so it needs no
   * closure. It only marks itself dirty on notify, which is safe in a batch.
   *
   * @internal
   */
  readonly eager = true;

  /** @internal Set to the computed itself while tests track, for checkInvariants() */
  target: SubscriberTarget | undefined = undefined;

  /** @internal See Source */
  _subscribersHead: Link | null = null;
  /** @internal */
  _subscribersTail: Link | null = null;
  /** @internal */
  _activeLink: Link | null = null;

  /**
   * @internal See Tracker. The sources read by the last computation, linked
   * in only while this computed has subscribers, so an unused computed never
   * stays reachable from them.
   */
  _sourcesHead: Link | null = null;
  /** @internal */
  _sourcesTail: Link | null = null;

  //=============================================
  // Private Fields
  //=============================================

  /** The computation function */
  private readonly _fn: () => T;

  /** Equality function */
  private readonly _equals: (prev: T, next: T) => boolean;

  /** Debug name */
  private readonly _name: string | undefined;

  /** Cached value */
  private _value: T | undefined;

  /** The error the last computation threw, rethrown on read until a source changes */
  private _error: { error: unknown } | null = null;

  /** Current computation state */
  private _state: ComputationState = ComputationState.DIRTY;

  /** Whether this computed has been disposed */
  private _disposed = false;

  /** Whether we have computed at least once */
  private _hasValue = false;

  /** Version number for version-based dirty checking */
  private _version = 0;

  /** Global write version at the last check, see getGlobalVersion() */
  private _checkedAt = -1;

  //=============================================
  // Constructor
  //=============================================

  /**
   * Creates a new computed value.
   *
   * @param fn - Computation function (TC39 Signal.Computed compatible)
   * @param options - Computed configuration options
   */
  constructor(fn: () => T, options?: ComputedOptions<T>) {
    this._fn = fn;
    this._equals = options?.equals ?? Object.is;
    this._name = options?.name;
    if (registerSource(this)) this.target = this;
    if (isFeaturesActive()) features.emit.computedCreate(this);
  }

  //=============================================
  // Getters
  //=============================================

  /**
   * Gets the current computed value.
   * Recomputes if necessary and tracks the caller as a subscriber.
   * Ergonomic shorthand for `.get()`.
   */
  get value(): T {
    return this.get();
  }

  /**
   * Debug name for this computed
   */
  get name(): string | undefined {
    return this._name;
  }

  /**
   * Whether this computed has been disposed
   */
  get disposed(): boolean {
    return this._disposed;
  }

  /**
   * Whether anything subscribes to this computed. Only then is it subscribed
   * to its sources.
   */
  get watched(): boolean {
    return this._subscribersHead !== null;
  }

  /** @internal See Tracker */
  get _linked(): boolean {
    return this._subscribersHead !== null;
  }

  /**
   * Whether the computed needs recomputation.
   * Uses version-based checking to verify if sources actually changed.
   */
  get dirty(): boolean {
    return this._needsCheck() && hasSourcesChanged(this);
  }

  /**
   * Version number for version-based dirty checking.
   * Incremented on every value change.
   */
  get version(): number {
    // A disposed computed must not run again for a dependent's version check
    if (!this._disposed) this._refresh();
    return this._version;
  }

  /** See Source.derived */
  get derived(): boolean {
    return true;
  }

  //=============================================
  // Public Methods
  //=============================================

  /**
   * Gets the current value, recomputing if necessary.
   * Tracks the caller as a subscriber if inside a reactive context.
   * Aligned with TC39 Signals proposal `Signal.Computed.prototype.get()`.
   *
   * Uses version-based dirty checking: when marked dirty, we verify
   * that a source actually changed before recomputing.
   *
   * @throws The error the computation threw, until one of its sources changes
   */
  get(): T {
    if (this._disposed) {
      panic(
        SignalLogMessages.COMPUTED_DISPOSED,
        `Cannot read disposed computed${this._name ? ` "${this._name}"` : ''}`
      );
    }

    // Check for circular dependency
    if (this._state === ComputationState.COMPUTING) {
      panic(
        SignalLogMessages.COMPUTED_CIRCULAR,
        `Circular dependency detected${this._name ? ` in computed "${this._name}"` : ''}`
      );
    }

    // Up to date first, so tracking below reads the new version
    this._refresh();

    // Track this computed as a dependency of the current subscriber
    if (getCurrentSubscriber() !== null) {
      trackSource(this, this._version);
      countDerivedRead();
    }

    if (this._error) throw this._error.error;
    return this._value as T;
  }

  /**
   * Reads the current value, recomputed if a source changed, without
   * tracking it as a dependency. The same as Signal.peek().
   */
  peek(): T {
    const prev = setCurrentSubscriber(null);
    try {
      return this.get();
    } finally {
      setCurrentSubscriber(prev);
    }
  }

  /**
   * Marks the computed as dirty, requiring a version check on next read.
   * Notifies subscribers that this computed's value may have changed.
   */
  markDirty(): void {
    this.notify();
  }

  /**
   * A source may have changed. The next read checks the versions.
   *
   * @internal
   */
  notify(): void {
    if (this._disposed) return;

    if (this._state === ComputationState.CLEAN) {
      this._state = ComputationState.DIRTY;
      // Subscribers recompute lazily when they read this computed
      notifySubscribers(this);
    }
  }

  /**
   * Adds a subscriber. The first one subscribes this computed to its sources.
   */
  subscribe(subscriber: Subscriber): void {
    subscribe(this, subscriber);
  }

  /**
   * The current subscribers.
   *
   * @internal
   */
  subscribers(): Iterable<Subscriber> {
    return subscribersOf(this);
  }

  /**
   * Removes a subscriber. The last one releases this computed's sources.
   */
  unsubscribe(subscriber: Subscriber): void {
    unsubscribe(this, subscriber);
  }

  /**
   * Disposes of this computed, cleaning up all subscriptions.
   * The computed can no longer be read after disposal.
   */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    // While computing, the run drops the links when it ends
    if (this._state === ComputationState.COMPUTING) unlinkSources(this);
    else dropSources(this);
    clearSubscribers(this);
    this._state = ComputationState.DIRTY;
    this._value = undefined;
    this._error = null;
    this._hasValue = false;
  }

  /**
   * The first subscriber linked in, so this computed links into its sources.
   *
   * @internal
   */
  _watch(): void {
    if (this._sourcesHead === null) return;
    linkSources(this);
    // A source may have changed since the last check, while nobody listened
    if (
      this._state === ComputationState.CLEAN &&
      this._checkedAt !== getGlobalVersion()
    ) {
      this._state = ComputationState.DIRTY;
    }
  }

  /**
   * The last subscriber left, so this computed leaves its sources.
   *
   * @internal
   */
  _unwatch(): void {
    unlinkSources(this);
    if (this._state === ComputationState.CLEAN) {
      this._state = ComputationState.DIRTY;
    }
  }

  //=============================================
  // Private Methods
  //=============================================

  /**
   * Without subscribers, nothing notifies this computed, so every read
   * checks the source versions. One that read no source never changes.
   */
  private _needsCheck(): boolean {
    if (this._state !== ComputationState.CLEAN) return true;
    return (
      this._subscribersHead === null &&
      this._sourcesHead !== null &&
      this._checkedAt !== getGlobalVersion()
    );
  }

  /**
   * Recomputes if a source changed since the last computation.
   */
  private _refresh(): void {
    // A computed reading itself reaches here through its own version
    if (this._state === ComputationState.COMPUTING || !this._needsCheck()) {
      return;
    }
    if (hasSourcesChanged(this)) {
      this._compute();
    } else {
      this._state = ComputationState.CLEAN;
    }
    this._checkedAt = getGlobalVersion();
  }

  /**
   * Computes the new value with dependency tracking and cleanup.
   * Also captures source versions for version-based dirty checking.
   * A thrown error is kept and rethrown by get(), like a value.
   */
  private _compute(): void {
    // Mark as computing (for circular dependency detection)
    this._state = ComputationState.COMPUTING;

    // Without subscribers, the links keep the versions but stay out of the
    // sources' lists, see _linked
    const prevSubscriber = startTracking(this);

    let newValue: T | undefined;
    let error: { error: unknown } | null = null;
    try {
      newValue = this._fn();
    } catch (e) {
      error = { error: e };
    } finally {
      // Sources read before a throw count too, so a change to them retries
      endTracking(this, prevSubscriber);
      if (this._disposed) dropSources(this);
    }

    this._state = ComputationState.CLEAN;

    const hadError = this._error !== null;
    if (error) {
      this._error = error;
      this._version++;
      return;
    }
    this._error = null;

    // Check if value actually changed (skip on first computation)
    if (
      !hadError &&
      this._hasValue &&
      this._equals(this._value as T, newValue as T)
    ) {
      return;
    }

    // Update cached value and increment version
    this._value = newValue;
    this._hasValue = true;
    this._version++;

    // Emit computed invalidate event if features are active
    if (isFeaturesActive()) {
      features.emit.computedInvalidate(this);
    }
  }
}
