/**
 * Links between sources and the computations that read them
 *
 * One Link per (source, reader) pair, in two doubly linked lists: the
 * reader's sources, in read order, and the source's subscribers. A link
 * keeps the version of the source the reader saw, so checking whether a
 * computation is stale walks its links and allocates nothing.
 *
 * A run marks the reader's links, reuses each one it reads again, and
 * unlinks the rest when it ends. A dependency read on every run costs a
 * pointer compare: no Set, no hash and no allocation.
 *
 * Each source points at the link of the reader running right now, so a
 * second read in the same run is found in one step. The pointer is saved
 * in the link and restored when the run ends, which keeps nested runs apart.
 *
 * A computed without subscribers keeps its links but leaves them out of
 * its sources' subscriber lists, so it can be garbage collected while its
 * sources live on. Its first subscriber links them in, its last takes them out.
 *
 * @module reactivity/signal/links
 * @internal
 *
 * ## Known limitations
 *
 * None.
 */

import {
  onResetForTests,
  scheduleNotification,
  type Subscriber,
} from './scheduler';

//=============================================
// Types
//=============================================

/**
 * Something a computation can read: a signal, a computed or a store node.
 */
export interface Source {
  /**
   * Bumped whenever the value changes. Reading it from a computed brings the
   * computed up to date first.
   */
  readonly version: number;

  /**
   * True for a computed. It notifies before it knows whether its value
   * changed, so a subscriber checks the versions before running again.
   */
  readonly derived?: boolean;

  /** @internal First and last link of the subscriber list */
  _subscribersHead: Link | null;
  /** @internal */
  _subscribersTail: Link | null;

  /** @internal The link of the computation running right now, if it read this */
  _activeLink: Link | null;

  /** @internal Called when the first subscriber links in */
  _watch?(): void;

  /** @internal Called when the last subscriber leaves */
  _unwatch?(): void;

  /** The current subscribers, for checkInvariants() */
  subscribers(): Iterable<Subscriber>;
}

/**
 * A computation that reads sources: an effect or a computed.
 */
export interface Tracker {
  /** @internal First and last link of the sources, in read order */
  _sourcesHead: Link | null;
  /** @internal Also the last link read while the tracker runs */
  _sourcesTail: Link | null;

  /** @internal Whether its links sit in the subscriber lists of its sources */
  readonly _linked: boolean;

  notify(): void;
  readonly eager?: boolean;
  target?: Subscriber['target'];
}

/** The version of a link its tracker has not read in the current run */
const UNREAD = -1;

/**
 * One source read by one subscriber.
 *
 * @internal
 */
export class Link {
  readonly source: Source;
  readonly subscriber: Subscriber;

  /** The version of the source when the subscriber read it */
  version: number;

  prevSource: Link | null;
  nextSource: Link | null;
  prevSubscriber: Link | null = null;
  nextSubscriber: Link | null = null;

  /** The source's active link before this run, restored when it ends */
  rollback: Link | null;

  // Every field set once here: a link per read is the hot allocation
  constructor(
    source: Source,
    subscriber: Subscriber,
    version: number,
    prevSource: Link | null = null,
    nextSource: Link | null = null,
    rollback: Link | null = null
  ) {
    this.source = source;
    this.subscriber = subscriber;
    this.version = version;
    this.prevSource = prevSource;
    this.nextSource = nextSource;
    this.rollback = rollback;
  }
}

//=============================================
// Module State
//=============================================

/**
 * The computation running right now. Reads made while it is null track
 * nothing.
 */
let currentTracker: Tracker | null = null;

onResetForTests(() => {
  currentTracker = null;
});

//=============================================
// Tracking
//=============================================

/**
 * The computation running right now, or null.
 *
 * @internal
 */
export function getCurrentSubscriber(): Tracker | null {
  return currentTracker;
}

/**
 * Makes `tracker` the computation reads are tracked for, without starting a
 * run. Used to read untracked, with null.
 *
 * @returns The previous one, to restore
 * @internal
 */
export function setCurrentSubscriber(tracker: Tracker | null): Tracker | null {
  const prev = currentTracker;
  currentTracker = tracker;
  return prev;
}

/**
 * Starts a run of `tracker`. Its links are marked unread, until a read in
 * this run finds them again.
 *
 * @returns The computation running before, for endTracking()
 * @internal
 */
export function startTracking(tracker: Tracker): Tracker | null {
  for (let link = tracker._sourcesHead; link !== null; link = link.nextSource) {
    const source = link.source;
    link.version = UNREAD;
    link.rollback = source._activeLink;
    source._activeLink = link;
  }
  // The tail is the cursor of the run: links up to it were read in order
  tracker._sourcesTail = null;
  const prev = currentTracker;
  currentTracker = tracker;
  return prev;
}

/**
 * Ends a run of `tracker`. Links the run did not read are unlinked.
 *
 * @internal
 */
export function endTracking(tracker: Tracker, prev: Tracker | null): void {
  currentTracker = prev;
  for (let link = tracker._sourcesHead; link !== null; link = link.nextSource) {
    link.source._activeLink = link.rollback;
    link.rollback = null;
  }
  const last = tracker._sourcesTail;
  let unread: Link | null;
  if (last === null) {
    unread = tracker._sourcesHead;
    tracker._sourcesHead = null;
  } else {
    unread = last.nextSource;
    last.nextSource = null;
  }
  while (unread !== null) {
    const next: Link | null = unread.nextSource;
    unread.prevSource = null;
    unread.nextSource = null;
    unlinkSubscriber(unread);
    unread = next;
  }
}

/**
 * Records that the running computation read `source` at `version`.
 *
 * @internal
 */
export function trackSource(source: Source, version: number): void {
  const tracker = currentTracker;
  if (tracker === null) return;
  const last = tracker._sourcesTail;
  const active = source._activeLink;
  if (active !== null && active.subscriber === tracker) {
    // Read before in this run
    if (active.version !== UNREAD) return;
    active.version = version;
    if (active !== (last === null ? tracker._sourcesHead : last.nextSource)) {
      removeSource(tracker, active);
      insertSource(tracker, active, last);
    }
    tracker._sourcesTail = active;
    return;
  }
  const next = last === null ? tracker._sourcesHead : last.nextSource;
  const link = new Link(source, tracker, version, last, next, active);
  if (last === null) tracker._sourcesHead = link;
  else last.nextSource = link;
  if (next !== null) next.prevSource = link;
  tracker._sourcesTail = link;
  source._activeLink = link;
  if (tracker._linked) appendSubscriber(source, link);
}

/**
 * Whether a source of `tracker` changed since it read it. A tracker that
 * read nothing counts as changed.
 *
 * @internal
 */
export function hasSourcesChanged(tracker: Tracker): boolean {
  let link = tracker._sourcesHead;
  if (link === null) return true;
  for (; link !== null; link = link.nextSource) {
    if (link.source.version !== link.version) return true;
  }
  return false;
}

//=============================================
// Subscriber Lists
//=============================================

/**
 * Puts the links of `tracker` in the subscriber lists of its sources.
 *
 * @internal
 */
export function linkSources(tracker: Tracker): void {
  // An unwatched computed has none of its links in a list
  for (let link = tracker._sourcesHead; link !== null; link = link.nextSource) {
    appendSubscriber(link.source, link);
  }
}

/**
 * Takes the links of `tracker` out of the subscriber lists of its sources.
 * The links stay, for version checks.
 *
 * @internal
 */
export function unlinkSources(tracker: Tracker): void {
  for (let link = tracker._sourcesHead; link !== null; link = link.nextSource) {
    unlinkSubscriber(link);
  }
}

/**
 * Unlinks every source of `tracker` and forgets them.
 *
 * @internal
 */
export function dropSources(tracker: Tracker): void {
  let link = tracker._sourcesHead;
  tracker._sourcesHead = null;
  tracker._sourcesTail = null;
  while (link !== null) {
    const next: Link | null = link.nextSource;
    link.prevSource = null;
    link.nextSource = null;
    unlinkSubscriber(link);
    link = next;
  }
}

/**
 * Notifies every subscriber of `source`.
 *
 * @internal
 */
export function notifySubscribers(source: Source): void {
  let link = source._subscribersHead;
  while (link !== null) {
    // Read first: notifying may unlink this link
    const next: Link | null = link.nextSubscriber;
    scheduleNotification(link.subscriber);
    link = next;
  }
}

/**
 * Empties the subscriber list of a disposed source. Its subscribers keep
 * their links until their next run drops them.
 *
 * @internal
 */
export function clearSubscribers(source: Source): void {
  let link = source._subscribersHead;
  source._subscribersHead = null;
  source._subscribersTail = null;
  while (link !== null) {
    const next: Link | null = link.nextSubscriber;
    link.prevSubscriber = null;
    link.nextSubscriber = null;
    link = next;
  }
}

/**
 * Adds a subscriber that tracks nothing, such as a plain function. Each
 * subscriber is added once.
 *
 * @internal
 */
export function subscribe(source: Source, subscriber: Subscriber): void {
  if (findSubscriber(source, subscriber) === null) {
    appendSubscriber(source, new Link(source, subscriber, 0));
  }
}

/**
 * Removes a subscriber added by subscribe(), or a tracker's link to
 * `source` until its next run reads it again.
 *
 * @internal
 */
export function unsubscribe(source: Source, subscriber: Subscriber): void {
  const link = findSubscriber(source, subscriber);
  if (link !== null) unlinkSubscriber(link);
}

/**
 * The number of subscribers of `source`.
 *
 * @internal
 */
export function countSubscribers(source: Source): number {
  let count = 0;
  for (let l = source._subscribersHead; l !== null; l = l.nextSubscriber) {
    count++;
  }
  return count;
}

/**
 * The subscribers of `source`, in the order they linked in.
 *
 * @internal
 */
export function* subscribersOf(source: Source): Generator<Subscriber> {
  for (let l = source._subscribersHead; l !== null; l = l.nextSubscriber) {
    yield l.subscriber;
  }
}

//=============================================
// Private Functions
//=============================================

function findSubscriber(source: Source, subscriber: Subscriber): Link | null {
  for (let l = source._subscribersHead; l !== null; l = l.nextSubscriber) {
    if (l.subscriber === subscriber) return l;
  }
  return null;
}

/** Appends a link that is in no subscriber list */
function appendSubscriber(source: Source, link: Link): void {
  const tail = source._subscribersTail;
  link.prevSubscriber = tail;
  link.nextSubscriber = null;
  source._subscribersTail = link;
  if (tail !== null) {
    tail.nextSubscriber = link;
  } else {
    source._subscribersHead = link;
    source._watch?.();
  }
}

function unlinkSubscriber(link: Link): void {
  const source = link.source;
  if (!isLinked(source, link)) return;
  const prev = link.prevSubscriber;
  const next = link.nextSubscriber;
  if (prev !== null) prev.nextSubscriber = next;
  else source._subscribersHead = next;
  if (next !== null) next.prevSubscriber = prev;
  else source._subscribersTail = prev;
  link.prevSubscriber = null;
  link.nextSubscriber = null;
  if (source._subscribersHead === null) source._unwatch?.();
}

/** Whether `link` is in the subscriber list of `source` */
function isLinked(source: Source, link: Link): boolean {
  return link.prevSubscriber !== null || source._subscribersHead === link;
}

/** Inserts `link` in the sources of `tracker`, after `after` or first */
function insertSource(tracker: Tracker, link: Link, after: Link | null): void {
  const next = after === null ? tracker._sourcesHead : after.nextSource;
  link.prevSource = after;
  link.nextSource = next;
  if (after === null) tracker._sourcesHead = link;
  else after.nextSource = link;
  if (next !== null) next.prevSource = link;
}

function removeSource(tracker: Tracker, link: Link): void {
  const prev = link.prevSource;
  const next = link.nextSource;
  if (prev !== null) prev.nextSource = next;
  else tracker._sourcesHead = next;
  if (next !== null) next.prevSource = prev;
  link.prevSource = null;
  link.nextSource = null;
}
