/**
 * State Signals (TC39 Signal.State aligned)
 *
 * State signals are the foundational reactive primitive in signy.
 * They hold a value and automatically track dependencies, notifying
 * subscribers when the value changes.
 *
 * Aligned with TC39 Signals proposal `Signal.State`:
 * - Class-based API: `new State(initialValue)`
 * - `.get()` method for reading with dependency tracking
 * - `.set()` method for writing
 * - `.value` getter/setter as ergonomic shorthand
 *
 * ## Design Decision: Class-Based API for Memory Efficiency
 *
 * Signy uses a **class-based API** (like the TC39 Signals proposal) instead of
 * a factory pattern (like Solid.js's `createSignal`) for memory efficiency.
 *
 * ### Memory Savings
 *
 * | Scenario       | Factory Pattern  | Class Pattern   | Savings |
 * |----------------|------------------|-----------------|---------|
 * | 100 signals    | ~400 allocations | ~100 allocations | 75%    |
 * | 1,000 signals  | ~4,000 allocations | ~1,000 allocations | 75% |
 * | 10,000 signals | ~40,000 allocations | ~10,000 allocations | 75% |
 *
 * @module reactivity/signal/state
 * @internal
 *
 * ## Internal Use Only
 *
 * This module is for Signy framework internals. End users should import
 * from `signy` or `signy/core` using the public API:
 *
 * ```typescript
 * // Public API (for end users)
 * import { Signal, signal } from 'signy';
 * const count = new Signal(0);  // or: signal(0)
 * ```
 *
 * The examples below use internal names (`State`, `Signal.State`) for
 * illustration of framework internals only.
 *
 * @example Internal usage (framework code only)
 * ```typescript
 * // Internal import (framework internals only)
 * import { State } from './signal/state';
 *
 * const count = new State(0);
 *
 * // Read the value (with dependency tracking)
 * console.log(count.value); // 0
 * console.log(count.get()); // 0 (TC39 style)
 *
 * // Update with a new value
 * count.value = 5;
 * count.set(10); // TC39 style
 *
 * // Update with a function (receives previous value)
 * count.set(prev => prev + 1);
 *
 * // Peek without tracking (no dependency registered)
 * console.log(count.peek()); // 11
 *
 * // Dispose when done
 * count.dispose();
 * ```
 *
 * ## Known limitations
 *
 * None.
 */

import { panic } from '../../log';
import { SignalLogMessages } from './log-messages';
import {
  bumpGlobalVersion,
  registerSource,
  type Subscriber,
} from './scheduler';
import {
  clearSubscribers,
  countSubscribers,
  notifySubscribers,
  subscribe,
  subscribersOf,
  trackSource,
  unsubscribe,
  type Link,
  type Source,
} from './links';
import { features, isFeaturesActive } from '../../core/features';

//=============================================
// Types
//=============================================

/**
 * Options for creating a state signal
 */
export interface StateOptions<T> {
  /**
   * Custom equality function to determine if the value has changed.
   * By default, uses Object.is for comparison.
   *
   * @param prev - Previous value
   * @param next - Next value
   * @returns True if values are equal (no update needed)
   *
   * @example
   * ```typescript
   * // Deep equality for objects
   * const user = new State(
   *   { name: 'Alice' },
   *   { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) }
   * );
   * ```
   */
  equals?: (prev: T, next: T) => boolean;

  /**
   * Name for debugging purposes.
   * Shown in DevTools and error messages.
   */
  name?: string;
}

//=============================================
// State Class
//=============================================

/**
 * A state signal that holds a value and notifies subscribers when it changes.
 *
 * Aligned with TC39 Signals proposal `Signal.State`.
 * State signals are the foundational reactive primitive. They automatically
 * track dependencies and notify effects, computed values, and other reactive
 * contexts when their value changes.
 *
 * Implements `Source` interface for dependency cleanup support.
 *
 * @template T - Type of the signal value
 *
 * @example
 * ```typescript
 * // Using the class directly
 * const counter = new State(0);
 *
 * console.log(counter.value); // 0
 * counter.value = 5;
 * console.log(counter.value); // 5
 *
 * // Using TC39-style methods
 * console.log(counter.get()); // 5
 * counter.set(10);
 * console.log(counter.get()); // 10
 *
 * // Update with function
 * counter.set(prev => prev + 1);
 * console.log(counter.value); // 11
 *
 * // Later: dispose to clear all subscribers
 * counter.dispose();
 * ```
 */
export class State<T> implements Source {
  //=============================================
  // Public Fields
  //=============================================

  /** @internal See Source */
  _subscribersHead: Link | null = null;
  /** @internal */
  _subscribersTail: Link | null = null;
  /** @internal */
  _activeLink: Link | null = null;

  //=============================================
  // Private Fields
  //=============================================

  /** Current value of the signal */
  private _value: T;

  /** Equality function for comparing values */
  private readonly _equals: (prev: T, next: T) => boolean;

  /** Signal name for debugging */
  private readonly _name: string | undefined;

  /** Whether this signal has been disposed */
  private _disposed = false;

  /** Version number for version-based dirty checking */
  private _version = 0;

  //=============================================
  // Constructor
  //=============================================

  /**
   * Creates a new state signal.
   *
   * @param initialValue - Initial value of the signal
   * @param options - Signal configuration options
   */
  constructor(initialValue: T, options?: StateOptions<T>) {
    this._value = initialValue;
    this._equals = options?.equals ?? Object.is;
    this._name = options?.name;
    registerSource(this);
    if (isFeaturesActive()) features.emit.signalCreate(this, initialValue);
  }

  //=============================================
  // Getters and Setters
  //=============================================

  /**
   * Gets the current value and tracks the dependency.
   * Ergonomic shorthand for `.get()`.
   */
  get value(): T {
    return this.get();
  }

  /**
   * Sets a new value and notifies subscribers if changed.
   * Unlike `set()`, this does not support updater functions.
   * Use `set()` when you need functional updates.
   */
  set value(newValue: T) {
    this._write(newValue);
  }

  /**
   * Debug name for this signal
   */
  get name(): string | undefined {
    return this._name;
  }

  /**
   * Whether this signal has been disposed
   */
  get disposed(): boolean {
    return this._disposed;
  }

  /**
   * Gets the current subscriber count (for debugging/testing)
   */
  get subscriberCount(): number {
    return countSubscribers(this);
  }

  /**
   * Version number for version-based dirty checking.
   * Incremented on every value change.
   */
  get version(): number {
    return this._version;
  }

  //=============================================
  // Public Methods
  //=============================================

  /**
   * Gets the current value and tracks the dependency.
   * Aligned with TC39 Signals proposal `Signal.State.prototype.get()`.
   */
  get(): T {
    if (this._disposed) {
      panic(
        SignalLogMessages.SIGNAL_DISPOSED,
        `Cannot read disposed signal${this._name ? ` "${this._name}"` : ''}`
      );
    }

    trackSource(this, this._version);
    return this._value;
  }

  /**
   * Sets a new value and notifies subscribers if changed.
   * Accepts either a direct value or an updater function.
   * Aligned with TC39 Signals proposal `Signal.State.prototype.set()`,
   * extended to support functional updates.
   */
  set(nextValue: T | ((prev: T) => T)): void {
    this._write(
      typeof nextValue === 'function'
        ? (nextValue as (prev: T) => T)(this._value)
        : nextValue
    );
  }

  /**
   * Peeks at the current value without tracking as a dependency.
   */
  peek(): T {
    if (this._disposed) {
      panic(
        SignalLogMessages.SIGNAL_DISPOSED,
        `Cannot peek disposed signal${this._name ? ` "${this._name}"` : ''}`
      );
    }
    return this._value;
  }

  /**
   * Adds a subscriber to this signal.
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
   * Removes a subscriber from this signal.
   */
  unsubscribe(subscriber: Subscriber): void {
    unsubscribe(this, subscriber);
  }

  /**
   * Disposes this signal, clearing all subscribers.
   * The signal can no longer be read or written after disposal.
   */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    clearSubscribers(this);
  }

  //=============================================
  // Private Methods
  //=============================================

  /**
   * Stores a new value and notifies subscribers if it changed.
   */
  private _write(newValue: T): void {
    if (this._disposed) {
      panic(
        SignalLogMessages.SIGNAL_DISPOSED,
        `Cannot write to disposed signal${this._name ? ` "${this._name}"` : ''}`
      );
    }
    if (this._equals(this._value, newValue)) return;

    // Emitted before the write, so the event still sees the old value
    if (isFeaturesActive()) {
      features.emit.signalWrite(this, this._value, newValue);
    }

    this._value = newValue;
    this._version++;
    bumpGlobalVersion();
    notifySubscribers(this);
  }
}

//=============================================
// Type Guards
//=============================================

/**
 * Checks if a value is a State signal instance.
 *
 * @param value - Value to check
 * @returns True if value is a State instance
 *
 * @example
 * ```typescript
 * const count = new State(0);
 *
 * if (isState(count)) {
 *   console.log('Value is a state signal:', count.value);
 * }
 * ```
 */
export function isState(value: unknown): value is State<unknown> {
  return value instanceof State;
}
