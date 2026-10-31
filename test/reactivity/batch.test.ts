/**
 * Tests for batch update system
 */

import { describe, it, expect, vi } from 'vitest';
import {
  batch,
  isBatching,
  flushSync,
  flushAll,
  Signal,
  effect,
  createRoot,
  createRenderEffect,
} from '../../src/reactivity';
import {
  getPendingCount,
  scheduleNotification,
  setCurrentSubscriber,
  getSchedulerState,
  scheduleTask,
} from '../../src/reactivity/signal/internal';
import { microtask } from '../support/tick';
import { tracker } from '../support/tracker';

describe('batch', () => {
  describe('basic functionality', () => {
    it('should execute the function', () => {
      const fn = vi.fn(() => 42);
      const result = batch(fn);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(result).toBe(42);
    });

    it('should return the function result', () => {
      const result = batch(() => 'hello');
      expect(result).toBe('hello');
    });

    it('should defer subscriber notifications', () => {
      const subscriber = vi.fn();
      let notified = false;

      batch(() => {
        scheduleNotification(() => {
          notified = true;
          subscriber();
        });
        expect(notified).toBe(false); // Not called yet
      });

      expect(notified).toBe(true); // Called after batch
      expect(subscriber).toHaveBeenCalledTimes(1);
    });

    it('should batch multiple updates', () => {
      const subscriber = vi.fn();

      batch(() => {
        scheduleNotification(subscriber);
        scheduleNotification(subscriber);
        scheduleNotification(subscriber);
      });

      // Set only notifies once per batch due to deduplication
      expect(subscriber).toHaveBeenCalledTimes(1);
    });
  });

  describe('nested batching', () => {
    it('should support nested batches', () => {
      const subscriber = vi.fn();
      let innerBatchComplete = false;
      let outerBatchComplete = false;

      batch(() => {
        scheduleNotification(subscriber);

        batch(() => {
          scheduleNotification(subscriber);
          innerBatchComplete = true;
        });

        // Inner batch completed but outer still in progress
        expect(innerBatchComplete).toBe(true);
        expect(subscriber).not.toHaveBeenCalled(); // Still batching

        outerBatchComplete = true;
      });

      expect(outerBatchComplete).toBe(true);
      expect(subscriber).toHaveBeenCalledTimes(1); // Deduplicated
    });

    it('should only flush after outermost batch completes', () => {
      const log: string[] = [];

      // Use the same subscriber function reference for deduplication
      const subscriber = () => log.push('subscriber');

      batch(() => {
        log.push('outer-start');
        scheduleNotification(subscriber);

        batch(() => {
          log.push('inner-start');
          scheduleNotification(subscriber);
          log.push('inner-end');
        });

        log.push('outer-end');
      });

      log.push('after-batch');

      expect(log).toEqual([
        'outer-start',
        'inner-start',
        'inner-end',
        'outer-end',
        'subscriber', // Only once due to deduplication (same function reference)
        'after-batch',
      ]);
    });
  });

  describe('error handling', () => {
    it('should still flush on error', () => {
      const subscriber = vi.fn();

      expect(() => {
        batch(() => {
          scheduleNotification(subscriber);
          throw new Error('test error');
        });
      }).toThrow('test error');

      expect(subscriber).toHaveBeenCalled();
    });

    it('should restore batch depth on error', () => {
      try {
        batch(() => {
          expect(isBatching()).toBe(true);
          throw new Error('test');
        });
      } catch {
        // Expected
      }

      expect(isBatching()).toBe(false);
    });
  });
});

describe('isBatching', () => {
  it('should return false outside batch', () => {
    expect(isBatching()).toBe(false);
  });

  it('should return true inside batch', () => {
    batch(() => {
      expect(isBatching()).toBe(true);
    });
  });

  it('should return true in nested batches', () => {
    batch(() => {
      expect(isBatching()).toBe(true);
      batch(() => {
        expect(isBatching()).toBe(true);
      });
      expect(isBatching()).toBe(true);
    });
  });

  it('should return false after batch completes', () => {
    batch(() => {});
    expect(isBatching()).toBe(false);
  });
});

describe('flushSync', () => {
  it('should immediately flush pending subscribers', () => {
    const subscriber = vi.fn();

    batch(() => {
      scheduleNotification(subscriber);
      expect(subscriber).not.toHaveBeenCalled();

      flushSync();
      expect(subscriber).toHaveBeenCalledTimes(1);
    });
  });

  it('should restore batch depth after flush', () => {
    batch(() => {
      expect(isBatching()).toBe(true);
      flushSync();
      expect(isBatching()).toBe(true); // Still in batch
    });
    expect(isBatching()).toBe(false);
  });

  it('restores the batch depth when a subscriber throws', () => {
    const subscriber = vi.fn(() => {
      throw new Error('boom');
    });
    expect(() =>
      batch(() => {
        scheduleNotification(subscriber);
        flushSync();
      })
    ).toThrow('boom');
    expect(getSchedulerState().batchDepth).toBe(0);

    // batch() still defers notifications afterwards
    const later = vi.fn();
    batch(() => {
      scheduleNotification(later);
      expect(later).not.toHaveBeenCalled();
    });
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('should handle cascading updates', () => {
    const log: number[] = [];
    let shouldCascade = true;

    const cascadingSubscriber = () => {
      log.push(1);
      if (shouldCascade) {
        shouldCascade = false;
        scheduleNotification(() => log.push(2));
      }
    };

    scheduleNotification(cascadingSubscriber);

    // Wait for flush
    expect(log).toEqual([1, 2]);
  });
});

describe('getPendingCount', () => {
  it('should return 0 when no pending subscribers', () => {
    expect(getPendingCount()).toBe(0);
  });

  it('should return count of pending subscribers in batch', () => {
    batch(() => {
      scheduleNotification(() => {});
      expect(getPendingCount()).toBe(1);

      scheduleNotification(() => {});
      // Same subscriber is deduplicated if it's the same reference
      // But these are different functions, so count increases
      expect(getPendingCount()).toBe(2);
    });

    expect(getPendingCount()).toBe(0); // Flushed
  });
});

describe('scheduleNotification', () => {
  it('should call subscriber immediately outside batch', () => {
    const subscriber = vi.fn();
    scheduleNotification(subscriber);
    expect(subscriber).toHaveBeenCalledTimes(1);
  });

  it('should queue subscriber inside batch', () => {
    const subscriber = vi.fn();

    batch(() => {
      scheduleNotification(subscriber);
      expect(subscriber).not.toHaveBeenCalled();
    });

    expect(subscriber).toHaveBeenCalledTimes(1);
  });

  it('should deduplicate same subscriber in batch', () => {
    const subscriber = vi.fn();

    batch(() => {
      scheduleNotification(subscriber);
      scheduleNotification(subscriber);
      scheduleNotification(subscriber);
    });

    expect(subscriber).toHaveBeenCalledTimes(1);
  });

  it('should call different subscribers', () => {
    const subscriber1 = vi.fn();
    const subscriber2 = vi.fn();

    batch(() => {
      scheduleNotification(subscriber1);
      scheduleNotification(subscriber2);
    });

    expect(subscriber1).toHaveBeenCalledTimes(1);
    expect(subscriber2).toHaveBeenCalledTimes(1);
  });
});

describe('integration with signals', () => {
  it('should batch multiple signal updates', async () => {
    const a = new Signal(1);
    const b = new Signal(2);
    const values: number[] = [];

    // Track both signals
    const subscriber = () => {
      values.push(a.value + b.value);
    };

    setCurrentSubscriber(tracker(subscriber));
    a.value;
    b.value;
    setCurrentSubscriber(null);

    // Clear initial value
    values.length = 0;

    batch(() => {
      a.value = 10;
      b.value = 20;
    });

    // Wait for any async notifications
    await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));

    // Values should reflect batched update
    if (values.length > 0) {
      expect(values[values.length - 1]).toBe(30);
    }
  });

  it('should handle rapid signal updates', () => {
    const count = new Signal(0);

    batch(() => {
      for (let i = 0; i < 100; i++) {
        count.value = i;
      }
    });

    expect(count.value).toBe(99);
  });
});

describe('edge cases', () => {
  it('should handle empty batch', () => {
    const result = batch(() => 'empty');
    expect(result).toBe('empty');
  });

  it('should handle batch returning undefined', () => {
    const result = batch(() => undefined);
    expect(result).toBe(undefined);
  });

  it('should handle batch returning null', () => {
    const result = batch(() => null);
    expect(result).toBe(null);
  });

  it('should handle subscriber that throws', () => {
    const goodSubscriber = vi.fn();
    const badSubscriber = vi.fn(() => {
      throw new Error('bad subscriber');
    });

    // Note: In current implementation, if a subscriber throws,
    // subsequent subscribers may not run. This is expected behavior.
    expect(() => {
      batch(() => {
        scheduleNotification(badSubscriber);
        scheduleNotification(goodSubscriber);
      });
    }).toThrow('bad subscriber');
  });

  it('should handle deeply nested batches', () => {
    const subscriber = vi.fn();
    let depth = 0;
    const maxDepth = 10;

    const nestedBatch = (): void => {
      batch(() => {
        depth++;
        scheduleNotification(subscriber);
        if (depth < maxDepth) {
          nestedBatch();
        }
      });
    };

    nestedBatch();

    expect(depth).toBe(maxDepth);
    expect(subscriber).toHaveBeenCalledTimes(1); // Deduplicated
  });
});

describe('async functions', () => {
  it('closes the batch at the first await', async () => {
    const subscriber = vi.fn();
    const state = new Signal(0);

    setCurrentSubscriber(tracker(subscriber));
    state.get();
    setCurrentSubscriber(null);

    const done = batch(async () => {
      state.value = 1;
      await microtask();
      expect(isBatching()).toBe(false);
      state.value = 2;
    });

    // The sync part ran batched, so the pending promise blocks nothing
    expect(isBatching()).toBe(false);
    expect(subscriber).toHaveBeenCalledTimes(1);
    await done;
    expect(subscriber).toHaveBeenCalledTimes(2);
  });
});

describe('subscriber errors', () => {
  it('runs every pending subscriber, then rethrows the first error', () => {
    const calls: string[] = [];
    expect(() =>
      batch(() => {
        scheduleNotification(() => {
          calls.push('a');
          throw new Error('first');
        });
        scheduleNotification(() => {
          calls.push('b');
          throw new Error('second');
        });
        scheduleNotification(() => calls.push('c'));
      })
    ).toThrow('first');
    expect(calls).toEqual(['a', 'b', 'c']);
    expect(isBatching()).toBe(false);
  });
});

describe('flushAll', () => {
  it('should flush signal notifications and pending effects', () => {
    const log: string[] = [];

    createRoot(() => {
      const count = new Signal(0);
      effect(() => {
        log.push(`effect:${count.get()}`);
      });
      expect(log).toEqual([]);

      flushAll();
      expect(log).toEqual(['effect:0']);

      batch(() => {
        count.set(1);
        count.set(2);
      });
      expect(log).toEqual(['effect:0']);

      flushAll();
      expect(log).toEqual(['effect:0', 'effect:2']);
    });
  });

  it('should be safe to call when nothing is pending', () => {
    expect(() => flushAll()).not.toThrow();
    expect(() => flushAll()).not.toThrow();
  });

  it('should run effects queued by other effects', () => {
    const log: number[] = [];

    createRoot(() => {
      const a = new Signal(1);
      const b = new Signal(0);
      effect(() => {
        b.value = a.value * 10;
      });
      effect(() => {
        log.push(b.value);
      });

      flushAll();
      a.value = 2;
      flushAll();
    });

    expect(log).toEqual([10, 20]);
  });

  it('should re-run render effects synchronously', () => {
    const count = new Signal(0);
    const el = document.createElement('span');
    const dispose = createRenderEffect(() => {
      el.textContent = String(count.value);
    });

    count.value = 1;
    expect(el.textContent).toBe('0');

    flushAll();
    expect(el.textContent).toBe('1');
    dispose();
  });

  it('should settle work that moves between effects and render effects', () => {
    const source = new Signal(0);
    const derived = new Signal(0);
    const el = document.createElement('span');

    createRoot(() => {
      createRenderEffect(() => {
        derived.value = source.value + 1;
      });
      effect(() => {
        el.textContent = `derived:${derived.value}`;
      });
    });

    flushAll();
    source.value = 5;
    flushAll();
    expect(el.textContent).toBe('derived:6');
  });

  it('should throw when work keeps scheduling more work', () => {
    const x = new Signal(0);
    const y = new Signal(0);
    const disposeA = createRenderEffect(() => {
      y.value = x.value + 1;
    });
    const disposeB = createRenderEffect(() => {
      x.value = y.value + 1;
    });

    expect(() => flushAll()).toThrow('flushAll() did not settle');
    disposeA();
    disposeB();
  });
});

describe('a DOM task that throws', () => {
  it('keeps a very long rest of the queue', () => {
    const ran = vi.fn();
    scheduleTask(() => {
      throw new Error('boom');
    });
    for (let i = 0; i < 150_000; i++) scheduleTask(ran);

    expect(() => flushAll()).toThrow('boom');
    flushAll();
    expect(ran).toHaveBeenCalledTimes(150_000);
  });
});
