/**
 * Tests for createDeferred in reactivity/transition module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createDeferred,
  Signal,
  createRoot,
  effect,
} from '../../src/reactivity';
import { settle } from '../support/tick';
import { testRoot } from '../support/root';

/** Runs the watcher effect, the transition after the next frame and any timeout */
async function flushDeferred(): Promise<void> {
  settle();
  await vi.runAllTimersAsync();
  settle();
}

describe('createDeferred', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('basic behavior', () => {
    it('should return initial value immediately', () => {
      createRoot(() => {
        const value = new Signal('initial');
        const deferred = createDeferred(() => value.value);

        expect(deferred()).toBe('initial');
      });
    });

    it('should be a function (signal getter)', () => {
      createRoot(() => {
        const value = new Signal(0);
        const deferred = createDeferred(() => value.value);

        expect(typeof deferred).toBe('function');
      });
    });

    it('should work with different types', () => {
      createRoot(() => {
        // Number
        const num = new Signal(42);
        expect(createDeferred(() => num.value)()).toBe(42);

        // Object
        const obj = new Signal({ foo: 'bar' });
        expect(createDeferred(() => obj.value)()).toEqual({ foo: 'bar' });

        // Array
        const arr = new Signal([1, 2, 3]);
        expect(createDeferred(() => arr.value)()).toEqual([1, 2, 3]);
      });
    });
  });

  describe('deferred updates', () => {
    it('should defer updates via transition', async () => {
      await new Promise<void>((resolve) => {
        createRoot(async () => {
          const value = new Signal('initial');
          const deferred = createDeferred(() => value.value);

          expect(deferred()).toBe('initial');

          value.value = 'updated';

          // Access deferred to trigger update scheduling
          deferred();

          // Immediately after update, deferred should still be old value
          // (update waits for the next paint)
          expect(deferred()).toBe('initial');

          await flushDeferred();

          // Now deferred should be updated
          expect(deferred()).toBe('updated');
          resolve();
        });
      });
    });

    it('should work with timeoutMs option', async () => {
      await new Promise<void>((resolve) => {
        createRoot(async () => {
          const value = new Signal('initial');
          const deferred = createDeferred(() => value.value, {
            timeoutMs: 100,
          });

          expect(deferred()).toBe('initial');

          value.value = 'updated';
          settle(); // The watcher effect schedules the update

          // Before timeout
          expect(deferred()).toBe('initial');

          // Advance timer
          vi.advanceTimersByTime(100);

          // After timeout
          expect(deferred()).toBe('updated');
          resolve();
        });
      });
    });
  });

  describe('custom equality', () => {
    it('should use custom equals function', async () => {
      await new Promise<void>((resolve) => {
        createRoot(async () => {
          const value = new Signal({ id: 1, name: 'Alice' });

          // Custom equality: only compare by id
          const deferred = createDeferred(() => value.value, {
            equals: (a, b) => a.id === b.id,
          });

          expect(deferred()).toEqual({ id: 1, name: 'Alice' });

          // Update name but keep same id
          value.value = { id: 1, name: 'Bob' };
          deferred();

          await flushDeferred();

          // Should NOT update because id is the same
          expect(deferred().name).toBe('Alice');

          // Update with different id
          value.value = { id: 2, name: 'Carol' };
          deferred();

          await flushDeferred();

          // Should update because id changed
          expect(deferred()).toEqual({ id: 2, name: 'Carol' });
          resolve();
        });
      });
    });
  });

  describe('options', () => {
    it('should accept name option', () => {
      createRoot(() => {
        const value = new Signal('test');
        const deferred = createDeferred(() => value.value, {
          name: 'myDeferred',
        });

        // Should not throw
        expect(deferred()).toBe('test');
      });
    });

    it('should accept all options together', () => {
      createRoot(() => {
        const value = new Signal(1);
        const deferred = createDeferred(() => value.value, {
          name: 'combined',
          equals: (a, b) => a === b,
          timeoutMs: 50,
        });

        expect(deferred()).toBe(1);
      });
    });
  });

  describe('stale detection pattern', () => {
    it('should enable stale detection', async () => {
      await new Promise<void>((resolve) => {
        createRoot(async () => {
          const value = new Signal('A');
          const deferred = createDeferred(() => value.value);

          // Initially in sync
          expect(value.value).toBe(deferred());

          // Update source
          value.value = 'B';
          deferred(); // Trigger scheduling

          // Now they differ (stale)
          expect(value.value).toBe('B');
          expect(deferred()).toBe('A');
          expect(value.value !== deferred()).toBe(true);

          await flushDeferred();

          // Now in sync again
          expect(value.value).toBe(deferred());
          resolve();
        });
      });
    });
  });

  describe('ownership', () => {
    it('does not subscribe the caller to the source', async () => {
      const value = new Signal(0);
      let runs = 0;
      testRoot(() => {
        const deferred = createDeferred(() => value.value);
        effect(() => {
          deferred();
          runs++;
        });
      });
      settle();

      value.value = 1;
      settle();
      expect(runs).toBe(1);

      await vi.advanceTimersByTimeAsync(100); // the transition commits after the next frame
      settle();
      // One run for the deferred value change, none for the source itself
      expect(runs).toBe(2);
    });

    it('clears the timeout on dispose', () => {
      const value = new Signal(0);
      let deferred!: () => number;
      const dispose = createRoot((dispose) => {
        deferred = createDeferred(() => value.value, { timeoutMs: 100 });
        return dispose;
      });
      settle();

      value.value = 1;
      settle();
      dispose();
      vi.advanceTimersByTime(100);

      expect(deferred()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
