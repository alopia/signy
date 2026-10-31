/**
 * Tests for reactive effects
 */

import { describe, it, expect, vi } from 'vitest';
import {
  Effect,
  effect,
  createRoot,
  onCleanup,
  onMount,
  on,
  getOwner,
  runWithOwner,
  type Owner,
  Signal,
  batch,
} from '../../src/reactivity';
import { microtask, settle } from '../support/tick';
import { getPendingEffectsCount } from '../../src/reactivity/signal/internal';
import { expectLogged } from '../support/console';
import { testRoot } from '../support/root';

describe('Effect class', () => {
  describe('constructor', () => {
    it('should schedule initial run as microtask', async () => {
      const fn = vi.fn();

      testRoot(() => {
        new Effect(fn);
        expect(fn).not.toHaveBeenCalled(); // Not yet
        settle();
        expect(fn).toHaveBeenCalledTimes(1);
      });
    });

    it('should receive initial value', async () => {
      let receivedValue: number | undefined;

      testRoot(() => {
        new Effect((prev) => {
          receivedValue = prev;
          return 42;
        }, 10);

        settle();
        expect(receivedValue).toBe(10);
      });
    });

    it('should accept options with name', async () => {
      testRoot(() => {
        const effect = new Effect(() => {}, undefined, { name: 'test-effect' });
        expect(effect.name).toBe('test-effect');
      });
    });
  });

  describe('run()', () => {
    it('should execute the effect function', async () => {
      const fn = vi.fn();

      testRoot(() => {
        const effect = new Effect(fn);
        settle();

        fn.mockClear();
        effect.run();
        expect(fn).toHaveBeenCalledTimes(1);
      });
    });

    it('should not run if disposed', async () => {
      const fn = vi.fn();

      testRoot(() => {
        const effect = new Effect(fn);
        settle();

        effect.dispose();
        fn.mockClear();
        effect.run();
        expect(fn).not.toHaveBeenCalled();
      });
    });
  });

  describe('dispose()', () => {
    it('should mark effect as disposed', async () => {
      testRoot(() => {
        const effect = new Effect(() => {});
        expect(effect.disposed).toBe(false);
        effect.dispose();
        expect(effect.disposed).toBe(true);
      });
    });

    it('should run cleanup functions', async () => {
      const cleanup = vi.fn();

      await createRoot(async (dispose) => {
        new Effect(() => {
          onCleanup(cleanup);
        });

        settle();
        expect(cleanup).not.toHaveBeenCalled();

        dispose();
        expect(cleanup).toHaveBeenCalledTimes(1);
      });
    });

    it('should be idempotent', async () => {
      testRoot(() => {
        const effect = new Effect(() => {});
        effect.dispose();
        effect.dispose();
        expect(effect.disposed).toBe(true);
      });
    });
  });

  describe('value getter', () => {
    it('should return last value from effect function', async () => {
      testRoot(() => {
        const effect = new Effect(() => 42);
        settle();
        expect(effect.value).toBe(42);
      });
    });
  });
});

describe('effect', () => {
  it('should create and return an Effect', async () => {
    testRoot(() => {
      const eff = effect(() => {});
      expect(eff).toBeInstanceOf(Effect);
    });
  });

  it('should run when dependencies change', async () => {
    const values: number[] = [];

    testRoot(() => {
      const count = new Signal(0);

      effect(() => {
        values.push(count.value);
      });

      settle();
      expect(values).toEqual([0]);

      count.value = 1;
      settle();
      expect(values).toEqual([0, 1]);

      count.value = 2;
      settle();
      expect(values).toEqual([0, 1, 2]);
    });
  });

  it('runs a write made after settle() in the microtask already queued', async () => {
    const values: number[] = [];
    const count = new Signal(0);
    testRoot(() => {
      effect(() => {
        values.push(count.value);
      });
    });
    count.value = 1;
    settle();
    // The microtask queued for the first run is still pending
    count.value = 2;
    await microtask();
    expect(values).toEqual([1, 2]);

    count.value = 3;
    await microtask();
    expect(values).toEqual([1, 2, 3]);
  });

  it('should not run after disposal', async () => {
    const values: number[] = [];

    testRoot(() => {
      const count = new Signal(0);

      const eff = effect(() => {
        values.push(count.value);
      });

      settle();
      eff.dispose();

      count.value = 1;
      settle();

      expect(values).toEqual([0]);
    });
  });

  it('should receive previous value', async () => {
    const history: Array<[number | undefined, number]> = [];

    testRoot(() => {
      const count = new Signal(0);

      effect((prev: number | undefined) => {
        const current = count.value;
        history.push([prev, current]);
        return current;
      });

      settle();
      count.value = 1;
      settle();
      count.value = 2;
      settle();

      expect(history).toEqual([
        [undefined, 0],
        [0, 1],
        [1, 2],
      ]);
    });
  });

  it('should batch multiple signal updates', async () => {
    const values: string[] = [];

    testRoot(() => {
      const first = new Signal('A');
      const last = new Signal('B');

      effect(() => {
        values.push(`${first.value} ${last.value}`);
      });

      settle();
      expect(values).toEqual(['A B']);

      batch(() => {
        first.value = 'X';
        last.value = 'Y';
      });

      settle();
      expect(values).toEqual(['A B', 'X Y']);
    });
  });
});

describe('createRoot', () => {
  it('should provide disposal function', () => {
    const cleanup = vi.fn();

    const dispose = createRoot((dispose) => {
      effect(() => {
        onCleanup(cleanup);
      });
      return dispose;
    });
    settle();

    dispose();
    expect(cleanup).toHaveBeenCalled();
  });

  it('should return the result of the function', () => {
    const result = createRoot(() => 42);
    expect(result).toBe(42);
  });

  it('should create unowned root when function takes no args', () => {
    // When function.length === 0, it creates an unowned root
    createRoot(() => {
      // This effect is in an unowned root
      effect(() => {});
    });
    // No dispose function provided, so we can't clean up
    // But this should not throw
  });

  it('should support nested roots', async () => {
    const outerCleanup = vi.fn();
    const innerCleanup = vi.fn();

    await createRoot(async (outerDispose) => {
      effect(() => {
        onCleanup(outerCleanup);
      });

      let innerDispose: () => void;
      createRoot((dispose) => {
        effect(() => {
          onCleanup(innerCleanup);
        });
        innerDispose = dispose;
      });

      settle();
      expect(innerCleanup).not.toHaveBeenCalled(); // Not disposed yet
      expect(outerCleanup).not.toHaveBeenCalled();

      // Now dispose inner root
      innerDispose!();
      expect(innerCleanup).toHaveBeenCalled();
      expect(outerCleanup).not.toHaveBeenCalled();

      outerDispose();
      expect(outerCleanup).toHaveBeenCalled();
    });
  });
});

describe('onCleanup', () => {
  it('should register cleanup function', async () => {
    const cleanup = vi.fn();

    await createRoot(async (dispose) => {
      effect(() => {
        onCleanup(cleanup);
      });

      settle();
      expect(cleanup).not.toHaveBeenCalled();

      dispose();
      expect(cleanup).toHaveBeenCalledTimes(1);
    });
  });

  it('should run cleanups in reverse order', async () => {
    const order: number[] = [];

    await createRoot(async (dispose) => {
      effect(() => {
        onCleanup(() => order.push(1));
        onCleanup(() => order.push(2));
        onCleanup(() => order.push(3));
      });

      settle();
      dispose();

      expect(order).toEqual([3, 2, 1]);
    });
  });

  it('should run cleanup before re-execution', async () => {
    const log: string[] = [];

    await createRoot(async (dispose) => {
      const count = new Signal(0);

      effect(() => {
        const c = count.value;
        log.push(`run-${c}`);
        onCleanup(() => log.push(`cleanup-${c}`));
      });

      settle();
      expect(log).toEqual(['run-0']);

      count.value = 1;
      settle();
      expect(log).toEqual(['run-0', 'cleanup-0', 'run-1']);

      dispose();
      expect(log).toEqual(['run-0', 'cleanup-0', 'run-1', 'cleanup-1']);
    });
  });

  it('should return the cleanup function', async () => {
    testRoot(() => {
      const cleanup = vi.fn();
      const returned = onCleanup(cleanup);
      expect(returned).toBe(cleanup);
    });
  });
});

describe('onMount', () => {
  it('should run once after mount', async () => {
    const fn = vi.fn();

    testRoot(() => {
      onMount(fn);

      expect(fn).not.toHaveBeenCalled(); // Scheduled as microtask

      settle();
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  it('should not track dependencies', async () => {
    const fn = vi.fn();

    testRoot(() => {
      const count = new Signal(0);

      onMount(() => {
        count.value; // Read but don't track
        fn();
      });

      settle();
      expect(fn).toHaveBeenCalledTimes(1);

      count.value = 1;
      settle();
      expect(fn).toHaveBeenCalledTimes(1); // Still 1, not re-run
    });
  });

  it('should register onCleanup on parent owner, not the mount effect', async () => {
    const cleanup = vi.fn();
    const mountFn = vi.fn();

    await createRoot(async (dispose) => {
      onMount(() => {
        mountFn();
        // Register cleanup - should be called when root is disposed,
        // not immediately after mount effect runs
        onCleanup(cleanup);
      });

      settle();

      // Mount callback should have run
      expect(mountFn).toHaveBeenCalledTimes(1);

      // Cleanup should NOT have run yet - this was the bug!
      expect(cleanup).not.toHaveBeenCalled();

      // Now dispose the root
      dispose();

      // Cleanup should run when root is disposed
      expect(cleanup).toHaveBeenCalledTimes(1);
    });
  });
});

describe('on', () => {
  it('should track explicit dependencies', async () => {
    const values: number[] = [];

    testRoot(() => {
      const count = new Signal(0);

      effect(
        on(
          () => count.value,
          (value) => {
            values.push(value);
          }
        )
      );

      settle();
      expect(values).toEqual([0]);

      count.value = 5;
      settle();
      expect(values).toEqual([0, 5]);
    });
  });

  it('does not track what the callback reads', () => {
    const runs: Array<[number, number]> = [];

    testRoot(() => {
      const count = new Signal(0);
      const other = new Signal(0);

      effect(
        on(
          () => count.value,
          (value) => {
            runs.push([value, other.value]);
          }
        )
      );

      settle();
      other.value = 1;
      settle();
      expect(runs).toEqual([[0, 0]]);

      count.value = 1;
      settle();
      expect(runs).toEqual([
        [0, 0],
        [1, 1],
      ]);
    });
  });

  it('should support defer option', async () => {
    const values: number[] = [];

    testRoot(() => {
      const count = new Signal(0);

      effect(
        on(
          () => count.value,
          (value) => {
            values.push(value);
          },
          { defer: true }
        )
      );

      settle();
      expect(values).toEqual([]); // Deferred, no initial run

      count.value = 1;
      settle();
      expect(values).toEqual([1]);
    });
  });

  it('should track previous value', async () => {
    const history: Array<[number | undefined, number]> = [];

    testRoot(() => {
      const count = new Signal(0);

      effect(
        on(
          () => count.value,
          (value, prevValue) => {
            history.push([prevValue, value]);
          }
        )
      );

      settle();
      count.value = 1;
      settle();
      count.value = 2;
      settle();

      expect(history).toEqual([
        [undefined, 0],
        [0, 1],
        [1, 2],
      ]);
    });
  });

  it('should support array of dependencies', async () => {
    const values: Array<[number, number]> = [];

    testRoot(() => {
      const a = new Signal(1);
      const b = new Signal(2);

      effect(
        on([() => a.value, () => b.value], (val) => {
          const [aVal, bVal] = val as [number, number];
          values.push([aVal, bVal]);
        })
      );

      settle();
      expect(values).toEqual([[1, 2]]);

      a.value = 10;
      settle();
      expect(values).toEqual([
        [1, 2],
        [10, 2],
      ]);

      b.value = 20;
      settle();
      expect(values).toEqual([
        [1, 2],
        [10, 2],
        [10, 20],
      ]);
    });
  });
});

describe('getOwner / runWithOwner', () => {
  it('should return current owner', async () => {
    let capturedOwner: Owner | null = null;

    testRoot(() => {
      effect(() => {
        capturedOwner = getOwner();
      });

      settle();
      expect(capturedOwner).not.toBeNull();
    });
  });

  it('should return null outside reactive context', () => {
    // Outside createRoot, owner might be null or UNOWNED
    const owner = getOwner();
    expect(owner).toBeNull();
  });

  it('should run function with specified owner', async () => {
    let outerOwner: Owner | null = null;
    let innerOwner: Owner | null = null;

    testRoot(() => {
      effect(() => {
        outerOwner = getOwner();
      });

      settle();

      runWithOwner(outerOwner, () => {
        innerOwner = getOwner();
      });

      expect(innerOwner).toBe(outerOwner);
    });
  });

  it('should restore previous owner after runWithOwner', async () => {
    testRoot(() => {
      const originalOwner = getOwner();

      runWithOwner(null, () => {
        expect(getOwner()).toBeNull();
      });

      expect(getOwner()).toBe(originalOwner);
    });
  });
});

describe('effect ownership', () => {
  it('should dispose child effects when parent disposes', async () => {
    const childRuns: number[] = [];

    testRoot(() => {
      const count = new Signal(0);

      let innerDispose: () => void;
      createRoot((d) => {
        effect(() => {
          childRuns.push(count.value);
        });
        innerDispose = d;
      });

      settle();
      expect(childRuns).toEqual([0]);

      // Dispose the inner root
      innerDispose!();

      count.value = 1;
      settle();
      expect(childRuns).toEqual([0]); // Child was disposed, no new runs
    });
  });
});

describe('error handling', () => {
  it('should continue running other cleanups if one throws', async () => {
    const cleanup1 = vi.fn();
    const cleanup2 = vi.fn(() => {
      throw new Error('cleanup error');
    });
    const cleanup3 = vi.fn();

    await createRoot(async (dispose) => {
      effect(() => {
        onCleanup(cleanup1);
        onCleanup(cleanup2);
        onCleanup(cleanup3);
      });

      settle();

      // Dispose should run all cleanups even if one throws
      // The error is logged but doesn't stop execution
      dispose();

      expect(cleanup3).toHaveBeenCalled();
      expect(cleanup2).toHaveBeenCalled();
      expect(cleanup1).toHaveBeenCalled();
    });
    expectLogged('error', 'reactivity:cleanup-error');
  });

  it('keeps running effects after one throws', () => {
    const count = new Signal(0);
    const seen: number[] = [];

    testRoot(() => {
      effect(() => {
        if (count.value === 1) throw new Error('boom');
      });
      effect(() => {
        seen.push(count.value);
      });
    });
    settle();

    count.value = 1;
    settle();
    expectLogged('error', 'reactivity:effect-error');

    count.value = 2;
    settle();

    expect(seen).toEqual([0, 1, 2]);
  });

  it('runs later effects after a throw in a microtask flush', async () => {
    const count = new Signal(0);
    const seen: number[] = [];

    testRoot(() => {
      effect(() => {
        if (count.value === 1) throw new Error('boom');
      });
      effect(() => {
        seen.push(count.value);
      });
    });
    await microtask();

    count.value = 1;
    await microtask();
    count.value = 2;
    await microtask();

    expectLogged('error', 'reactivity:effect-error');
    expect(seen).toEqual([0, 1, 2]);
  });
});

describe('edge cases', () => {
  it('should handle effect with no dependencies', async () => {
    const fn = vi.fn();

    testRoot(() => {
      effect(() => {
        fn();
        // No signals read = no dependencies
      });

      settle();
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  it('should handle effect that changes its dependencies', async () => {
    const log: string[] = [];

    testRoot(() => {
      const flag = new Signal(true);
      const a = new Signal('A');
      const b = new Signal('B');

      effect(() => {
        if (flag.value) {
          log.push(`a: ${a.value}`);
        } else {
          log.push(`b: ${b.value}`);
        }
      });

      settle();
      expect(log).toEqual(['a: A']);

      a.value = 'A2';
      settle();
      expect(log).toEqual(['a: A', 'a: A2']);

      flag.value = false;
      settle();
      expect(log).toEqual(['a: A', 'a: A2', 'b: B']);

      // After switching to 'b' branch, 'a' is no longer a dependency
      // With dependency cleanup, changing 'a' should NOT trigger effect
      const lengthBeforeA = log.length;
      a.value = 'A3';
      settle();
      expect(log.length).toBe(lengthBeforeA); // No new entries!

      const lengthBeforeB = log.length;
      b.value = 'B2';
      settle();
      // This should definitely trigger since b is now a dependency
      expect(log.length).toBeGreaterThan(lengthBeforeB);
      expect(log[log.length - 1]).toBe('b: B2');
    });
  });

  it('should cleanup stale dependencies on re-run', async () => {
    testRoot(() => {
      const a = new Signal(1);
      const b = new Signal(2);
      const useB = new Signal(true);

      let runCount = 0;
      effect(() => {
        runCount++;
        if (useB.value) {
          return a.value + b.value;
        } else {
          return a.value;
        }
      });

      settle();
      expect(runCount).toBe(1);
      expect(a.subscriberCount).toBe(1);
      expect(b.subscriberCount).toBe(1);

      // Switch to only using 'a'
      useB.value = false;
      settle();
      expect(runCount).toBe(2);

      // 'b' should have been unsubscribed (dependency cleanup)
      expect(a.subscriberCount).toBe(1);
      expect(b.subscriberCount).toBe(0); // Cleaned up!

      // Changing 'b' should not trigger effect
      b.value = 100;
      settle();
      expect(runCount).toBe(2); // No re-run
    });
  });

  it('should cleanup all dependencies on dispose', async () => {
    await createRoot(async (dispose) => {
      const a = new Signal(1);
      const b = new Signal(2);

      effect(() => {
        return a.value + b.value;
      });

      settle();
      expect(a.subscriberCount).toBe(1);
      expect(b.subscriberCount).toBe(1);

      dispose();

      // All subscriptions should be cleaned up
      expect(a.subscriberCount).toBe(0);
      expect(b.subscriberCount).toBe(0);
    });
  });
});

describe('disposal before the first flush', () => {
  it('skips the effect and leaves the queue empty after the flush', () => {
    let runs = 0;
    const dispose = createRoot((dispose) => {
      effect(() => {
        runs++;
      });
      return dispose;
    });
    expect(getPendingEffectsCount()).toBeGreaterThan(0);
    dispose();
    settle();
    expect(runs).toBe(0);
    expect(getPendingEffectsCount()).toBe(0);
  });
});

describe('an effect that disposes itself while it runs', () => {
  it('leaves the sources it read and runs the cleanups added after', () => {
    const count = new Signal(0);
    const cleanup = vi.fn();
    const child = vi.fn();
    testRoot(() => {
      const holder: { e: Effect | null } = { e: null };
      holder.e = effect(() => {
        count.value;
        holder.e?.dispose();
        onCleanup(cleanup);
        effect(() => child(count.value));
      });
    });
    settle();

    expect(count.subscriberCount).toBe(0);
    expect(cleanup).toHaveBeenCalledTimes(1);
    count.value = 1;
    settle();
    expect(child).not.toHaveBeenCalled();
  });
});
