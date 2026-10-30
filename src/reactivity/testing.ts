/**
 * Test Support
 *
 * Checks of the reactive graph for Signy's own tests. Turned on with
 * trackForTests(true), so it costs nothing elsewhere. Not exported from any
 * entry point.
 *
 * @module reactivity/testing
 * @internal
 */

import { Effect, type Owner } from './effect';
import {
  getCurrentSubscriber,
  getRegistry,
  getSchedulerState,
  type Link,
  type Source,
  type Tracker,
} from './signal/internal';

export {
  trackForTests,
  resetForTests,
  getSchedulerState,
} from './signal/internal';
export { keyNodeCount } from './store';

/**
 * Problems in the scheduler state that a finished test must not leave: an
 * open batch, a computation still tracking, a flush still marked running.
 */
export function schedulerProblems(): string[] {
  const state = getSchedulerState();
  const problems: string[] = [];
  if (state.batchDepth !== 0) {
    problems.push(`batch depth is ${state.batchDepth}`);
  }
  if (getCurrentSubscriber() !== null) {
    problems.push('a computation is still tracking');
  }
  if (state.flushingEffects) problems.push('an effect flush is still running');
  return problems;
}

/**
 * Checks the sources and effects created since trackForTests():
 * - no disposed effect or computed is still subscribed to a source
 * - no computed without subscribers is subscribed to a source
 * - both lists of every link are whole, and a link of a live tracker sits in
 *   its source's list exactly when the tracker is linked
 * - every owned effect is in its owner's list, and its children point back
 */
export function checkInvariants(): string[] {
  const registry = getRegistry();
  if (!registry) return [];
  const problems: string[] = [];

  for (const source of registry.sources) {
    for (const subscriber of source.subscribers()) {
      const target = subscriber.target;
      if (!target) continue;
      if (target.disposed) {
        problems.push(
          `disposed ${describe(target)} still subscribed to ${describe(source)}`
        );
      } else if (target.watched === false) {
        problems.push(
          `unwatched ${describe(target)} still subscribed to ${describe(source)}`
        );
      }
    }
  }

  const listed = new Set<Link>();
  for (const source of registry.sources) {
    checkSubscriberList(source, listed, problems);
  }
  for (const value of [...registry.sources, ...registry.runners]) {
    if (isTracker(value)) checkSourceList(value, listed, problems);
  }

  for (const runner of registry.runners) {
    if (!(runner instanceof Effect) || runner.disposed) continue;
    const owner = runner.owner;
    if (owner && owner.ownedHead !== null && !owns(owner, runner)) {
      problems.push(`${describe(runner)} is missing from its owner's list`);
    }
    for (let child = runner.ownedHead; child; child = child.ownedNext) {
      if (child.owner !== runner) {
        problems.push(`a child of ${describe(runner)} points to another owner`);
      }
    }
  }

  return problems;
}

/**
 * The effects created since trackForTests() that are not disposed.
 */
export function liveEffects(): Effect<unknown>[] {
  const registry = getRegistry();
  if (!registry) return [];
  const live: Effect<unknown>[] = [];
  for (const runner of registry.runners) {
    if (runner instanceof Effect && !runner.disposed) live.push(runner);
  }
  return live;
}

function checkSubscriberList(
  source: Source,
  listed: Set<Link>,
  problems: string[]
): void {
  let prev: Link | null = null;
  for (let link = source._subscribersHead; link; link = link.nextSubscriber) {
    if (link.source !== source || link.prevSubscriber !== prev) {
      problems.push(`the subscriber list of ${describe(source)} is broken`);
      return;
    }
    listed.add(link);
    prev = link;
  }
  if (source._subscribersTail !== prev) {
    problems.push(
      `the subscriber list of ${describe(source)} has a wrong tail`
    );
  }
}

function checkSourceList(
  tracker: Tracker,
  listed: Set<Link>,
  problems: string[]
): void {
  const read = new Set<Source>();
  const disposed = (tracker as { disposed?: boolean }).disposed === true;
  let prev: Link | null = null;
  for (let link = tracker._sourcesHead; link; link = link.nextSource) {
    if (link.subscriber !== tracker || link.prevSource !== prev) {
      problems.push(`the source list of ${describe(tracker)} is broken`);
      return;
    }
    if (read.has(link.source)) {
      problems.push(
        `${describe(tracker)} links ${describe(link.source)} twice`
      );
    }
    read.add(link.source);
    const gone = (link.source as { disposed?: boolean }).disposed === true;
    if (!disposed && !gone && listed.has(link) !== tracker._linked) {
      problems.push(
        `the link of ${describe(tracker)} to ${describe(link.source)} is ${
          tracker._linked ? 'missing from' : 'still in'
        } its subscriber list`
      );
    }
    prev = link;
  }
  if (tracker._sourcesTail !== prev) {
    problems.push(`the source list of ${describe(tracker)} has a wrong tail`);
  }
}

function isTracker(value: unknown): value is Tracker {
  return typeof value === 'object' && value !== null && '_sourcesHead' in value;
}

function owns(owner: Owner, child: Owner): boolean {
  for (let c = owner.ownedHead; c; c = c.ownedNext) {
    if (c === child) return true;
  }
  return false;
}

function describe(value: object): string {
  const name = (value as { name?: string }).name;
  const kind = value.constructor?.name ?? 'object';
  return name ? `${kind} "${name}"` : kind;
}
