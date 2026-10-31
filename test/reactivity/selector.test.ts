/**
 * Tests for createSelector
 *
 * createSelector returns a function that takes a key and returns a Signal<boolean>.
 * The signal indicates whether the key matches the current selection.
 */

import { describe, it, expect } from 'vitest';
import {
  createSelector,
  Computed,
  Signal,
  createRoot,
  effect,
} from '../../src/reactivity';
import { settle } from '../support/tick';

describe('createSelector', () => {
  it('should return false when no item is selected', () => {
    createRoot(() => {
      const selected = new Signal<number | null>(null);
      const isSelected = createSelector(() => selected.value);

      const check1 = isSelected(1);
      const check2 = isSelected(2);

      expect(check1.value).toBe(false);
      expect(check2.value).toBe(false);
    });
  });

  it('should return true for the selected item', () => {
    createRoot(() => {
      const selected = new Signal<number>(1);
      const isSelected = createSelector(() => selected.value);

      expect(isSelected(1).value).toBe(true);
      expect(isSelected(2).value).toBe(false);
      expect(isSelected(3).value).toBe(false);
    });
  });

  it('should update when selection changes', async () => {
    await new Promise<void>((resolve) => {
      createRoot(() => {
        const selected = new Signal<number>(1);
        const isSelected = createSelector(() => selected.value);

        const check1 = isSelected(1);
        const check2 = isSelected(2);

        expect(check1.value).toBe(true);
        expect(check2.value).toBe(false);

        // Change selection
        selected.value = 2;

        // Allow effect to run
        queueMicrotask(() => {
          expect(check1.value).toBe(false);
          expect(check2.value).toBe(true);
          resolve();
        });
      });
    });
  });

  it('should only notify affected items', async () => {
    await new Promise<void>((resolve) => {
      createRoot(() => {
        const selected = new Signal<number>(1);
        const isSelected = createSelector(() => selected.value);

        const effectCalls = { item1: 0, item2: 0, item3: 0 };

        const check1 = isSelected(1);
        const check2 = isSelected(2);
        const check3 = isSelected(3);

        effect(() => {
          check1.value; // Read to track
          effectCalls.item1++;
        });

        effect(() => {
          check2.value; // Read to track
          effectCalls.item2++;
        });

        effect(() => {
          check3.value; // Read to track
          effectCalls.item3++;
        });

        // Allow initial effects to run
        queueMicrotask(() => {
          const initialCalls = { ...effectCalls };

          // Change selection from 1 to 2
          selected.value = 2;

          queueMicrotask(() => {
            // Item 1 and 2 should have been notified, item 3 should not
            expect(effectCalls.item1).toBeGreaterThan(initialCalls.item1);
            expect(effectCalls.item2).toBeGreaterThan(initialCalls.item2);
            // Item 3 may or may not be called depending on implementation
            // The key is that its selection state is still false
            expect(check3.value).toBe(false);
            resolve();
          });
        });
      });
    });
  });

  it('re-runs only the consumers whose selection changed', () => {
    createRoot((dispose) => {
      const selected = new Signal(0);
      const isSelected = createSelector(() => selected.value);
      const runs = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        effect(() => {
          void isSelected(k).value;
          runs[k]!++;
        });
      }
      settle();

      selected.value = 1;
      settle();
      expect(runs).toEqual([2, 2, 1]);
      dispose();
    });
  });

  it('should work with custom comparator', async () => {
    await new Promise<void>((resolve) => {
      createRoot(() => {
        interface User {
          id: number;
          name: string;
        }

        const selected = new Signal<User | null>(null);
        const isSelected = createSelector(
          () => selected.value,
          (id: number, user: User | null) => user?.id === id
        );

        const check1 = isSelected(1);
        const check2 = isSelected(2);

        expect(check1.value).toBe(false);
        expect(check2.value).toBe(false);

        selected.value = { id: 1, name: 'Alice' };

        queueMicrotask(() => {
          expect(check1.value).toBe(true);
          expect(check2.value).toBe(false);

          selected.value = { id: 2, name: 'Bob' };

          queueMicrotask(() => {
            expect(check1.value).toBe(false);
            expect(check2.value).toBe(true);
            resolve();
          });
        });
      });
    });
  });

  it('should work with string keys', async () => {
    await new Promise<void>((resolve) => {
      createRoot(() => {
        const selected = new Signal<string>('a');
        const isSelected = createSelector(() => selected.value);

        const checkA = isSelected('a');
        const checkB = isSelected('b');

        expect(checkA.value).toBe(true);
        expect(checkB.value).toBe(false);

        selected.value = 'b';

        queueMicrotask(() => {
          expect(checkA.value).toBe(false);
          expect(checkB.value).toBe(true);
          resolve();
        });
      });
    });
  });

  it('should handle null/undefined selection', async () => {
    await new Promise<void>((resolve) => {
      createRoot(() => {
        const selected = new Signal<number | null>(1);
        const isSelected = createSelector(() => selected.value);

        const check1 = isSelected(1);

        expect(check1.value).toBe(true);

        selected.value = null;

        queueMicrotask(() => {
          expect(check1.value).toBe(false);

          selected.value = 1;

          queueMicrotask(() => {
            expect(check1.value).toBe(true);
            resolve();
          });
        });
      });
    });
  });

  it('should handle multiple selectors for same key', async () => {
    await new Promise<void>((resolve) => {
      createRoot(() => {
        const selected = new Signal<number>(1);
        const isSelected = createSelector(() => selected.value);

        // Multiple components checking the same key
        const check1a = isSelected(1);
        const check1b = isSelected(1);

        expect(check1a.value).toBe(true);
        expect(check1b.value).toBe(true);

        selected.value = 2;

        queueMicrotask(() => {
          expect(check1a.value).toBe(false);
          expect(check1b.value).toBe(false);
          resolve();
        });
      });
    });
  });

  it('should select item not previously checked', () => {
    createRoot(() => {
      const selected = new Signal<number>(1);
      const isSelected = createSelector(() => selected.value);

      const check1 = isSelected(1);
      expect(check1.value).toBe(true);

      // Select item 5, which nothing has checked yet
      selected.value = 5;
      settle();
      expect(check1.value).toBe(false);
      expect(isSelected(5).value).toBe(true);
    });
  });
});

describe('createSelector readers of one key', () => {
  it('share one signal, kept until the last reader cleans up', () => {
    createRoot((dispose) => {
      const selected = new Signal<number | null>(null);
      const isSelected = createSelector(() => selected.value);

      const disposeA = createRoot((d) => {
        isSelected(1);
        return d;
      });
      let b!: Signal<boolean>;
      const disposeB = createRoot((d) => {
        b = isSelected(1);
        return d;
      });

      disposeA();
      selected.value = 1;
      settle();
      expect(b.value).toBe(true);

      disposeB();
      selected.value = null;
      settle();
      // No reader left, so the signal is not updated and the key is released
      expect(b.value).toBe(true);
      const c = createRoot(() => isSelected(1));
      expect(c).not.toBe(b);
      expect(c.value).toBe(false);
      dispose();
    });
  });

  it('gives a new reader the current state of a selected key', () => {
    createRoot((dispose) => {
      const selected = new Signal<number | null>(2);
      const isSelected = createSelector(() => selected.value);
      const first = isSelected(2);
      settle();
      expect(isSelected(2)).toBe(first);
      expect(first.value).toBe(true);

      selected.value = 3;
      settle();
      expect(first.value).toBe(false);
      dispose();
    });
  });

  it('gives a new key the selection written before the flush', () => {
    createRoot((dispose) => {
      const id = new Signal(1);
      const selected = new Computed(() => id.value * 10);
      const isSelected = createSelector(() => selected.value);
      isSelected(10);
      settle();
      expect(isSelected(30).value).toBe(false);

      // The selector has not run for the new value yet
      id.value = 2;
      expect(isSelected(20).value).toBe(true);
      expect(isSelected(40).value).toBe(false);
      settle();
      expect(isSelected(20).value).toBe(true);
      expect(isSelected(10).value).toBe(false);
      dispose();
    });
  });

  it('releases a selected key and gives a new reader the current state', () => {
    createRoot((dispose) => {
      const selected = new Signal<number | null>(2);
      const isSelected = createSelector(() => selected.value);
      settle();

      // The only reader of the selected key goes away
      const reader = createRoot((d) => {
        effect(() => isSelected(2).value);
        return d;
      });
      settle();
      reader();

      selected.value = 3;
      settle();
      const two = isSelected(2);
      const three = isSelected(3);
      expect(two.value).toBe(false);
      expect(three.value).toBe(true);

      selected.value = 2;
      settle();
      expect(two.value).toBe(true);
      expect(three.value).toBe(false);
      dispose();
    });
  });

  it('selects again a key released while selected, read before the selector runs', () => {
    createRoot((dispose) => {
      const selected = new Signal<number | null>(2);
      const isSelected = createSelector(() => selected.value);
      settle();

      // The only reader of the selected key goes away
      const reader = createRoot((d) => {
        effect(() => isSelected(2).value);
        return d;
      });
      settle();
      reader();

      // A new reader comes while the selection is away, then it comes back,
      // all before the selector runs
      selected.value = 3;
      const two = isSelected(2);
      expect(two.value).toBe(false);
      selected.value = 2;
      settle();
      expect(two.value).toBe(true);
      dispose();
    });
  });
});
