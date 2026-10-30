/**
 * Reactive Map and Set
 *
 * `ReactiveMap` and `ReactiveSet` are a `Map` and a `Set` that tell the
 * computations reading them when they change. A read of one key re-runs only
 * for that key, and `size` and iteration re-run for what they depend on.
 *
 * A store does not wrap a Map or a Set, so it cannot see them change. Keep a
 * ReactiveMap in a store field instead: the store leaves it alone and the
 * collection does its own tracking.
 *
 * @module reactivity/collections
 *
 * @example
 * ```typescript
 * import { ReactiveMap, effect } from 'signy';
 *
 * const users = new ReactiveMap<number, string>();
 *
 * effect(() => console.log(users.get(1))); // runs for key 1 only
 * users.set(2, 'Grace'); // does not re-run it
 * users.set(1, 'Ada'); // does
 * ```
 *
 * ## Known limitations
 *
 * - A reactive read of a key that was never added, and that nothing reads
 *   anymore, keeps no node. A computed that nobody subscribes to keeps the
 *   node of a key it read until that key is deleted.
 */

import { getCurrentSubscriber } from './signal/internal';
import { StoreNode } from './store-node';

/** The node of one key, dropped when the key is gone and nobody reads it */
class EntryNode<K> extends StoreNode {
  constructor(
    private readonly _tracker: Tracker<K>,
    private readonly _key: K
  ) {
    super();
  }

  protected override idle(): void {
    this._tracker.release(this._key, this);
  }
}

/**
 * The nodes of one collection: one per key that a reactive read asked for,
 * one for the shape (size and keys) and one for every change (values).
 */
class Tracker<K> {
  private readonly _nodes = new Map<K, EntryNode<K>>();
  private _shape: StoreNode | null = null;
  private _changes: StoreNode | null = null;

  constructor(private readonly _has: (key: K) => boolean) {}

  trackKey(key: K): void {
    if (getCurrentSubscriber() === null) return;
    let node = this._nodes.get(key);
    if (!node) {
      node = new EntryNode(this, key);
      this._nodes.set(key, node);
    }
    node.track();
  }

  trackShape(): void {
    if (getCurrentSubscriber() === null) return;
    (this._shape ??= new StoreNode()).track();
  }

  trackChanges(): void {
    if (getCurrentSubscriber() === null) return;
    (this._changes ??= new StoreNode()).track();
  }

  /** A key was added, or its value changed */
  changed(key: K, added: boolean): void {
    this._nodes.get(key)?.notify();
    if (added) this._shape?.notify();
    this._changes?.notify();
  }

  /** A key was removed */
  removed(key: K): void {
    const node = this._nodes.get(key);
    if (node) {
      node.notify();
      this.release(key, node);
    }
    this._shape?.notify();
    this._changes?.notify();
  }

  /** Every key was removed */
  cleared(): void {
    for (const [key, node] of [...this._nodes]) {
      node.notify();
      this.release(key, node);
    }
    this._shape?.notify();
    this._changes?.notify();
  }

  /** Drops the node of a key that is gone, once nobody reads it */
  release(key: K, node: EntryNode<K>): void {
    if (node.isObserved || this._has(key)) return;
    if (this._nodes.get(key) === node) {
      this._nodes.delete(key);
      node.release();
    }
  }
}

const mapSize = Object.getOwnPropertyDescriptor(Map.prototype, 'size')!.get!;
const setSize = Object.getOwnPropertyDescriptor(Set.prototype, 'size')!.get!;

/**
 * A Map that notifies the computations that read it.
 *
 * - `get(key)` and `has(key)` re-run for that key only.
 * - `size` and `keys()` re-run when a key is added or removed.
 * - `values()`, `entries()`, `forEach()` and iteration re-run on any change.
 *
 * Read it inside a computation, such as an effect or a binding. A write with
 * the value a key already has changes nothing.
 */
export class ReactiveMap<K, V> extends Map<K, V> {
  private readonly _tracker: Tracker<K>;

  constructor(entries?: Iterable<readonly [K, V]> | null) {
    // Not super(entries): Map would call the overridden set() before the
    // tracker exists
    super();
    this._tracker = new Tracker((key) => Map.prototype.has.call(this, key));
    if (entries) for (const [key, value] of entries) super.set(key, value);
  }

  override get size(): number {
    this._tracker.trackShape();
    return mapSize.call(this) as number;
  }

  override get(key: K): V | undefined {
    this._tracker.trackKey(key);
    return super.get(key);
  }

  override has(key: K): boolean {
    this._tracker.trackKey(key);
    return super.has(key);
  }

  override set(key: K, value: V): this {
    const had = super.has(key);
    if (had && Object.is(super.get(key), value)) return this;
    super.set(key, value);
    this._tracker.changed(key, !had);
    return this;
  }

  override delete(key: K): boolean {
    if (!super.delete(key)) return false;
    this._tracker.removed(key);
    return true;
  }

  override clear(): void {
    if (mapSize.call(this) === 0) return;
    super.clear();
    this._tracker.cleared();
  }

  override keys(): MapIterator<K> {
    this._tracker.trackShape();
    return super.keys();
  }

  override values(): MapIterator<V> {
    this._tracker.trackChanges();
    return super.values();
  }

  override entries(): MapIterator<[K, V]> {
    this._tracker.trackChanges();
    return super.entries();
  }

  override forEach(
    callback: (value: V, key: K, map: Map<K, V>) => void,
    thisArg?: unknown
  ): void {
    this._tracker.trackChanges();
    super.forEach(callback, thisArg);
  }

  override [Symbol.iterator](): MapIterator<[K, V]> {
    this._tracker.trackChanges();
    return super[Symbol.iterator]();
  }
}

/**
 * A Set that notifies the computations that read it.
 *
 * - `has(value)` re-runs for that value only.
 * - `size`, `values()`, `keys()`, `entries()`, `forEach()` and iteration
 *   re-run when a value is added or removed.
 *
 * Read it inside a computation, such as an effect or a binding.
 */
export class ReactiveSet<T> extends Set<T> {
  private readonly _tracker: Tracker<T>;

  constructor(values?: Iterable<T> | null) {
    super();
    this._tracker = new Tracker((value) => Set.prototype.has.call(this, value));
    if (values) for (const value of values) super.add(value);
  }

  override get size(): number {
    this._tracker.trackShape();
    return setSize.call(this) as number;
  }

  override has(value: T): boolean {
    this._tracker.trackKey(value);
    return super.has(value);
  }

  override add(value: T): this {
    if (super.has(value)) return this;
    super.add(value);
    this._tracker.changed(value, true);
    return this;
  }

  override delete(value: T): boolean {
    if (!super.delete(value)) return false;
    this._tracker.removed(value);
    return true;
  }

  override clear(): void {
    if (setSize.call(this) === 0) return;
    super.clear();
    this._tracker.cleared();
  }

  override values(): SetIterator<T> {
    this._tracker.trackShape();
    return super.values();
  }

  override keys(): SetIterator<T> {
    this._tracker.trackShape();
    return super.keys();
  }

  override entries(): SetIterator<[T, T]> {
    this._tracker.trackShape();
    return super.entries();
  }

  override forEach(
    callback: (value: T, value2: T, set: Set<T>) => void,
    thisArg?: unknown
  ): void {
    this._tracker.trackShape();
    super.forEach(callback, thisArg);
  }

  override [Symbol.iterator](): SetIterator<T> {
    this._tracker.trackShape();
    return super[Symbol.iterator]();
  }
}
