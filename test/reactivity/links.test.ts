/**
 * Tests for the links between sources and the computations that read them
 */

import { describe, it, expect, vi } from 'vitest';
import {
  Computed,
  Signal,
  createRoot,
  createSyncEffect,
  effect,
} from '../../src/reactivity';
import { checkInvariants } from '../../src/reactivity/testing';
import { settle } from '../support/tick';
import { testRoot } from '../support/root';

describe('links', () => {
  it('reuses the link of a source read again on the next run', () => {
    const count = new Signal(0);
    testRoot(() => {
      effect(() => count.value);
    });
    settle();
    const link = count._subscribersHead;

    count.value = 1;
    settle();

    expect(count._subscribersHead).toBe(link);
    expect(count.subscriberCount).toBe(1);
  });

  it('keeps one link for a source read twice in a run', () => {
    const a = new Signal(1);
    const b = new Signal(2);
    testRoot(() => {
      effect(() => a.value + b.value + a.value);
    });
    settle();

    expect(a.subscriberCount).toBe(1);
    expect(b.subscriberCount).toBe(1);
  });

  it('follows sources read in another order', () => {
    const flip = new Signal(false);
    const a = new Signal(1);
    const b = new Signal(2);
    const seen: number[] = [];
    testRoot(() => {
      effect(() => {
        seen.push(flip.value ? b.value * 10 + a.value : a.value * 10 + b.value);
      });
    });
    settle();

    flip.value = true;
    settle();
    // b is read first now: each source must still notify on its own
    b.value = 4;
    settle();
    a.value = 3;
    settle();

    expect(seen).toEqual([12, 21, 41, 43]);
    expect(a.subscriberCount).toBe(1);
    expect(b.subscriberCount).toBe(1);
  });

  it('drops a source the last run did not read', () => {
    const on = new Signal(true);
    const value = new Signal(1);
    let runs = 0;
    testRoot(() => {
      effect(() => {
        runs++;
        return on.value ? value.value : 0;
      });
    });
    settle();

    on.value = false;
    settle();
    expect(value.subscriberCount).toBe(0);

    value.value = 2;
    settle();
    expect(runs).toBe(2);
  });

  it('restores the active link of a source after nested runs', () => {
    const count = new Signal(1);
    const double = new Computed(() => count.value * 2);
    let seen = 0;
    testRoot(() => {
      effect(() => {
        seen = count.value + double.value + count.value;
      });
    });
    settle();

    count.value = 2;
    settle();

    expect(seen).toBe(8);
    expect(count.subscriberCount).toBe(2);
    expect(count._activeLink).toBeNull();
    expect(double._activeLink).toBeNull();
  });

  it('links an unwatched computed into its sources only while watched', () => {
    const count = new Signal(1);
    const double = new Computed(() => count.value * 2);
    expect(double.value).toBe(2);
    expect(count.subscriberCount).toBe(0);

    const dispose = createRoot((dispose) => {
      effect(() => double.value);
      return dispose;
    });
    settle();
    expect(count.subscriberCount).toBe(1);
    expect(double.watched).toBe(true);

    dispose();
    expect(count.subscriberCount).toBe(0);
    expect(double.watched).toBe(false);
    count.value = 2;
    expect(double.value).toBe(4);
  });

  it('leaves no link behind an effect that disposes itself while it runs', () => {
    const a = new Signal(1);
    const b = new Signal(2);
    testRoot(() => {
      const self = effect(() => {
        a.value;
        self?.dispose();
        b.value;
      });
    });
    settle();
    a.value = 3;
    settle();

    expect(a.subscriberCount).toBe(0);
    expect(b.subscriberCount).toBe(0);
    expect(a._activeLink).toBeNull();
    expect(b._activeLink).toBeNull();
  });

  it('notifies a sync effect that drops the signal while it is notified', () => {
    const on = new Signal(true);
    const value = new Signal(1);
    const runs: string[] = [];
    const dispose = createRoot((dispose) => {
      // Reads value only while on is true, so the write below unlinks it
      createSyncEffect(() => {
        runs.push(on.value ? `a${value.value}` : 'a-');
      });
      createSyncEffect(() => {
        runs.push(`b${value.value}`);
      });
      return dispose;
    });

    on.value = false;
    value.value = 2;
    expect(runs).toEqual(['a1', 'b1', 'a-', 'b2']);
    dispose();
  });

  it('notifies each subscriber once when one links again while notified', () => {
    const count = new Signal(0);
    const runs: string[] = [];
    const dispose = createRoot((dispose) => {
      createSyncEffect(() => {
        runs.push(`a${count.value}`);
      });
      createSyncEffect(() => {
        runs.push(`b${count.value}`);
      });
      return dispose;
    });

    count.value = 1;
    expect(runs).toEqual(['a0', 'b0', 'a1', 'b1']);
    dispose();
  });

  it('keeps both lists whole as sources come, move and go', () => {
    const mode = new Signal(0);
    const a = new Signal(1);
    const b = new Signal(2);
    const c = new Signal(3);
    const reads: Signal<number>[][] = [
      [a, b],
      [c, a, b],
      [c, b],
      [b, a, c],
    ];
    let runs = 0;
    testRoot(() => {
      effect(() => {
        runs++;
        for (const source of reads[mode.value]!) source.value;
      });
    });
    settle();

    for (let m = 1; m < reads.length; m++) {
      mode.value = m;
      settle();
      expect(checkInvariants()).toEqual([]);
      for (const source of [a, b, c]) {
        const before = runs;
        source.value++;
        settle();
        expect(runs - before).toBe(reads[m]!.includes(source) ? 1 : 0);
      }
    }
  });

  it('moves a source to the front and out of the middle', () => {
    const a = new Signal(1);
    const b = new Signal(2);
    const c = new Signal(3);
    // Changed without a signal, so the first read itself moves
    let order = [a, b, c];
    let runs = 0;
    testRoot(() => {
      effect(() => {
        runs++;
        for (const source of order) source.value;
      });
    });
    settle();

    for (const next of [
      [b, a, c],
      [c, b, a],
      [a, c, b],
    ]) {
      order = next;
      c.value++;
      settle();
      expect(checkInvariants()).toEqual([]);
      expect(b._subscribersHead?.subscriber).toBe(
        c._subscribersHead?.subscriber
      );
    }
    const before = runs;
    a.value++;
    b.value++;
    c.value++;
    settle();
    expect(runs).toBe(before + 1);
  });

  it('leaves the list of a source alone when an unwatched computed drops it', () => {
    const on = new Signal(true);
    const shared = new Signal(1);
    const maybe = new Computed(() => (on.value ? shared.value : 0));
    let runs = 0;
    testRoot(() => {
      effect(() => {
        runs++;
        shared.value;
      });
    });
    settle();
    expect(maybe.value).toBe(1);

    on.value = false;
    expect(maybe.value).toBe(0);
    shared.value = 2;
    settle();

    expect(runs).toBe(2);
    expect(shared.subscriberCount).toBe(1);
  });

  it('keeps a disposed signal empty while its subscribers go', () => {
    const count = new Signal(0);
    const disposers = createRoot((dispose) => {
      effect(() => count.value);
      return [
        dispose,
        createRoot((dispose) => {
          effect(() => count.value);
          return dispose;
        }),
      ];
    });
    settle();

    count.dispose();
    for (const dispose of disposers) dispose();

    expect(count._subscribersHead).toBeNull();
    expect(count._subscribersTail).toBeNull();
  });

  it('adds a plain subscriber once and removes only the one asked for', () => {
    const count = new Signal(0);
    const first = vi.fn();
    const second = vi.fn();

    count.subscribe(first);
    count.subscribe(first);
    count.subscribe(second);
    expect(count.subscriberCount).toBe(2);

    count.unsubscribe(second);
    count.unsubscribe(() => {});
    expect(count.subscriberCount).toBe(1);

    count.value = 1;
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });
});
