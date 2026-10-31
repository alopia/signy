/**
 * Tests for the invariant checks the test setup runs after each test
 */

import { describe, it, expect } from 'vitest';
import { Computed, Signal, effect, createRoot } from '../../src/reactivity';
import { enterBatch } from '../../src/reactivity/signal/internal';
import {
  checkInvariants,
  liveEffects,
  resetForTests,
  schedulerProblems,
} from '../../src/reactivity/testing';
import { settle } from '../support/tick';

describe('invariant checks', () => {
  it('report an open batch', () => {
    enterBatch();
    expect(schedulerProblems()).toEqual(['batch depth is 1']);
    resetForTests();
    expect(schedulerProblems()).toEqual([]);
  });

  it('report a disposed subscriber still on a source', () => {
    const s = new Signal(0);
    const subscriber = Object.assign(() => {}, {
      target: { disposed: true },
    });
    s.subscribe(subscriber);

    expect(checkInvariants()).toEqual([
      'disposed Object still subscribed to State',
    ]);
    resetForTests();
  });

  it('report an unwatched computed still on a source', () => {
    const s = new Signal(0);
    const c = new Computed(() => s.value);
    c.value;
    s.subscribe(
      Object.assign(() => {}, { target: c as unknown as { disposed: boolean } })
    );

    expect(checkInvariants()).toEqual([
      'unwatched Computed still subscribed to State',
    ]);
    resetForTests();
  });

  it('find nothing after a root is disposed', () => {
    const s = new Signal(0);
    const c = new Computed(() => s.value * 2);
    const dispose = createRoot((dispose) => {
      effect(() => c.value);
      return dispose;
    });
    settle();
    expect(liveEffects()).toHaveLength(1);

    dispose();
    expect(liveEffects()).toHaveLength(0);
    expect(checkInvariants()).toEqual([]);
  });
});
