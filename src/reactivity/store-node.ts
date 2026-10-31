/**
 * The readers of one key of a store object, or of one entry of a reactive
 * collection.
 *
 * A node is a source like a signal, so a computed that reads it checks its
 * version before reusing a cached value. Its owner creates it for a reactive
 * read and drops it when nobody reads it and its key is gone: the last
 * subscriber leaving calls `idle()`, and `release()` bumps the version so a
 * computed that kept a link to the dropped node recomputes and reads the live
 * one.
 *
 * @module reactivity/store-node
 * @internal
 *
 * ## Known limitations
 *
 * None.
 */

import {
  bumpGlobalVersion,
  clearSubscribers,
  notifySubscribers,
  registerSource,
  subscribersOf,
  trackSource,
  type Link,
  type Source,
  type Subscriber,
} from './signal/internal';

export class StoreNode implements Source {
  /** @internal See Source */
  _subscribersHead: Link | null = null;
  /** @internal */
  _subscribersTail: Link | null = null;
  /** @internal */
  _activeLink: Link | null = null;

  /** Bumped on every notify, for version based dirty checking */
  private _version = 0;

  constructor() {
    registerSource(this);
  }

  get version(): number {
    return this._version;
  }

  /** Whether a reader is subscribed right now */
  get isObserved(): boolean {
    return this._subscribersHead !== null;
  }

  /**
   * Tracks a read by the running computation
   */
  track(): void {
    trackSource(this, this._version);
  }

  subscribers(): Iterable<Subscriber> {
    return subscribersOf(this);
  }

  /**
   * Notifies all subscribers of this node
   */
  notify(): void {
    this._version++;
    bumpGlobalVersion();
    notifySubscribers(this);
  }

  /**
   * Marks the node as dropped by its owner. A computed that read it and kept
   * its link sees the new version and reads again, so it ends up on the node
   * that replaces this one.
   */
  release(): void {
    this._version++;
    bumpGlobalVersion();
  }

  /**
   * Clears all subscribers
   */
  dispose(): void {
    clearSubscribers(this);
  }

  /** @internal The last subscriber left */
  _unwatch(): void {
    this.idle();
  }

  /**
   * Nobody reads this node anymore. The owner drops it here if its key is
   * gone.
   */
  protected idle(): void {}
}
