/**
 * Tests for transitions
 */

import { describe, it, expect, vi } from 'vitest';
import {
  Transition,
  startTransition,
  useTransition,
  transition,
  isTransition,
  getGlobalPending,
  getTransitionPromise,
  Signal,
  effect,
} from '../../src/reactivity';
import { testRoot } from '../support/root';

// Helper to wait for promises/microtasks
const flushMicrotasks = () =>
  new Promise<void>((resolve) => queueMicrotask(resolve));

describe('Transition class', () => {
  describe('constructor', () => {
    it('should create transition with unique id', () => {
      const t1 = new Transition();
      const t2 = new Transition();
      expect(t1.id).not.toBe(t2.id);
    });

    it('should accept name option', () => {
      const t = new Transition({ name: 'my-transition' });
      expect(t.name).toBe('my-transition');
    });

    it('should generate default name if not provided', () => {
      const t = new Transition();
      expect(t.name).toMatch(/transition-\d+/);
    });

    it('should start with isPending false', () => {
      const t = new Transition();
      expect(t.isPending.value).toBe(false);
    });
  });

  describe('isPending getter', () => {
    it('should return a signal', () => {
      const t = new Transition();
      expect(t.isPending).toBeInstanceOf(Signal);
      expect(t.isPending.value).toBe(false);
    });
  });

  describe('isRunning getter', () => {
    it('should return false when no transition running', () => {
      const t = new Transition();
      expect(t.isRunning).toBe(false);
    });

    it('should return true during transition', async () => {
      const t = new Transition();

      const promise = t.start(() => {});

      expect(t.isRunning).toBe(true);

      await promise;
      expect(t.isRunning).toBe(false);
    });
  });

  describe('isExecuting getter', () => {
    it('should return false when not executing', () => {
      const t = new Transition();
      expect(t.isExecuting).toBe(false);
    });

    it('should return true only while the queued functions run', async () => {
      const t = new Transition();
      let wasExecuting = false;

      const promise = t.start(() => {
        wasExecuting = t.isExecuting;
      });

      expect(t.isExecuting).toBe(false); // Not yet executing

      await promise;
      expect(wasExecuting).toBe(true);
      expect(t.isExecuting).toBe(false);
    });
  });

  describe('promise getter', () => {
    it('should return null when no transition', () => {
      const t = new Transition();
      expect(t.promise).toBeNull();
    });

    it('should return promise during transition', async () => {
      const t = new Transition();

      const promise = t.start(() => {});
      expect(t.promise).toBeInstanceOf(Promise);

      await promise;
      expect(t.promise).toBeNull();
    });
  });

  describe('start()', () => {
    it('should return a promise', () => {
      const t = new Transition();
      const result = t.start(() => {});
      expect(result).toBeInstanceOf(Promise);
    });

    it('runs after the next frame, so isPending can paint first', async () => {
      const frames: FrameRequestCallback[] = [];
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
        frames.push(cb)
      );
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        const t = new Transition();
        const fn = vi.fn();
        void t.start(fn);

        await vi.advanceTimersByTimeAsync(0);
        expect(fn).not.toHaveBeenCalled();
        expect(t.isPending.value).toBe(true);

        frames.forEach((frame) => frame(0));
        await vi.advanceTimersByTimeAsync(0);
        expect(fn).toHaveBeenCalledTimes(1);
        expect(t.isPending.value).toBe(false);
      } finally {
        vi.useRealTimers();
        vi.unstubAllGlobals();
      }
    });

    it('runs after a timeout when no frame comes, as in a hidden tab', async () => {
      vi.stubGlobal('requestAnimationFrame', () => 1);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        const t = new Transition();
        const fn = vi.fn();
        void t.start(fn);

        await vi.advanceTimersByTimeAsync(99);
        expect(fn).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(fn).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
        vi.unstubAllGlobals();
      }
    });

    it('runs in the next task without requestAnimationFrame', async () => {
      vi.stubGlobal('requestAnimationFrame', undefined);
      try {
        const t = new Transition();
        const fn = vi.fn();
        void t.start(fn);

        await flushMicrotasks();
        expect(fn).not.toHaveBeenCalled();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(fn).toHaveBeenCalledTimes(1);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('should set isPending during transition', async () => {
      const t = new Transition();
      const pendingStates: boolean[] = [];

      pendingStates.push(t.isPending.value); // Before start

      const promise = t.start(() => {
        pendingStates.push(t.isPending.value); // During execution
      });

      pendingStates.push(t.isPending.value); // After start, before the updates run

      await promise;
      pendingStates.push(t.isPending.value); // After completion

      expect(pendingStates).toEqual([false, true, true, false]);
    });

    it('should batch updates', async () => {
      const t = new Transition();
      const a = new Signal(0);
      const b = new Signal(0);

      await t.start(() => {
        a.value = 1;
        b.value = 2;
      });

      expect(a.value).toBe(1);
      expect(b.value).toBe(2);
    });

    it('should queue multiple calls before the updates run', async () => {
      const t = new Transition();
      const order: number[] = [];

      const promise1 = t.start(() => order.push(1));
      const promise2 = t.start(() => order.push(2));
      const promise3 = t.start(() => order.push(3));

      // One batch runs them all, so the first caller sees every update
      await promise1;
      expect(order).toEqual([1, 2, 3]);
      await Promise.all([promise2, promise3]);
    });

    it('should execute immediately if already executing', async () => {
      const t = new Transition();
      const order: string[] = [];

      await t.start(() => {
        order.push('outer-start');
        t.start(() => order.push('inner'));
        order.push('outer-end');
      });

      expect(order).toEqual(['outer-start', 'inner', 'outer-end']);
    });
  });

  describe('toTuple()', () => {
    it('should return [isPending, start] tuple', () => {
      const t = new Transition();
      const [isPending, start] = t.toTuple();

      expect(isPending).toBeInstanceOf(Signal);
      expect(typeof start).toBe('function');
    });

    it('should return bound start function', async () => {
      const t = new Transition();
      const [isPending, start] = t.toTuple();

      await start(() => {});

      expect(isPending.value).toBe(false);
    });
  });
});

describe('startTransition', () => {
  it('should start a transition on global instance', async () => {
    const fn = vi.fn();

    await startTransition(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should return a promise', () => {
    const result = startTransition(() => {});
    expect(result).toBeInstanceOf(Promise);
  });

  it('should defer execution', async () => {
    const fn = vi.fn();

    const promise = startTransition(fn);
    await flushMicrotasks();
    expect(fn).not.toHaveBeenCalled();

    await promise;
    expect(fn).toHaveBeenCalled();
  });

  it('should batch signal updates', async () => {
    const count = new Signal(0);
    let effectRuns = 0;

    await testRoot(async () => {
      effect(() => {
        count.value;
        effectRuns++;
      });

      await flushMicrotasks();

      await startTransition(() => {
        count.value = 1;
        count.value = 2;
        count.value = 3;
      });

      await flushMicrotasks();
      // Should batch all updates
      expect(count.value).toBe(3);
      expect(effectRuns).toBe(2);
    });
  });
});

describe('useTransition', () => {
  it('should return [isPending, start] tuple', () => {
    const [isPending, start] = useTransition();

    expect(isPending).toBeInstanceOf(Signal);
    expect(typeof start).toBe('function');
  });

  it('should create isolated pending state', async () => {
    const [isPending1, start1] = useTransition();
    const [isPending2, _start2] = useTransition();

    expect(isPending1.value).toBe(false);
    expect(isPending2.value).toBe(false);

    const promise1 = start1(() => {});

    expect(isPending1.value).toBe(true);
    expect(isPending2.value).toBe(false); // Independent

    await promise1;
    expect(isPending1.value).toBe(false);
  });

  it('should create new transition each call', () => {
    const [isPending1, start1] = useTransition();
    const [isPending2, start2] = useTransition();

    expect(isPending1).not.toBe(isPending2);
    expect(start1).not.toBe(start2);
  });
});

describe('transition', () => {
  it('should return [isPending, start] tuple', () => {
    const [isPending, start] = transition();

    expect(isPending).toBeInstanceOf(Signal);
    expect(typeof start).toBe('function');
  });

  it('should accept name parameter', async () => {
    const [_isPending, start] = transition('named-transition');

    // Can't easily verify name, but should not throw
    await start(() => {});
  });

  it('should create isolated instances', async () => {
    const [isPending1, start1] = transition('t1');
    const [isPending2, _start2] = transition('t2');

    const promise1 = start1(() => {});

    expect(isPending1.value).toBe(true);
    expect(isPending2.value).toBe(false);

    await promise1;
  });
});

describe('isTransition', () => {
  it('should return false when no transition active', () => {
    expect(isTransition()).toBe(false);
  });

  it('should return true during global transition', async () => {
    const promise = startTransition(() => {
      // Check during execution
      expect(isTransition()).toBe(true);
    });

    // isRunning is true immediately after start
    expect(isTransition()).toBe(true);

    await promise;
    expect(isTransition()).toBe(false);
  });
});

describe('getGlobalPending', () => {
  it('should return signal', () => {
    const pending = getGlobalPending();
    expect(pending).toBeInstanceOf(Signal);
    expect(pending.value).toBe(false);
  });

  it('should reflect global transition state', async () => {
    const pending = getGlobalPending();

    expect(pending.value).toBe(false);

    const promise = startTransition(() => {});
    expect(pending.value).toBe(true);

    await promise;
    expect(pending.value).toBe(false);
  });
});

describe('getTransitionPromise', () => {
  it('should return null when no transition', () => {
    expect(getTransitionPromise()).toBeNull();
  });

  it('should return promise during transition', async () => {
    const promise = startTransition(() => {});
    const done = getTransitionPromise();
    expect(done).toBeInstanceOf(Promise);

    await promise;
    await done;
    expect(getTransitionPromise()).toBeNull();
  });
});

describe('transition with reactivity', () => {
  it('should trigger effects after transition completes', async () => {
    const values: number[] = [];

    await testRoot(async () => {
      const count = new Signal(0);

      effect(() => {
        values.push(count.value);
      });

      await flushMicrotasks();
      expect(values).toEqual([0]);

      await startTransition(() => {
        count.value = 10;
      });

      await flushMicrotasks();
      expect(values).toEqual([0, 10]);
    });
  });

  it('should work with multiple signals', async () => {
    await testRoot(async () => {
      const a = new Signal(1);
      const b = new Signal(2);

      await startTransition(() => {
        a.value = 10;
        b.value = 20;
      });

      expect(a.value).toBe(10);
      expect(b.value).toBe(20);
    });
  });

  it('should allow reading isPending in effects', async () => {
    const pendingStates: boolean[] = [];

    await testRoot(async () => {
      const [isPending, start] = useTransition();

      effect(() => {
        pendingStates.push(isPending.value);
      });

      await flushMicrotasks();

      await start(() => {
        // Trigger pending state change
      });

      await flushMicrotasks();

      // Should have captured pending state changes
      expect(pendingStates).toContain(false);
    });
  });
});

describe('concurrent transitions', () => {
  it('should handle multiple independent transitions', async () => {
    const [isPending1, start1] = useTransition();
    const [isPending2, start2] = useTransition();

    const promise1 = start1(() => {});
    const promise2 = start2(() => {});

    expect(isPending1.value).toBe(true);
    expect(isPending2.value).toBe(true);

    await Promise.all([promise1, promise2]);

    expect(isPending1.value).toBe(false);
    expect(isPending2.value).toBe(false);
  });

  it('should track each transition independently', async () => {
    const t1 = new Transition({ name: 't1' });
    const t2 = new Transition({ name: 't2' });

    // Start first transition
    const p1 = t1.start(() => {});
    expect(t1.isPending.value).toBe(true);
    expect(t2.isPending.value).toBe(false);

    // Wait for first to complete before starting second
    await p1;
    expect(t1.isPending.value).toBe(false);

    // Start second transition
    const p2 = t2.start(() => {});
    expect(t1.isPending.value).toBe(false);
    expect(t2.isPending.value).toBe(true);

    await p2;
    expect(t2.isPending.value).toBe(false);
  });
});

describe('errors', () => {
  it('rejects the startTransition promise with the error', async () => {
    await expect(
      startTransition(() => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(isTransition()).toBe(false);
    expect(getGlobalPending().value).toBe(false);
  });

  it('runs the next transition after a failed one', async () => {
    const t = new Transition();
    await expect(
      t.start(() => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    const value = new Signal(0);
    await t.start(() => {
      value.value = 1;
    });
    expect(value.value).toBe(1);
  });
});

describe('errors in one of several updates', () => {
  it('runs the others and rejects only the caller whose update threw', async () => {
    const t = new Transition();
    const value = new Signal(0);
    const failed = t.start(() => {
      throw new Error('boom');
    });
    const done = t.start(() => {
      value.value = 1;
    });

    await expect(failed).rejects.toThrow('boom');
    await expect(done).resolves.toBeUndefined();
    expect(value.value).toBe(1);
    expect(t.isPending.value).toBe(false);
  });

  it('settles an update added while the others run on its own', async () => {
    const t = new Transition();
    let nested: Promise<void> | undefined;
    const outer = t.start(() => {
      nested = t.start(() => {
        throw new Error('inner');
      });
    });

    await expect(outer).resolves.toBeUndefined();
    await expect(nested!).rejects.toThrow('inner');
  });
});

describe('edge cases', () => {
  it('should handle empty transition', async () => {
    const t = new Transition();
    await t.start(() => {});
    expect(t.isPending.value).toBe(false);
  });

  it('should handle nested startTransition calls', async () => {
    const order: string[] = [];

    await startTransition(() => {
      order.push('outer');
      startTransition(() => {
        order.push('inner');
      });
    });

    await flushMicrotasks();

    expect(order).toContain('outer');
    // Inner might be executed immediately or queued
  });

  it('should handle rapid successive calls', async () => {
    const [_isPending, start] = useTransition();
    const values: number[] = [];

    await start(() => values.push(1));
    await start(() => values.push(2));
    await start(() => values.push(3));

    expect(values).toEqual([1, 2, 3]);
  });
});
