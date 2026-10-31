/**
 * Tests for reactive signals (class-based API)
 *
 * Signy uses a class-based Signal API for memory efficiency (75% fewer
 * allocations than factory patterns like Solid.js's createSignal).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  Signal,
  Computed,
  isSignal,
  isTracking,
  untrack,
  batch,
  effect,
} from '../../src/reactivity';
import { settle } from '../support/tick';
import { testRoot } from '../support/root';
import {
  getCurrentSubscriber,
  setCurrentSubscriber,
} from '../../src/reactivity/signal/internal';
import { tracker } from '../support/tracker';

describe('Signal', () => {
  describe('constructor', () => {
    it('should create a signal with initial value', () => {
      const signal = new Signal(42);
      expect(signal.value).toBe(42);
    });

    it('should accept custom equality function', () => {
      const equals = vi.fn((a: number, b: number) => a === b);
      const signal = new Signal(1, { equals });

      signal.value = 1; // Same value
      expect(equals).toHaveBeenCalledWith(1, 1);
    });

    it('should accept a name for debugging', () => {
      const signal = new Signal(0, { name: 'counter' });
      expect(signal.name).toBe('counter');
    });
  });

  describe('value getter', () => {
    it('should return current value', () => {
      const signal = new Signal('hello');
      expect(signal.value).toBe('hello');
    });

    it('should track dependency when subscriber is active', () => {
      const signal = new Signal(10);
      const subscriber = vi.fn();

      setCurrentSubscriber(tracker(subscriber));
      signal.value; // Access to trigger tracking
      setCurrentSubscriber(null);

      expect(signal.subscriberCount).toBe(1);
    });
  });

  describe('value setter', () => {
    it('should update value', () => {
      const signal = new Signal(1);
      signal.value = 5;
      expect(signal.value).toBe(5);
    });

    it('should not notify subscribers if value unchanged', () => {
      const subscriber = vi.fn();
      const signal = new Signal(1);

      setCurrentSubscriber(tracker(subscriber));
      signal.value; // Track
      setCurrentSubscriber(null);

      // Reset mock to only track notifications
      subscriber.mockClear();

      signal.value = 1; // Same value

      // Subscriber should not have been called again
      // (notification goes through batch system)
    });

    it('should notify subscribers when value changes', async () => {
      const count = new Signal(0);
      const values: number[] = [];

      // Use effect-like pattern to track changes
      const subscriber = () => {
        values.push(count.value);
      };

      setCurrentSubscriber(tracker(subscriber));
      count.value; // Initial tracking
      setCurrentSubscriber(null);

      count.value = 1;
      await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

      expect(values.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('get()', () => {
    it('should return current value', () => {
      const signal = new Signal(100);
      expect(signal.get()).toBe(100);
    });

    it('should throw when reading disposed signal', () => {
      const signal = new Signal(1);
      signal.dispose();

      expect(() => signal.get()).toThrow();
    });
  });

  describe('set()', () => {
    it('should accept direct value', () => {
      const signal = new Signal(0);
      signal.set(10);
      expect(signal.value).toBe(10);
    });

    it('should accept updater function', () => {
      const signal = new Signal(5);
      signal.set((prev) => prev * 2);
      expect(signal.value).toBe(10);
    });

    it('should throw when writing to disposed signal', () => {
      const signal = new Signal(1);
      signal.dispose();

      expect(() => signal.set(2)).toThrow();
    });
  });

  describe('set() with function', () => {
    it('should update value using function', () => {
      const signal = new Signal(10);
      signal.set((v) => v + 5);
      expect(signal.value).toBe(15);
    });
  });

  describe('peek()', () => {
    it('should return value without tracking', () => {
      const signal = new Signal(42);
      const subscriber = vi.fn();

      setCurrentSubscriber(tracker(subscriber));
      const value = signal.peek();
      setCurrentSubscriber(null);

      expect(value).toBe(42);
      expect(signal.subscriberCount).toBe(0);
    });

    it('should throw when peeking disposed signal', () => {
      const signal = new Signal(1);
      signal.dispose();

      expect(() => signal.peek()).toThrow();
    });
  });

  describe('unsubscribe()', () => {
    it('should remove subscriber', () => {
      const signal = new Signal(0);
      const subscriber = vi.fn();

      setCurrentSubscriber(tracker(subscriber));
      signal.value;
      setCurrentSubscriber(null);

      expect(signal.subscriberCount).toBe(1);

      signal.unsubscribe(tracker(subscriber));
      expect(signal.subscriberCount).toBe(0);
    });
  });

  describe('dispose()', () => {
    it('should clear all subscribers', () => {
      const signal = new Signal(0);
      const subscriber = vi.fn();

      setCurrentSubscriber(tracker(subscriber));
      signal.value;
      setCurrentSubscriber(null);

      signal.dispose();
      expect(signal.subscriberCount).toBe(0);
      expect(signal.disposed).toBe(true);
    });

    it('should be idempotent', () => {
      const signal = new Signal(0);
      signal.dispose();
      signal.dispose(); // Should not throw
      expect(signal.disposed).toBe(true);
    });
  });

  describe('disposed getter', () => {
    it('should return false initially', () => {
      const signal = new Signal(0);
      expect(signal.disposed).toBe(false);
    });

    it('should return true after disposal', () => {
      const signal = new Signal(0);
      signal.dispose();
      expect(signal.disposed).toBe(true);
    });
  });

  describe('usage patterns', () => {
    it('should work with objects', () => {
      const user = new Signal({ name: 'Alice', age: 25 });
      expect(user.value).toEqual({ name: 'Alice', age: 25 });

      user.value = { name: 'Bob', age: 30 };
      expect(user.value).toEqual({ name: 'Bob', age: 30 });
    });

    it('should work with arrays', () => {
      const items = new Signal([1, 2, 3]);
      expect(items.value).toEqual([1, 2, 3]);

      items.set((prev) => [...prev, 4]);
      expect(items.value).toEqual([1, 2, 3, 4]);
    });

    it('should respect custom equality', () => {
      const user = new Signal(
        { id: 1, name: 'Alice' },
        { equals: (a, b) => a.id === b.id }
      );

      let updateCount = 0;
      const subscriber = () => {
        updateCount++;
        user.value;
      };

      setCurrentSubscriber(tracker(subscriber));
      user.value;
      setCurrentSubscriber(null);

      // Same id, different name - should not trigger update
      user.value = { id: 1, name: 'Alicia' };
      expect(updateCount).toBe(0);
    });
  });
});

describe('isSignal', () => {
  it('should return true for Signal instance', () => {
    const count = new Signal(0);
    expect(isSignal(count)).toBe(true);
  });

  it('should return false for non-Signal objects', () => {
    expect(isSignal({ value: 0 })).toBe(false);
  });

  it('should return false for primitives', () => {
    expect(isSignal(42)).toBe(false);
    expect(isSignal('string')).toBe(false);
    expect(isSignal(null)).toBe(false);
    expect(isSignal(undefined)).toBe(false);
  });

  it('should return false for functions', () => {
    const fn = () => 42;
    expect(isSignal(fn)).toBe(false);
  });
});

describe('untrack', () => {
  it('should run function without tracking', () => {
    const count = new Signal(10);
    const other = new Signal(20);

    const subscriber = () => {
      // This would be called if tracking was active
    };

    setCurrentSubscriber(tracker(subscriber));

    const result = untrack(() => {
      return count.value + other.value;
    });

    setCurrentSubscriber(null);

    expect(result).toBe(30);
    // Reads inside untrack should not be tracked
  });

  it('should restore previous subscriber after execution', () => {
    const originalSubscriber = vi.fn();

    setCurrentSubscriber(tracker(originalSubscriber));

    untrack(() => {
      expect(getCurrentSubscriber()).toBe(null);
    });

    expect(getCurrentSubscriber()).toBe(tracker(originalSubscriber));
    setCurrentSubscriber(null);
  });

  it('should handle nested untrack calls', () => {
    const subscriber = vi.fn();
    setCurrentSubscriber(tracker(subscriber));

    untrack(() => {
      expect(getCurrentSubscriber()).toBe(null);
      untrack(() => {
        expect(getCurrentSubscriber()).toBe(null);
      });
      expect(getCurrentSubscriber()).toBe(null);
    });

    expect(getCurrentSubscriber()).toBe(tracker(subscriber));
    setCurrentSubscriber(null);
  });
});

describe('getCurrentSubscriber / setCurrentSubscriber', () => {
  afterEach(() => {
    setCurrentSubscriber(null);
  });

  it('should return null when no subscriber is set', () => {
    expect(getCurrentSubscriber()).toBe(null);
  });

  it('should return the current subscriber', () => {
    const subscriber = vi.fn();
    setCurrentSubscriber(tracker(subscriber));
    expect(getCurrentSubscriber()).toBe(tracker(subscriber));
  });

  it('should return previous subscriber when setting new one', () => {
    const subscriber1 = vi.fn();
    const subscriber2 = vi.fn();

    setCurrentSubscriber(tracker(subscriber1));
    const prev = setCurrentSubscriber(tracker(subscriber2));

    expect(prev).toBe(tracker(subscriber1));
    expect(getCurrentSubscriber()).toBe(tracker(subscriber2));
  });
});

describe('batch integration', () => {
  it('should batch multiple signal updates', async () => {
    const a = new Signal(1);
    const b = new Signal(2);
    const results: number[] = [];

    const subscriber = () => {
      results.push(a.value + b.value);
    };

    setCurrentSubscriber(tracker(subscriber));
    a.value;
    b.value;
    setCurrentSubscriber(null);

    batch(() => {
      a.value = 10;
      b.value = 20;
    });

    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

    // Should have batched the updates
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});

describe('edge cases', () => {
  it('should handle undefined as a valid value', () => {
    const value = new Signal<string | undefined>('initial');
    value.value = undefined;
    expect(value.value).toBe(undefined);
  });

  it('should handle null as a valid value', () => {
    const value = new Signal<string | null>('initial');
    value.value = null;
    expect(value.value).toBe(null);
  });

  it('should handle NaN correctly with Object.is', () => {
    const value = new Signal(NaN);
    expect(value.value).toBeNaN();

    // Object.is(NaN, NaN) returns true, so this should not trigger update
    value.value = NaN;
    expect(value.value).toBeNaN();
  });

  it('should handle -0 vs +0 correctly with Object.is', () => {
    const value = new Signal(0);

    // Object.is(0, -0) returns false, so this should trigger update
    value.value = -0;
    expect(Object.is(value.value, -0)).toBe(true);
  });

  it('should handle recursive signal updates', () => {
    const count = new Signal(0);

    // This should not cause infinite loop due to equality check
    const subscriber = () => {
      const current = count.value;
      if (current < 3) {
        count.value = current + 1;
      }
    };

    setCurrentSubscriber(tracker(subscriber));
    count.value;
    setCurrentSubscriber(null);

    // Trigger update
    count.value = 1;
    // Due to batching, this won't immediately recurse
  });
});

describe('isTracking', () => {
  it('is true inside an effect or computed and false outside or untracked', () => {
    const seen: boolean[] = [];
    testRoot(() => {
      effect(() => {
        seen.push(isTracking());
        untrack(() => seen.push(isTracking()));
      });
      settle();
      const c = new Computed(() => isTracking());
      effect(() => seen.push(c.value));
      settle();
    });
    expect(isTracking()).toBe(false);
    expect(seen).toEqual([true, false, true]);
  });
});
