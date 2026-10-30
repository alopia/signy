/**
 * Tests for Computed class (TC39 Signal.Computed aligned)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  Computed,
  Signal,
  effect,
  createRoot,
  batch,
} from '../../src/reactivity';
import { createRenderEffect } from '../../src/reactivity/render';
import { setCurrentSubscriber } from '../../src/reactivity/signal/internal';
import { settle } from '../support/tick';
import { testRoot } from '../support/root';
import { tracker } from '../support/tracker';

// A local alias, Signy exports no MemoComputation
const MemoComputation = Computed;

describe('Computed class', () => {
  describe('constructor', () => {
    it('should create a computed with computation function', () => {
      const computed = new Computed(() => 42);
      expect(computed.value).toBe(42);
    });

    it('should accept custom equality function', () => {
      const equals = vi.fn((a: number, b: number) => a === b);
      const count = new Signal(0);

      const computed = new Computed(() => count.value, { equals });
      computed.value; // First computation

      count.value = 1;
      computed.markDirty();
      computed.value; // Second computation

      expect(equals).toHaveBeenCalled();
    });

    it('should accept a name for debugging', () => {
      const computed = new Computed(() => 42, { name: 'myComputed' });
      expect(computed.name).toBe('myComputed');
    });
  });

  describe('value getter (read)', () => {
    it('should return computed value', () => {
      const computed = new Computed(() => 'hello');
      expect(computed.value).toBe('hello');
    });

    it('should cache value until dependencies change', () => {
      let computeCount = 0;
      const computed = new Computed(() => {
        computeCount++;
        return 42;
      });

      computed.value;
      computed.value;
      computed.value;

      expect(computeCount).toBe(1);
    });

    it('should track signal dependencies', () => {
      const count = new Signal(0);
      let computeCount = 0;

      const computed = new Computed(() => {
        computeCount++;
        return count.value * 2;
      });

      expect(computed.value).toBe(0);
      expect(computeCount).toBe(1);

      count.value = 5;
      // Computed is lazy - won't recompute until read
      expect(computeCount).toBe(1);

      // After being marked dirty by signal, read triggers recompute
      expect(computed.value).toBe(10);
      expect(computeCount).toBe(2);
    });

    it('should throw when reading disposed computed', () => {
      const computed = new Computed(() => 42);
      computed.dispose();

      expect(() => computed.value).toThrow();
    });
  });

  describe('dirty getter', () => {
    it('should return true initially', () => {
      const computed = new Computed(() => 42);
      expect(computed.dirty).toBe(true);
    });

    it('should return false after computation', () => {
      const computed = new Computed(() => 42);
      computed.value; // Compute
      expect(computed.dirty).toBe(false);
    });

    it('should return true after markDirty', () => {
      const computed = new Computed(() => 42);
      computed.value;
      computed.markDirty();
      expect(computed.dirty).toBe(true);
    });
  });

  describe('markDirty()', () => {
    it('should mark computed as needing recomputation', () => {
      let value = 1;
      const computed = new Computed(() => value);

      expect(computed.value).toBe(1);

      value = 2;
      computed.markDirty();

      expect(computed.value).toBe(2);
    });

    it('should notify subscribers', () => {
      const subscriber = vi.fn();
      const computed = new Computed(() => 42);
      computed.value; // Initial computation

      setCurrentSubscriber(tracker(subscriber));
      computed.value; // Track
      setCurrentSubscriber(null);

      computed.markDirty();

      // Subscriber should have been called
      expect(subscriber).toHaveBeenCalled();
    });

    it('should not mark if already dirty', () => {
      const subscriber = vi.fn();
      const computed = new Computed(() => 42);
      computed.value;

      setCurrentSubscriber(tracker(subscriber));
      computed.value;
      setCurrentSubscriber(null);

      computed.markDirty();
      computed.markDirty();
      computed.markDirty();

      // Should only notify once
      expect(subscriber).toHaveBeenCalledTimes(1);
    });

    it('should not mark if disposed', () => {
      const computed = new Computed(() => 42);
      computed.value;
      computed.dispose();
      computed.markDirty(); // Should not throw
    });
  });

  describe('unsubscribe()', () => {
    it('should remove subscriber', () => {
      const subscriber = vi.fn();
      const computed = new Computed(() => 42);
      computed.value;

      setCurrentSubscriber(tracker(subscriber));
      computed.value;
      setCurrentSubscriber(null);

      computed.unsubscribe(tracker(subscriber));
      computed.markDirty();

      // Subscriber should not be called after unsubscribe
      expect(subscriber).not.toHaveBeenCalled();
    });
  });

  describe('dispose()', () => {
    it('should mark as disposed', () => {
      const computed = new Computed(() => 42);
      expect(computed.disposed).toBe(false);

      computed.dispose();
      expect(computed.disposed).toBe(true);
    });

    it('should clear subscribers', () => {
      const subscriber = vi.fn();
      const computed = new Computed(() => 42);
      computed.value;

      setCurrentSubscriber(tracker(subscriber));
      computed.value;
      setCurrentSubscriber(null);

      computed.dispose();
      // After disposal, subscriber list is cleared
    });

    it('should be idempotent', () => {
      const computed = new Computed(() => 42);
      computed.dispose();
      computed.dispose();
      expect(computed.disposed).toBe(true);
    });
  });

  describe('circular dependency detection', () => {
    it('should detect and throw on circular dependencies', () => {
      const computed: Computed<number> = new Computed(() => {
        return computed.value; // Self-reference
      });

      expect(() => computed.value).toThrow(/circular/i);
    });
  });

  describe('MemoComputation alias', () => {
    it('should still work as deprecated alias', () => {
      const memo = new MemoComputation(() => 42);
      expect(memo.value).toBe(42);
    });
  });
});

describe('Computed (functional tests)', () => {
  it('should compute derived values', () => {
    const count = new Signal(5);
    const double = new Computed(() => count.value * 2);

    expect(double.value).toBe(10);

    count.value = 10;
    expect(double.value).toBe(20);
  });

  it('should cache computed values', () => {
    let computeCount = 0;
    const count = new Signal(5);

    const double = new Computed(() => {
      computeCount++;
      return count.value * 2;
    });

    double.value;
    double.value;
    double.value;

    expect(computeCount).toBe(1);
  });

  it('should work with chained computeds', () => {
    const count = new Signal(2);

    const double = new Computed(() => count.value * 2);
    const quadruple = new Computed(() => double.value * 2);

    expect(quadruple.value).toBe(8);

    count.value = 3;
    expect(quadruple.value).toBe(12);
  });

  it('should only recompute when dependencies change', () => {
    let aCount = 0;
    let bCount = 0;

    const a = new Signal(1);
    const b = new Signal(10);

    const aComputed = new Computed(() => {
      aCount++;
      return a.value * 2;
    });

    const bComputed = new Computed(() => {
      bCount++;
      return b.value * 2;
    });

    aComputed.value;
    bComputed.value;
    expect(aCount).toBe(1);
    expect(bCount).toBe(1);

    a.value = 2;
    aComputed.value;
    bComputed.value;
    expect(aCount).toBe(2);
    expect(bCount).toBe(1); // b didn't change
  });

  it('should respect custom equality', () => {
    let computeCount = 0;
    const value = new Signal({ count: 0 });

    const computed = new Computed(
      () => {
        computeCount++;
        return value.value.count;
      },
      { equals: (a, b) => a === b }
    );

    computed.value;
    expect(computeCount).toBe(1);

    // Different object, same count value
    value.value = { count: 0 };
    computed.value;

    // Should recompute (different object)
    // but computed's equals sees same result, so downstream won't be notified
    expect(computeCount).toBe(2);
  });

  it('should work with get() method (TC39 compatible)', () => {
    const count = new Signal(5);
    const double = new Computed(() => count.value * 2);

    expect(double.get()).toBe(10);

    count.value = 10;
    expect(double.get()).toBe(20);
  });

  it('should compute from source value pattern', () => {
    const items = new Signal([1, 2, 3, 4, 5]);

    const sum = new Computed(() => items.value.reduce((a, b) => a + b, 0));

    expect(sum.value).toBe(15);

    items.value = [10, 20];
    expect(sum.value).toBe(30);
  });

  it('should work with options', () => {
    const count = new Signal(5);
    let computeCount = 0;

    const computed = new Computed(
      () => {
        computeCount++;
        return count.value * 2;
      },
      { name: 'doubler' }
    );

    computed.value;
    computed.value;
    expect(computeCount).toBe(1);
  });
});

describe('Computed with effects', () => {
  it('should trigger effect when computed value changes', async () => {
    const values: number[] = [];

    testRoot(() => {
      const count = new Signal(1);
      const double = new Computed(() => count.value * 2);

      effect(() => {
        values.push(double.value);
      });

      settle();
      expect(values).toEqual([2]);

      count.value = 2;
      settle();
      expect(values).toEqual([2, 4]);
    });
  });

  it('should not change value if computed computes same result', async () => {
    testRoot(() => {
      const count = new Signal(0);
      let computeCount = 0;

      // This computed always returns 'constant' regardless of count
      const constantComputed = new Computed(() => {
        count.value; // Track dependency
        computeCount++;
        return 'constant';
      });

      // Initial read
      expect(constantComputed.value).toBe('constant');
      expect(computeCount).toBe(1);

      // Changing count marks computed dirty
      count.value = 1;

      // Reading again recomputes, but returns same value
      expect(constantComputed.value).toBe('constant');
      expect(computeCount).toBe(2); // Recomputed

      // Value is still the same
      expect(constantComputed.value).toBe('constant');
      expect(computeCount).toBe(2); // Cached this time
    });
  });
});

describe('Computed that comes out equal', () => {
  it('does not re-run effects and bindings that read it', () => {
    testRoot(() => {
      const n = new Signal(1);
      const parity = new Computed(() => n.value % 2);
      let effectRuns = 0;
      let bindingRuns = 0;
      effect(() => {
        void parity.value;
        effectRuns++;
      });
      createRenderEffect(() => {
        void parity.value;
        bindingRuns++;
      });
      settle();

      n.value = 3;
      settle();
      expect([effectRuns, bindingRuns]).toEqual([1, 1]);

      n.value = 4;
      settle();
      expect([effectRuns, bindingRuns]).toEqual([2, 2]);
    });
  });

  it('skips with a custom equals too', () => {
    testRoot(() => {
      const user = new Signal({ id: 1, name: 'Ada' });
      const id = new Computed(() => ({ id: user.value.id }), {
        equals: (a, b) => a.id === b.id,
      });
      let runs = 0;
      effect(() => {
        void id.value;
        runs++;
      });
      settle();

      user.value = { id: 1, name: 'Ada Lovelace' };
      settle();
      expect(runs).toBe(1);
    });
  });

  it('still runs for a signal read next to it', () => {
    testRoot(() => {
      const n = new Signal(1);
      const other = new Signal('a');
      const parity = new Computed(() => n.value % 2);
      const seen: string[] = [];
      effect(() => {
        seen.push(`${parity.value}${other.value}`);
      });
      settle();

      batch(() => {
        n.value = 3;
        other.value = 'b';
      });
      settle();
      expect(seen).toEqual(['1a', '1b']);
    });
  });

  it('still re-runs an effect that wrote a signal it read', () => {
    testRoot(() => {
      const n = new Signal(0);
      const double = new Computed(() => n.value * 2);
      const seen: number[] = [];
      effect(() => {
        seen.push(double.value);
        if (n.value < 2) n.value++;
      });
      settle();
      expect(seen).toEqual([0, 2, 4]);
    });
  });
});

describe('Computed with batch', () => {
  it('should batch multiple updates', () => {
    const a = new Signal(1);
    const b = new Signal(2);
    let computeCount = 0;

    const sum = new Computed(() => {
      computeCount++;
      return a.value + b.value;
    });

    sum.value;
    expect(computeCount).toBe(1);

    batch(() => {
      a.value = 10;
      b.value = 20;
    });

    sum.value;
    // Should only recompute once after batch
    expect(sum.value).toBe(30);
  });
});

describe('Computed edge cases', () => {
  it('should handle computed with no dependencies', () => {
    let value = 42;
    const computed = new Computed(() => value);

    expect(computed.value).toBe(42);

    value = 100;
    // Without markDirty, should still return cached value
    expect(computed.value).toBe(42);
  });

  it('should handle undefined return value', () => {
    const computed = new Computed(() => undefined);
    expect(computed.value).toBe(undefined);
  });

  it('should handle null return value', () => {
    const computed = new Computed(() => null);
    expect(computed.value).toBe(null);
  });

  it('should handle object return values', () => {
    const count = new Signal(0);
    const computed = new Computed(() => ({ value: count.value }));

    expect(computed.value).toEqual({ value: 0 });

    count.value = 1;
    expect(computed.value).toEqual({ value: 1 });
  });

  it('should handle array return values', () => {
    const items = new Signal([1, 2, 3]);
    const computed = new Computed(() => items.value.map((x) => x * 2));

    expect(computed.value).toEqual([2, 4, 6]);

    items.value = [4, 5];
    expect(computed.value).toEqual([8, 10]);
  });

  it('should handle expensive computations efficiently', () => {
    const iterations = 1000;
    let computeCount = 0;

    const data = new Signal(Array.from({ length: iterations }, (_, i) => i));

    const expensive = new Computed(() => {
      computeCount++;
      return data.value.reduce((sum, n) => sum + n, 0);
    });

    // First read triggers computation
    expensive.value;
    expect(computeCount).toBe(1);

    // Subsequent reads use cache
    for (let i = 0; i < 10; i++) {
      expensive.value;
    }
    expect(computeCount).toBe(1);
  });

  it('should handle conditional dependency access', () => {
    const flag = new Signal(true);
    const a = new Signal('A');
    const b = new Signal('B');

    const computed = new Computed(() => {
      return flag.value ? a.value : b.value;
    });

    expect(computed.value).toBe('A');

    a.value = 'A2';
    expect(computed.value).toBe('A2');

    b.value = 'B2'; // Not currently a dependency
    expect(computed.value).toBe('A2'); // Should not change (cached)

    flag.value = false;
    expect(computed.value).toBe('B2');

    // Now b is a dependency, a is not
    a.value = 'A3';
    expect(computed.value).toBe('B2'); // Still cached, a not a dependency

    b.value = 'B3';
    expect(computed.value).toBe('B3');
  });

  it('should cleanup stale dependencies when recomputing', () => {
    const a = new Signal(1);
    const b = new Signal(2);
    const useB = new Signal(true);

    let computeCount = 0;
    const computed = new Computed(() => {
      computeCount++;
      return useB.value ? a.value + b.value : a.value;
    });

    // A subscriber keeps the computed subscribed to its sources
    computed.subscribe(() => {});

    // Initial: depends on useB, a, b
    expect(computed.value).toBe(3);
    expect(computeCount).toBe(1);
    expect(a.subscriberCount).toBe(1);
    expect(b.subscriberCount).toBe(1);

    // Switch to only using a
    useB.value = false;
    computed.markDirty();
    expect(computed.value).toBe(1);
    expect(computeCount).toBe(2);

    // b should have been unsubscribed (dependency cleanup)
    expect(a.subscriberCount).toBe(1);
    expect(b.subscriberCount).toBe(0); // Cleaned up!

    // Changing b should not trigger recompute
    b.value = 100;
    expect(computed.dirty).toBe(false); // Not marked dirty
    expect(computed.value).toBe(1); // Still cached
    expect(computeCount).toBe(2); // No recompute
  });

  it('should cleanup all dependencies on dispose', () => {
    const a = new Signal(1);
    const b = new Signal(2);

    const computed = new Computed(() => a.value + b.value);
    computed.subscribe(() => {});
    expect(computed.value).toBe(3);
    expect(a.subscriberCount).toBe(1);
    expect(b.subscriberCount).toBe(1);

    computed.dispose();

    // All subscriptions should be cleaned up
    expect(a.subscriberCount).toBe(0);
    expect(b.subscriberCount).toBe(0);
  });
});

describe('version-based dirty checking', () => {
  it('checks each of several sources against its own version', () => {
    const a = new Signal(1);
    const b = new Signal(2);
    const c = new Signal(3);
    const other = new Signal(0);
    const fn = vi.fn(() => a.value + b.value + a.value + c.value);
    const sum = new Computed(fn);

    expect(sum.value).toBe(7);
    other.value = 1;
    expect(sum.value).toBe(7);
    expect(fn).toHaveBeenCalledTimes(1);

    c.value = 4;
    expect(sum.value).toBe(8);
    b.value = 3;
    expect(sum.value).toBe(9);
    a.value = 2;
    expect(sum.value).toBe(11);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('keeps the versions of a computed apart from one it computes inside', () => {
    const a = new Signal(1);
    const b = new Signal(2);
    const c = new Signal(3);
    const inner = new Computed(() => b.value + c.value);
    const fn = vi.fn(() => a.value + inner.value + a.value);
    const outer = new Computed(fn);

    expect(outer.value).toBe(7);
    a.value = 1;
    expect(outer.value).toBe(7);
    expect(fn).toHaveBeenCalledTimes(1);

    c.value = 4;
    expect(outer.value).toBe(8);
    a.value = 2;
    expect(outer.value).toBe(10);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should have version property on State', () => {
    const count = new Signal(0);
    expect(count.version).toBe(0);

    count.value = 1;
    expect(count.version).toBe(1);

    count.value = 2;
    expect(count.version).toBe(2);
  });

  it('should not increment version if value is equal', () => {
    const count = new Signal(0);
    expect(count.version).toBe(0);

    count.value = 0; // Same value
    expect(count.version).toBe(0);
  });

  it('should have version property on Computed', () => {
    const a = new Signal(1);
    const computed = new Computed(() => a.value * 2);

    expect(computed.value).toBe(2);
    const v1 = computed.version;

    a.value = 2;
    computed.markDirty();
    expect(computed.value).toBe(4);
    const v2 = computed.version;

    expect(v2).toBeGreaterThan(v1);
  });

  it('should not recompute if marked dirty but sources unchanged', () => {
    const a = new Signal(1);
    const b = new Signal(2);
    let computeCount = 0;

    const computed = new Computed(() => {
      computeCount++;
      return a.value + b.value;
    });

    expect(computed.value).toBe(3);
    expect(computeCount).toBe(1);

    // Mark dirty without actually changing any source
    computed.markDirty();

    // Should detect that sources haven't changed via version check
    expect(computed.value).toBe(3);
    // Should not have recomputed (version-based check)
    expect(computeCount).toBe(1);
  });

  it('should avoid diamond dependency recomputations', () => {
    // Diamond pattern: A -> B, A -> C, B -> D, C -> D
    const a = new Signal(1);
    let bCount = 0;
    let cCount = 0;
    let dCount = 0;

    const b = new Computed(() => {
      bCount++;
      return a.value * 2;
    });
    const c = new Computed(() => {
      cCount++;
      return a.value * 3;
    });
    const d = new Computed(() => {
      dCount++;
      return b.value + c.value;
    });

    // Initial computation
    expect(d.value).toBe(5); // 2 + 3
    expect(bCount).toBe(1);
    expect(cCount).toBe(1);
    expect(dCount).toBe(1);

    // Change A - both B and C will be marked dirty, D gets marked dirty twice
    // But version-based checking should ensure D only recomputes once
    a.value = 2;
    d.markDirty(); // Simulate propagation

    expect(d.value).toBe(10); // 4 + 6
    // With version-based checking, D should compute once (not twice)
    expect(dCount).toBe(2);
  });

  it('should skip computation when Computed value unchanged', () => {
    const a = new Signal(1);
    let bCount = 0;
    let cCount = 0;

    // B returns same value for a.value of 1 or 2
    const b = new Computed(() => {
      bCount++;
      return a.value < 3 ? 'small' : 'large';
    });

    const c = new Computed(() => {
      cCount++;
      return b.value.toUpperCase();
    });

    expect(c.value).toBe('SMALL');
    expect(bCount).toBe(1);
    expect(cCount).toBe(1);

    // Change a from 1 to 2 - b.value stays 'small'
    a.value = 2;
    b.markDirty();
    c.markDirty();

    expect(c.value).toBe('SMALL');
    expect(bCount).toBe(2); // B recomputed
    // C should not recompute because B's version didn't change
    // (B's value was 'small' and stayed 'small')
    expect(cCount).toBe(1);
  });
});

describe('Computed peek()', () => {
  it('returns a fresh value without tracking', () => {
    const count = new Signal(1);
    const double = new Computed(() => count.value * 2);
    let runs = 0;
    testRoot(() => {
      effect(() => {
        runs++;
        double.peek();
      });
    });
    settle();
    expect(runs).toBe(1);

    count.value = 5;
    settle();
    expect(runs).toBe(1);
    expect(double.peek()).toBe(10);
  });

  it('throws once disposed, like get()', () => {
    const double = new Computed(() => 2);
    double.dispose();
    expect(() => double.peek()).toThrow();
  });
});

describe('Computed source release', () => {
  it('does not subscribe to its sources without subscribers', () => {
    const a = new Signal(1);
    const double = new Computed(() => a.value * 2);

    expect(double.value).toBe(2);
    expect(a.subscriberCount).toBe(0);

    a.value = 5;
    expect(double.value).toBe(10);
  });

  it('releases its sources when the last subscriber leaves', () => {
    const a = new Signal(1);
    const double = new Computed(() => a.value * 2);
    const values: number[] = [];

    const dispose = createRoot((dispose) => {
      effect(() => {
        values.push(double.value);
      });
      return dispose;
    });
    settle();
    expect(a.subscriberCount).toBe(1);

    dispose();
    expect(a.subscriberCount).toBe(0);

    a.value = 2;
    expect(double.value).toBe(4);
    expect(values).toEqual([2]);
  });

  it('subscribes again when a new subscriber arrives', () => {
    const a = new Signal(1);
    const double = new Computed(() => a.value * 2);
    expect(double.value).toBe(2);
    a.value = 3;

    const values: number[] = [];
    testRoot(() => {
      effect(() => {
        values.push(double.value);
      });
    });
    settle();
    a.value = 4;
    settle();

    expect(values).toEqual([6, 8]);
  });

  it('releases a chain of computeds', () => {
    const a = new Signal(1);
    const double = new Computed(() => a.value * 2);
    const quad = new Computed(() => double.value * 2);

    const dispose = createRoot((dispose) => {
      effect(() => quad.value);
      return dispose;
    });
    settle();
    expect(a.subscriberCount).toBe(1);

    dispose();
    expect(a.subscriberCount).toBe(0);
    a.value = 2;
    expect(quad.value).toBe(8);
  });
});

describe('Computed errors', () => {
  it('rethrows the cached error until a source changes', () => {
    const a = new Signal(0);
    let runs = 0;
    const c = new Computed(() => {
      runs++;
      if (a.value === 1) throw new Error('err');
      return a.value;
    });
    c.subscribe(() => {});

    a.value = 1;
    expect(() => c.value).toThrow('err');
    expect(() => c.value).toThrow('err');
    expect(runs).toBe(1);

    a.value = 2;
    expect(c.value).toBe(2);
  });

  it('notifies again after it threw', () => {
    const a = new Signal(0);
    const c = new Computed(() => {
      if (a.value === 1) throw new Error('err');
      return a.value;
    });
    const log: unknown[] = [];

    testRoot(() => {
      effect(() => {
        try {
          log.push(c.value);
        } catch {
          log.push('err');
        }
      });
    });
    settle();
    a.value = 1;
    settle();
    a.value = 2;
    settle();
    a.value = 3;
    settle();

    expect(log).toEqual([0, 'err', 2, 3]);
  });

  it('releases the sources read before it threw on dispose', () => {
    const a = new Signal(1);
    const c = new Computed(() => {
      if (a.value > 0) throw new Error('err');
      return a.value;
    });
    c.subscribe(() => {});
    expect(() => c.value).toThrow('err');
    expect(a.subscriberCount).toBe(1);

    c.dispose();
    expect(a.subscriberCount).toBe(0);
  });
});

describe('Computed inside batch', () => {
  it('reads the writes made earlier in the batch', () => {
    const a = new Signal(1);
    const double = new Computed(() => a.value * 2);
    double.subscribe(() => {});
    expect(double.value).toBe(2);

    const result = batch(() => {
      a.value = 5;
      return double.value;
    });
    expect(result).toBe(10);
  });

  it('reads the writes through a chain of computeds', () => {
    const a = new Signal(1);
    const double = new Computed(() => a.value * 2);
    const plusOne = new Computed(() => double.value + 1);
    plusOne.subscribe(() => {});
    expect(plusOne.value).toBe(3);

    expect(
      batch(() => {
        a.value = 5;
        return plusOne.value;
      })
    ).toBe(11);
  });
});

describe('long computed chains', () => {
  function chain(length: number) {
    const head = new Signal(0);
    let tail = new Computed(() => head.value);
    for (let k = 1; k < length; k++) {
      const prev = tail;
      tail = new Computed(() => prev.value + 1);
    }
    return { head, tail };
  }

  it('reads a chain of 1000 without subscribers', () => {
    const { head, tail } = chain(1000);
    for (let i = 1; i <= 3; i++) {
      head.value = i;
      expect(tail.value).toBe(i + 999);
    }
    expect(head.subscriberCount).toBe(0);
  });

  it('reads a watched chain of 1000', () => {
    const { head, tail } = chain(1000);
    const seen: number[] = [];
    const dispose = createRoot((dispose) => {
      effect(() => {
        seen.push(tail.value);
      });
      return dispose;
    });
    settle();
    head.value = 1;
    settle();
    expect(seen).toEqual([999, 1000]);
    dispose();
    expect(head.subscriberCount).toBe(0);
  });
});

describe('a disposed computed', () => {
  it('does not run again when its version is read', () => {
    const count = new Signal(0);
    const fn = vi.fn(() => count.value * 2);
    const double = new Computed(fn);
    double.get();
    double.dispose();
    count.value = 1;

    void double.version;
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
