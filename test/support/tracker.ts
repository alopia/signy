/**
 * A function as the running computation, for tests that set it by hand with
 * setCurrentSubscriber(). The same function always gets the same tracker.
 */

import type { Tracker } from '../../src/reactivity/signal/internal';

const trackers = new WeakMap<() => void, Tracker>();

export function tracker(fn: () => void): Tracker {
  let found = trackers.get(fn);
  if (!found) {
    found = {
      _sourcesHead: null,
      _sourcesTail: null,
      _linked: true,
      notify: () => fn(),
    };
    trackers.set(fn, found);
  }
  return found;
}
