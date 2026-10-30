/**
 * Scenarios ported from the signal-polyfill and Solid reactivity tests:
 * diamonds, glitch freedom, reads in batch, error recovery, dynamic
 * dependencies and disposal order.
 */

import { describe, it, expect } from 'vitest';
import {
  Signal,
  Computed,
  batch,
  createRoot,
  effect,
  onCleanup,
} from '../../src/reactivity';
import { settle } from '../support/tick';
import { testRoot } from '../support/root';

describe('diamonds', () => {
  it('computes the bottom of a diamond once per change', () => {
    const a = new Signal('a');
    const b = new Computed(() => a.value + 'b');
    const c = new Computed(() => a.value + 'c');
    let runs = 0;
    const d = new Computed(() => {
      runs++;
      return b.value + c.value;
    });

    expect(d.value).toBe('abac');
    a.value = 'x';
    expect(d.value).toBe('xbxc');
    expect(runs).toBe(2);
  });

  it('skips the bottom when a middle node computes the same value', () => {
    const a = new Signal(1);
    const parity = new Computed(() => a.value % 2);
    let runs = 0;
    const label = new Computed(() => {
      runs++;
      return parity.value ? 'odd' : 'even';
    });

    expect(label.value).toBe('odd');
    a.value = 3;
    expect(label.value).toBe('odd');
    expect(runs).toBe(1);
  });
});

describe('glitch freedom', () => {
  it('never shows an effect a mix of old and new values', () => {
    const first = new Signal('John');
    const last = new Signal('Smith');
    const full = new Computed(() => `${first.value} ${last.value}`);
    const seen: string[] = [];

    testRoot(() => {
      effect(() => {
        seen.push(`${first.value}|${full.value}`);
      });
    });
    settle();

    batch(() => {
      first.value = 'Jane';
      last.value = 'Doe';
    });
    settle();

    expect(seen).toEqual(['John|John Smith', 'Jane|Jane Doe']);
  });

  it('runs an effect once for a change that reaches it twice', () => {
    const a = new Signal(1);
    const b = new Computed(() => a.value * 2);
    const c = new Computed(() => a.value * 3);
    let runs = 0;

    testRoot(() => {
      effect(() => {
        void (b.value + c.value);
        runs++;
      });
    });
    settle();

    a.value = 2;
    settle();
    expect(runs).toBe(2);
  });
});

describe('reads in batch', () => {
  it('reads new values of signals and computeds inside the batch', () => {
    const a = new Signal(1);
    const double = new Computed(() => a.value * 2);
    testRoot(() => {
      effect(() => double.value);
    });
    settle();

    batch(() => {
      a.value = 2;
      expect(a.value).toBe(2);
      expect(double.value).toBe(4);
      a.value = 3;
      expect(double.value).toBe(6);
    });
  });

  it('runs effects once, after the outermost batch', () => {
    const a = new Signal(0);
    const seen: number[] = [];
    testRoot(() => {
      effect(() => {
        seen.push(a.value);
      });
    });
    settle();

    batch(() => {
      a.value = 1;
      batch(() => {
        a.value = 2;
      });
      a.value = 3;
    });
    settle();
    expect(seen).toEqual([0, 3]);
  });
});

describe('error recovery', () => {
  it('rethrows the same error until a dependency changes, then recovers', () => {
    const a = new Signal(0);
    let runs = 0;
    const c = new Computed(() => {
      runs++;
      if (a.value === 0) throw new Error('zero');
      return 1 / a.value;
    });

    let first: unknown;
    try {
      c.value;
    } catch (error) {
      first = error;
    }
    expect(() => c.value).toThrow(first as Error);
    expect(runs).toBe(1);

    a.value = 2;
    expect(c.value).toBe(0.5);
  });

  it('keeps downstream computeds and effects working after an error', () => {
    const a = new Signal(1);
    const risky = new Computed(() => {
      if (a.value < 0) throw new Error('negative');
      return a.value;
    });
    const safe = new Computed(() => {
      try {
        return risky.value;
      } catch {
        return -1;
      }
    });
    const seen: number[] = [];
    testRoot(() => {
      effect(() => {
        seen.push(safe.value);
      });
    });
    settle();

    a.value = -5;
    settle();
    a.value = 7;
    settle();
    expect(seen).toEqual([1, -1, 7]);
  });
});

describe('dynamic dependencies', () => {
  it('stops depending on a branch it no longer reads', () => {
    const useA = new Signal(true);
    const a = new Signal('a');
    const b = new Signal('b');
    let runs = 0;
    const pick = new Computed(() => {
      runs++;
      return useA.value ? a.value : b.value;
    });
    testRoot(() => {
      effect(() => pick.value);
    });
    settle();

    useA.value = false;
    settle();
    const after = runs;
    a.value = 'changed';
    settle();
    expect(runs).toBe(after);
    expect(a.subscriberCount).toBe(0);

    b.value = 'b2';
    settle();
    expect(pick.value).toBe('b2');
  });

  it('picks up a dependency read only on a later run', () => {
    const show = new Signal(false);
    const detail = new Signal('x');
    const seen: string[] = [];
    testRoot(() => {
      effect(() => {
        seen.push(show.value ? detail.value : '-');
      });
    });
    settle();

    show.value = true;
    settle();
    detail.value = 'y';
    settle();
    expect(seen).toEqual(['-', 'x', 'y']);
  });
});

describe('disposal order', () => {
  it('runs cleanups in reverse order, then disposes children', () => {
    const order: string[] = [];
    const dispose = createRoot((dispose) => {
      onCleanup(() => order.push('root 1'));
      onCleanup(() => order.push('root 2'));
      createRoot((_d) => {
        onCleanup(() => order.push('child'));
      });
      return dispose;
    });

    dispose();
    expect(order).toEqual(['root 2', 'root 1', 'child']);
  });

  it('runs an effect cleanup before its next run and on dispose', () => {
    const a = new Signal(0);
    const order: string[] = [];
    const dispose = createRoot((dispose) => {
      effect(() => {
        const value = a.value;
        order.push(`run ${value}`);
        onCleanup(() => order.push(`cleanup ${value}`));
      });
      return dispose;
    });
    settle();
    a.value = 1;
    settle();
    dispose();
    expect(order).toEqual(['run 0', 'cleanup 0', 'run 1', 'cleanup 1']);
  });
});
