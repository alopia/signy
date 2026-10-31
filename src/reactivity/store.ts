/**
 * Reactive Stores
 *
 * Stores provide fine-grained reactivity for objects and arrays.
 * Built on Proxy for automatic dependency tracking at the property level.
 *
 * Provides both class-based and factory function APIs:
 * - `new ReactiveStore(initialValue)` - Class for full control
 * - `store(initialValue)` - Factory function
 *
 * Inspired by Solid.js stores with path-based updates.
 *
 * @module reactivity/store
 *
 * @example
 * ```typescript
 * import { store } from 'signy';
 *
 * // Create a store
 * const myStore = store({
 *   user: { name: 'Alice', age: 25 },
 *   items: [1, 2, 3]
 * });
 *
 * // Read values (tracks dependencies)
 * console.log(myStore.state.user.name); // 'Alice'
 *
 * // Update with path-based setter
 * myStore.set('user', 'name', 'Bob');
 *
 * // Functional update
 * myStore.set('user', 'age', age => age + 1);
 *
 * // Merge object at root
 * myStore.merge({ user: { name: 'Carol', age: 30 } });
 *
 * // Array operations
 * myStore.set('items', items => [...items, 4]);
 * ```
 *
 * ## Known limitations
 *
 * **No circular reference handling**: `deepClone` and `unwrap` do not
 * handle circular object references and will cause a stack overflow.
 * Avoid storing objects with circular references in stores, the initial
 * value included.
 *
 * ## Known Behaviors
 *
 * **Per key tracking**: a write notifies the readers of the written key of
 * that object, never the readers of its parents. Readers are kept per object,
 * so an object that moves to another index keeps them. Reading the key list
 * (`Object.keys`, `for...in`, `in`) subscribes to key additions and deletions.
 *
 * **Exotic objects excluded**: Date, RegExp, Map, Set, WeakMap, WeakSet,
 * and frozen objects are not wrapped in proxies. They are stored as-is
 * and changes to them won't be tracked. A ReactiveMap or a ReactiveSet in a
 * store field tracks itself, and a clone of the store keeps it one.
 *
 * **Dropped nodes**: a key node leaves its object once nobody reads it and
 * its key is gone, so a store used as a map does not grow with every id it
 * has seen. A computed that nobody subscribes to never triggers the release,
 * so the node of an absent key that only it read stays until that key has
 * come and gone.
 *
 * **Initial value cloned**: The arrays, plain objects, Dates, Maps and Sets
 * of the initial value are deep cloned, so the store owns its copy, frozen
 * objects included. Other objects, such as class instances, are kept as they
 * are, as `set()` keeps them, and `unwrap()` returns them as they are.
 */

import { getCurrentSubscriber } from './signal/internal';
import { ReactiveMap, ReactiveSet } from './collections';
import { StoreNode } from './store-node';
import { batch } from './signal';
import { untrack } from './signal/subtle';
import { panic } from '../log';
import { ReactiveLogMessages } from './log-messages';

//=============================================
// Types
//=============================================

/**
 * Options for creating a store
 */
export interface StoreOptions {
  /**
   * Name for debugging purposes.
   */
  name?: string;
}

/**
 * Path segment type - string for object keys, number for array indices
 */
type PathSegment = string | number;

/**
 * Store setter function with multiple overloads for different update patterns
 */
export interface StoreSetter<T> {
  /** Merge an object at root level */
  (value: Partial<T>): void;
  /** Replace with function */
  (fn: (prev: T) => T): void;
  /** Set a specific path with value */
  <K extends keyof T>(key: K, value: T[K] | ((prev: T[K]) => T[K])): void;
  /** Set nested path (2 levels) */
  <K1 extends keyof T, K2 extends keyof T[K1]>(
    k1: K1,
    k2: K2,
    value: T[K1][K2] | ((prev: T[K1][K2]) => T[K1][K2])
  ): void;
  /** Set nested path (3 levels) */
  <K1 extends keyof T, K2 extends keyof T[K1], K3 extends keyof T[K1][K2]>(
    k1: K1,
    k2: K2,
    k3: K3,
    value: T[K1][K2][K3] | ((prev: T[K1][K2][K3]) => T[K1][K2][K3])
  ): void;
  /** Set nested path (4 levels) */
  <
    K1 extends keyof T,
    K2 extends keyof T[K1],
    K3 extends keyof T[K1][K2],
    K4 extends keyof T[K1][K2][K3],
  >(
    k1: K1,
    k2: K2,
    k3: K3,
    k4: K4,
    value: T[K1][K2][K3][K4] | ((prev: T[K1][K2][K3][K4]) => T[K1][K2][K3][K4])
  ): void;
  /** Generic path-based setter */
  (...args: [...PathSegment[], unknown]): void;
}

//=============================================
// Symbols
//=============================================

/**
 * Symbol of the key nodes kept on each raw object that was read reactively
 */
const STORE_NODES = Symbol('store-nodes');

/**
 * Symbol to check if an object is a store proxy
 */
const IS_STORE_PROXY = Symbol('is-store-proxy');

/**
 * Symbol to read the raw object behind a store proxy
 */
const STORE_RAW = Symbol('store-raw');

/**
 * Symbol to read the raw object behind a produce() draft
 */
const DRAFT_RAW = Symbol('draft-raw');

/**
 * Symbol of the recipe on an updater made by produce(), so the store can run
 * it on a draft of its state instead of on a clone
 */
const PRODUCE_RECIPE = Symbol('produce-recipe');

const hasOwn = Object.prototype.hasOwnProperty;

/** An own `__proto__` key, as JSON.parse() makes, would swap a prototype */
const PROTO_KEY = '__proto__';

/** Explicit writes to `__proto__` are refused, data payloads skip it */
function refuseProtoKey(key: PropertyKey): void {
  if (key === PROTO_KEY) panic(ReactiveLogMessages.STORE_UNSAFE_KEY, { key });
}

//=============================================
// Key nodes (Internal)
//=============================================

/**
 * Readers of one key of one object in the store. Nodes live on the raw
 * object, not on a path, so an object that moves to another index or key
 * keeps its readers. A reader of `state.a.b.c` also read `a` and `b` on the
 * way, so replacing `a` re-runs it without walking what is below.
 *
 * A node leaves its object when nobody reads it and the key is gone, so a
 * store used as a map does not keep a node for every id it ever saw.
 */
class KeyNode extends StoreNode {
  constructor(
    private readonly _owner: object,
    private readonly _key: string
  ) {
    super();
  }

  protected override idle(): void {
    releaseKey(this._owner, this._key, this);
  }
}

/** The key nodes of one raw object */
interface ObjectNodes {
  byKey: Map<string, StoreNode>;
  /** Readers of the key list (`Object.keys`, `in`) */
  keys: StoreNode | null;
}

/** Nodes of sealed objects, which cannot take the symbol property */
const sealedNodes = new WeakMap<object, ObjectNodes>();

function peekNodes(obj: object): ObjectNodes | undefined {
  return (
    (obj as { [STORE_NODES]?: ObjectNodes })[STORE_NODES] ??
    sealedNodes.get(obj)
  );
}

function nodesOf(obj: object): ObjectNodes {
  let nodes = peekNodes(obj);
  if (!nodes) {
    nodes = { byKey: new Map(), keys: null };
    if (Object.isExtensible(obj)) {
      // Not enumerable, so clones and Object.keys() never see it
      Object.defineProperty(obj, STORE_NODES, { value: nodes });
    } else {
      sealedNodes.set(obj, nodes);
    }
  }
  return nodes;
}

/** Tracks a read of one key, creating its node only for a reactive reader */
function trackKey(obj: object, key: PathSegment): void {
  if (getCurrentSubscriber() === null) return;
  const { byKey } = nodesOf(obj);
  const name = typeof key === 'string' ? key : String(key);
  let node = byKey.get(name);
  if (!node) {
    node = new KeyNode(obj, name);
    byKey.set(name, node);
  }
  node.track();
}

/**
 * How many key nodes the raw object behind a store proxy holds. For tests.
 *
 * @internal
 */
export function keyNodeCount(value: object): number {
  const raw = (value as { [STORE_RAW]?: object })[STORE_RAW] ?? value;
  return peekNodes(raw)?.byKey.size ?? 0;
}

/** Tracks a read of the key list */
function trackKeyList(obj: object): void {
  if (getCurrentSubscriber() === null) return;
  const nodes = nodesOf(obj);
  (nodes.keys ??= new StoreNode()).track();
}

function notifyKey(obj: object, key: PathSegment): void {
  peekNodes(obj)?.byKey.get(String(key))?.notify();
}

function notifyKeyList(obj: object): void {
  peekNodes(obj)?.keys?.notify();
}

/**
 * A key left the object. Its readers re-run, and the node goes now if nobody
 * reads it. Readers that stay subscribed through the re-run keep it, and the
 * last one to leave drops it.
 */
function notifyRemoved(obj: object, key: PathSegment): void {
  const name = String(key);
  const node = peekNodes(obj)?.byKey.get(name);
  if (!node) return;
  node.notify();
  releaseKey(obj, name, node);
}

/** Drops the node of a key that is gone, once nobody reads it */
function releaseKey(obj: object, key: string, node: StoreNode): void {
  if (node.isObserved || hasOwn.call(obj, key)) return;
  const byKey = peekNodes(obj)?.byKey;
  if (byKey?.get(key) === node) {
    byKey.delete(key);
    node.release();
  }
}

/** Clears the subscribers of every node in a raw tree, for dispose() */
function clearNodes(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  const nodes = peekNodes(value);
  if (nodes) {
    for (const node of nodes.byKey.values()) node.dispose();
    nodes.keys?.dispose();
  }
  for (const key of Object.keys(value)) {
    clearNodes((value as Record<string, unknown>)[key], seen);
  }
}

/**
 * Checks if a value should be wrapped in a proxy.
 * Excludes exotic objects that don't work correctly with Proxy.
 */
function isWrappable(value: unknown): value is object {
  if (value === null || typeof value !== 'object') return false;
  // Plain objects and arrays, the common case, skip the instanceof checks
  const proto = Object.getPrototypeOf(value);
  if (
    proto !== Object.prototype &&
    proto !== Array.prototype &&
    proto !== null &&
    (value instanceof Date || // Date methods fail through Proxy
      value instanceof RegExp || // RegExp has internal slots
      value instanceof Map || // Map/Set methods fail through Proxy
      value instanceof Set ||
      value instanceof WeakMap ||
      value instanceof WeakSet)
  ) {
    return false;
  }
  return (
    !(value as Record<symbol, unknown>)[IS_STORE_PROXY] &&
    !Object.isFrozen(value)
  );
}

/**
 * Deep clones a value, unwrapping any store proxies without tracking them.
 * Handles objects, arrays, Map, Set and Date.
 */
function deepClone<T>(value: T): T {
  // A store proxy passed in (unwrap(store.state)) is read through its raw
  // object, so the copy does not track. Below it the state holds raw objects.
  const raw =
    value !== null && typeof value === 'object'
      ? (value as Record<symbol, unknown>)[STORE_RAW]
      : undefined;
  return cloneRaw((raw ?? value) as T);
}

function cloneRaw<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => cloneRaw(item)) as T;
  }

  if (value instanceof Date) return new Date(value.getTime()) as T;
  // A reactive collection stays one. The prototype methods read it without
  // tracking, as a clone is not a reader.
  if (value instanceof Map) {
    const map = value instanceof ReactiveMap ? new ReactiveMap() : new Map();
    for (const [k, v] of Map.prototype.entries.call(value)) {
      map.set(cloneRaw(k), cloneRaw(v));
    }
    return map as T;
  }
  if (value instanceof Set) {
    const set = value instanceof ReactiveSet ? new ReactiveSet() : new Set();
    for (const v of Set.prototype.values.call(value)) set.add(cloneRaw(v));
    return set as T;
  }

  // A class instance or a WeakMap stays as it is, as set() keeps it: a copy
  // would lose its prototype
  // constructor first, a fast read: a plain object answers Object
  if ((value as { constructor?: unknown }).constructor !== Object) {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
  }

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (key === PROTO_KEY) continue;
    result[key] = cloneRaw((value as Record<string, unknown>)[key]);
  }
  return result as T;
}

/**
 * Writes one key and notifies its readers, plus the key list readers when the
 * key is new. Array length changes from an index write are notified too.
 */
function writeKey(
  obj: Record<PathSegment, unknown>,
  key: PathSegment,
  value: unknown
): void {
  const isArray = Array.isArray(obj);
  // A shorter length removes indices, and their readers must hear it
  if (isArray && key === 'length') {
    setLength(obj as unknown[], value as number);
    return;
  }
  const length = isArray ? (obj as unknown[]).length : 0;
  const isNew = !hasOwn.call(obj, key);
  obj[key] = value;
  notifyKey(obj, key);
  if (isNew) notifyKeyList(obj);
  if (isArray && key !== 'length' && (obj as unknown[]).length !== length) {
    notifyKey(obj, 'length');
  }
}

/**
 * Deletes one key and notifies its readers and the key list readers.
 */
function deleteKey(obj: Record<PathSegment, unknown>, key: PathSegment): void {
  delete obj[key];
  notifyRemoved(obj, key);
  notifyKeyList(obj);
}

/**
 * Copies `source` into `target` key by key, notifying only the keys whose
 * value changed. Plain objects (and arrays, when `replace` is set) are
 * updated in place, so their proxies keep their identity.
 *
 * @param replace - Delete keys missing from `source` and update arrays by
 *   index. Without it, this is a merge and arrays are replaced whole.
 * @param proxies - The store's proxies, to tell objects handed out as one
 */
function applyInto(
  target: Record<PathSegment, unknown>,
  source: Record<PathSegment, unknown>,
  replace: boolean,
  proxies: WeakMap<object, object>
): void {
  if (replace && Array.isArray(target) && Array.isArray(source)) {
    for (let i = 0; i < source.length; i++) {
      applyKey(target, i, source[i], replace, proxies);
    }
    if (target.length > source.length) {
      const oldLength = target.length;
      target.length = source.length;
      for (let i = source.length; i < oldLength; i++) notifyRemoved(target, i);
      notifyKey(target, 'length');
      notifyKeyList(target);
    }
    return;
  }

  // for...in, not Object.keys(), to skip an array per object on large updates
  for (const key in source) {
    if (hasOwn.call(source, key) && key !== PROTO_KEY) {
      applyKey(target, key, source[key], replace, proxies);
    }
  }
  if (replace) {
    for (const key in target) {
      if (hasOwn.call(target, key) && !hasOwn.call(source, key)) {
        deleteKey(target, key);
      }
    }
  }
}

function applyKey(
  target: Record<PathSegment, unknown>,
  key: PathSegment,
  value: unknown,
  replace: boolean,
  proxies: WeakMap<object, object>
): void {
  const current = target[key];
  if (Object.is(current, value) && hasOwn.call(target, key)) return;
  // An object never handed out as a proxy has no readers and no holders, so
  // update() replaces it whole instead of comparing. merge() still merges
  // into it, to keep the keys it does not mention.
  if (
    (!replace || proxies.has(current as object)) &&
    isWrappable(current) &&
    isWrappable(value) &&
    Array.isArray(current) === Array.isArray(value) &&
    (replace || !Array.isArray(value))
  ) {
    applyInto(
      current as Record<PathSegment, unknown>,
      value as Record<PathSegment, unknown>,
      replace,
      proxies
    );
    return;
  }
  writeKey(target, key, value);
}

/**
 * Creates a reactive proxy for an object or array
 */
function createProxy<T extends object>(
  target: T,
  proxyCache: WeakMap<object, object>
): T {
  // Return cached proxy if exists
  const cached = proxyCache.get(target);
  if (cached) {
    return cached as T;
  }

  const proxy = new Proxy(target, {
    get(obj, prop, receiver) {
      // Special symbols
      if (prop === IS_STORE_PROXY) {
        return true;
      }
      if (prop === STORE_RAW) {
        return obj;
      }

      const value = Reflect.get(obj, prop, receiver);

      // Don't track or wrap symbols or non-enumerable built-ins
      if (typeof prop === 'symbol') {
        return value;
      }

      // Track access to this property
      trackKey(obj, prop);

      // Wrap nested objects/arrays. A cached proxy skips the checks
      if (value !== null && typeof value === 'object') {
        const cached = proxyCache.get(value);
        if (cached) return cached;
        if (prop !== PROTO_KEY && isWrappable(value)) {
          return createProxy(value, proxyCache);
        }
      }

      return value;
    },

    set(obj, prop, value, receiver) {
      if (typeof prop === 'symbol') {
        return Reflect.set(obj, prop, value, receiver);
      }

      refuseProtoKey(prop);
      const record = obj as Record<PathSegment, unknown>;
      if (!Object.is(record[prop], value) || !hasOwn.call(record, prop)) {
        batch(() => writeKey(record, prop, value));
      }

      return true;
    },

    deleteProperty(obj, prop) {
      if (typeof prop === 'symbol') {
        return Reflect.deleteProperty(obj, prop);
      }

      if (hasOwn.call(obj, prop)) {
        batch(() => deleteKey(obj as Record<PathSegment, unknown>, prop));
      }
      return true;
    },

    has(obj, prop) {
      if (typeof prop !== 'symbol') {
        trackKeyList(obj);
      }
      return Reflect.has(obj, prop);
    },

    ownKeys(obj) {
      trackKeyList(obj);
      return Reflect.ownKeys(obj);
    },
  });

  proxyCache.set(target, proxy);
  return proxy as T;
}

/**
 * Runs a produce() recipe on a draft of `target`. Each write to the draft
 * goes to the raw state and notifies that key, so the cost is the keys
 * touched, not the size of the state. Reads are not tracked.
 *
 * A write replaces the reference, as in Solid. Merging in place would change
 * objects the recipe still holds, such as the one splice() returned.
 */
function runRecipe(
  target: object,
  recipe: (draft: never) => void,
  proxies: WeakMap<object, object>
): void {
  const drafts = new Map<object, object>();
  // Map, Set and Date are copied on first read, as their methods write in place
  const copies = new WeakSet<object>();

  const draftOf = (obj: object): object => {
    let draft = drafts.get(obj);
    if (draft) return draft;
    draft = new Proxy(obj, {
      get(raw, prop, receiver) {
        if (prop === DRAFT_RAW) return raw;
        const value = Reflect.get(raw, prop, receiver);
        if (typeof prop === 'symbol' || value === null) return value;
        if (typeof value !== 'object' || prop === PROTO_KEY) return value;
        if (isWrappable(value)) return draftOf(value);
        if (
          !copies.has(value) &&
          (value instanceof Map ||
            value instanceof Set ||
            value instanceof Date)
        ) {
          const copy = cloneRaw(value);
          copies.add(copy);
          writeKey(raw as Record<PathSegment, unknown>, prop, copy);
          return copy;
        }
        return value;
      },

      set(raw, prop, value, receiver) {
        if (typeof prop === 'symbol') {
          return Reflect.set(raw, prop, value, receiver);
        }
        refuseProtoKey(prop);
        const record = raw as Record<PathSegment, unknown>;
        const next = materialize(value, proxies);
        if (Array.isArray(raw) && prop === 'length') {
          setLength(raw, next as number);
        } else if (
          !Object.is(record[prop], next) ||
          !hasOwn.call(record, prop)
        ) {
          writeKey(record, prop, next);
        }
        return true;
      },

      deleteProperty(raw, prop) {
        if (typeof prop === 'symbol') return Reflect.deleteProperty(raw, prop);
        if (hasOwn.call(raw, prop)) {
          deleteKey(raw as Record<PathSegment, unknown>, prop);
        }
        return true;
      },
    });
    drafts.set(obj, draft);
    return draft;
  };

  untrack(() => recipe(draftOf(target) as never));
}

/**
 * The value to store for one written to a draft. A draft, or a proxy of this
 * store, becomes its raw object, so a moved object keeps its identity. A
 * proxy of another store is copied.
 */
function materialize(
  value: unknown,
  proxies: WeakMap<object, object>
): unknown {
  if (value === null || typeof value !== 'object') return value;
  const draftRaw = (value as Record<symbol, unknown>)[DRAFT_RAW];
  if (draftRaw) return draftRaw;
  const storeRaw = (value as Record<symbol, unknown>)[STORE_RAW] as
    object | undefined;
  if (storeRaw) return proxies.has(storeRaw) ? storeRaw : cloneRaw(storeRaw);
  // A new array or object may hold drafts, as filter() and map() return
  const proto = Object.getPrototypeOf(value);
  if (proto === Array.prototype || proto === Object.prototype) {
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === PROTO_KEY) continue;
      const item = record[key];
      const next = materialize(item, proxies);
      if (next !== item) record[key] = next;
    }
  }
  return value;
}

/** Sets an array length, notifying the indices a shorter length removes */
function setLength(arr: unknown[], length: number): void {
  const oldLength = arr.length;
  if (length === oldLength) return;
  arr.length = length;
  for (let i = length; i < oldLength; i++) notifyRemoved(arr, i);
  notifyKey(arr, 'length');
  if (length < oldLength) notifyKeyList(arr);
}

/**
 * The value at a path, through own keys only: an inherited `constructor`
 * would lead to Object, and its `prototype` to Object.prototype
 */
function getAtPath(obj: unknown, path: PathSegment[]): unknown {
  let current = obj;
  for (const key of path) {
    if (current == null) return undefined;
    current = ownValue(current as Record<PathSegment, unknown>, key);
  }
  return current;
}

/**
 * `obj[key]`, or undefined when it is inherited. What a path can inherit from
 * Object.prototype or Array.prototype is a function (`constructor`, `map`), so
 * only a function needs the own check.
 */
function ownValue(
  obj: Record<PathSegment, unknown>,
  key: PathSegment
): unknown {
  const value = obj[key];
  return typeof value === 'function' && !hasOwn.call(obj, key)
    ? undefined
    : value;
}

//=============================================
// ReactiveStore Class
//=============================================

export { ReactiveMap, ReactiveSet };

/**
 * A reactive store that provides fine-grained reactivity for objects and arrays.
 *
 * Each property access is tracked separately, allowing for precise updates
 * that only re-run effects that depend on changed data. Built on Proxy for
 * automatic dependency tracking at the property level.
 *
 * @template T - Type of the store value (must be an object)
 *
 * @example
 * ```typescript
 * // Using the class directly
 * const store = new ReactiveStore({
 *   user: { name: 'Alice', age: 25 },
 *   settings: { theme: 'dark' }
 * });
 *
 * // Read values (automatically tracks dependencies)
 * console.log(store.state.user.name); // 'Alice'
 *
 * // Path-based updates
 * store.set('user', 'name', 'Bob');
 * store.set('user', 'age', age => age + 1);
 *
 * // Merge at root
 * store.merge({ settings: { theme: 'light' } });
 *
 * // Full state update
 * store.update(prev => ({
 *   ...prev,
 *   user: { ...prev.user, name: 'Carol' }
 * }));
 *
 * // Later: dispose to clear all subscribers
 * store.dispose();
 * ```
 */
export class ReactiveStore<T extends object> {
  //=============================================
  // Private Fields
  //=============================================

  /** The underlying state object */
  private readonly _state: T;

  /** Cache for proxies to ensure identity */
  private readonly _proxyCache: WeakMap<object, object>;

  /** The reactive proxy */
  private readonly _proxy: T;

  /** Debug name */
  private readonly _name: string | undefined;

  /** Whether this store has been disposed */
  private _disposed = false;

  //=============================================
  // Constructor
  //=============================================

  /**
   * Creates a new reactive store.
   *
   * @param initialValue - Initial state object
   * @param options - Store configuration options
   */
  constructor(initialValue: T, options: StoreOptions = {}) {
    // The store owns its copy. The same clone as set(), update() and unwrap(),
    // so a class instance or a ReactiveMap is kept as it is on every path.
    this._state = deepClone(initialValue);
    this._name = options.name;

    // Cache for proxies to ensure identity
    this._proxyCache = new WeakMap<object, object>();

    // Create the reactive proxy
    this._proxy = createProxy(this._state, this._proxyCache);
  }

  //=============================================
  // Getters
  //=============================================

  /**
   * Gets the reactive proxy for reading state.
   * Property accesses are automatically tracked.
   */
  get state(): T {
    if (this._disposed) {
      panic(
        ReactiveLogMessages.STORE_DISPOSED,
        `Cannot access disposed store${this._name ? ` "${this._name}"` : ''}`
      );
    }
    return this._proxy;
  }

  /**
   * Debug name for this store
   */
  get name(): string | undefined {
    return this._name;
  }

  /**
   * Whether this store has been disposed
   */
  get disposed(): boolean {
    return this._disposed;
  }

  //=============================================
  // Public Methods
  //=============================================

  /**
   * Sets a value at a path in the store.
   *
   * @param args - Path segments followed by value or updater function
   *
   * @example
   * ```typescript
   * store.set('user', 'name', 'Bob');
   * store.set('user', 'age', age => age + 1);
   * store.set('items', 0, 'first');
   * ```
   */
  set(...args: [...PathSegment[], unknown]): void {
    if (this._disposed) {
      panic(
        ReactiveLogMessages.STORE_DISPOSED,
        `Cannot update disposed store${this._name ? ` "${this._name}"` : ''}`
      );
    }

    if (args.length < 2) {
      return;
    }
    const path = args.slice(0, -1) as PathSegment[];
    // The path walks own keys, see ownValue(), so constructor then prototype
    // cannot reach a prototype. Only __proto__ is refused.
    for (const key of path) {
      if (key === PROTO_KEY) {
        panic(ReactiveLogMessages.STORE_UNSAFE_KEY, { key });
      }
    }

    batch(() => {
      const valueOrFn = args[args.length - 1];

      // Get current value
      const currentValue = getAtPath(this._state, path);

      const recipe = recipeOf(valueOrFn);
      if (recipe && isWrappable(currentValue)) {
        runRecipe(currentValue, recipe, this._proxyCache);
        return;
      }

      // Resolve the actual value
      let newValue: unknown;
      if (typeof valueOrFn === 'function') {
        newValue = (valueOrFn as (prev: unknown) => unknown)(currentValue);
      } else {
        newValue = valueOrFn;
      }

      // Check if value actually changed
      if (Object.is(currentValue, newValue)) {
        return;
      }

      // Create missing intermediate objects or arrays, based on the next key
      let parent = this._state as Record<PathSegment, unknown>;
      for (let i = 0; i < path.length - 1; i++) {
        const key = path[i]!;
        if (ownValue(parent, key) == null) {
          writeKey(parent, key, typeof path[i + 1] === 'number' ? [] : {});
        }
        parent = parent[key] as Record<PathSegment, unknown>;
      }
      writeKey(parent, path[path.length - 1]!, newValue);
    });
  }

  /**
   * Merges an object into the store at root level. Nested plain objects are
   * merged too, arrays are replaced. Only the keys whose value changed notify.
   *
   * @param partial - Partial object to merge
   *
   * @example
   * ```typescript
   * store.merge({ settings: { theme: 'light' } });
   * ```
   */
  merge(partial: Partial<T>): void {
    if (this._disposed) {
      panic(
        ReactiveLogMessages.STORE_DISPOSED,
        `Cannot update disposed store${this._name ? ` "${this._name}"` : ''}`
      );
    }

    batch(() => {
      applyInto(
        this._state as Record<PathSegment, unknown>,
        partial as Record<PathSegment, unknown>,
        false,
        this._proxyCache
      );
    });
  }

  /**
   * Replaces the entire store with what a function returns. Keys missing from
   * the result are deleted. Only the keys whose value changed notify.
   *
   * @param fn - Function that receives current state and returns new state
   *
   * @example
   * ```typescript
   * store.update(prev => ({
   *   ...prev,
   *   user: { ...prev.user, name: 'Carol' }
   * }));
   * ```
   */
  update(fn: (prev: T) => T): void {
    if (this._disposed) {
      panic(
        ReactiveLogMessages.STORE_DISPOSED,
        `Cannot update disposed store${this._name ? ` "${this._name}"` : ''}`
      );
    }

    batch(() => {
      const recipe = recipeOf(fn);
      if (recipe) {
        runRecipe(this._state, recipe, this._proxyCache);
        return;
      }
      // Pass a clone to prevent direct mutation of internal state
      const newState = fn(deepClone(this._state));
      applyInto(
        this._state as Record<PathSegment, unknown>,
        newState as Record<PathSegment, unknown>,
        true,
        this._proxyCache
      );
    });
  }

  /**
   * Gets a plain copy of the store data (unwrapped).
   * Useful for serialization.
   */
  unwrap(): T {
    return deepClone(this._state);
  }

  /**
   * Disposes this store, clearing all subscribers.
   * The store can no longer be accessed after disposal.
   */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    clearNodes(this._state);
  }

  /**
   * Creates a setter that picks update(), merge() or set() by its arguments.
   * @internal
   */
  _createSetter(): StoreSetter<T> {
    return ((...args: unknown[]) => {
      if (args.length === 0) {
        return;
      }

      // Single argument cases
      if (args.length === 1) {
        const arg = args[0];

        // Function updater - replace entire state
        if (typeof arg === 'function') {
          this.update(arg as (prev: T) => T);
          return;
        }

        // Object (non-array) - merge at root. An array alone is ignored, as
        // merge() takes object keys
        if (typeof arg === 'object' && arg !== null && !Array.isArray(arg)) {
          this.merge(arg as Partial<T>);
          return;
        }

        return;
      }

      // Path-based update
      this.set(...(args as [...PathSegment[], unknown]));
    }) as StoreSetter<T>;
  }
}

/**
 * Creates a new reactive store.
 *
 * Factory function shorthand for `new ReactiveStore(value, options)`.
 *
 * @template T - Type of the store value (must be an object)
 * @param value - Initial value of the store
 * @param options - Optional store configuration
 * @returns A new ReactiveStore instance
 *
 * @example
 * ```typescript
 * import { store } from 'signy';
 *
 * const state = store({ count: 0, user: { name: 'Alice' } });
 *
 * // Read values (tracks dependencies)
 * console.log(state.state.count); // 0
 *
 * // Update with path-based setter
 * state.set('count', 5);
 * state.set('user', 'name', 'Bob');
 * ```
 */
export function store<T extends object>(
  value: T,
  options?: StoreOptions
): ReactiveStore<T> {
  return new ReactiveStore(value, options);
}

//=============================================
// Public API Functions
//=============================================

/**
 * Unwraps a store proxy to get the underlying raw object.
 * Useful for serialization or when you need the plain data.
 *
 * @template T - Type of the store value
 * @param store - The store proxy
 * @returns A plain copy of the store data
 *
 * @example
 * ```typescript
 * const state = store({ count: 0 });
 * const plain = unwrap(state.state);
 * console.log(JSON.stringify(plain)); // {"count":0}
 * ```
 */
export function unwrap<T extends object>(store: T): T {
  return deepClone(store);
}

/**
 * Produces a new state using an immer-style recipe function.
 * Allows mutable-style updates that result in immutable changes.
 *
 * @template T - Type of the state
 * @param fn - Recipe function that mutates a draft
 * @returns An updater function for `update()` or `set()`
 *
 * @example
 * ```typescript
 * const state = store({
 *   items: [{ id: 1, done: false }]
 * });
 *
 * state.update(produce(draft => {
 *   draft.items.push({ id: 2, done: true });
 *   draft.items[0].done = true;
 * }));
 * ```
 */
export function produce<T extends object>(
  fn: (draft: T) => void
): (prev: T) => T {
  const updater = (prev: T) => {
    const draft = deepClone(prev);
    fn(draft);
    return draft;
  };
  // A store runs the recipe on a draft instead, see runRecipe()
  (updater as ProduceUpdater<T>)[PRODUCE_RECIPE] = fn;
  return updater;
}

/** An updater made by produce() */
type ProduceUpdater<T> = ((prev: T) => T) & {
  [PRODUCE_RECIPE]?: (draft: T) => void;
};

/** The recipe of an updater made by produce(), if it is one */
function recipeOf(value: unknown): ((draft: never) => void) | undefined {
  return typeof value === 'function'
    ? (value as ProduceUpdater<never>)[PRODUCE_RECIPE]
    : undefined;
}

/**
 * Replaces store state with new data (full replacement).
 *
 * Creates a deep clone of the new data and replaces the existing state.
 * This is useful when you want to completely replace a section of the store
 * rather than merge changes.
 *
 * Note: This performs a full replacement, not smart reconciliation.
 * Future versions may add a separate `reconcile` function with diffing.
 *
 * @template T - Type of the data
 * @param newData - New data to replace with
 * @returns An updater function for `set()`
 *
 * @example
 * ```typescript
 * const state = store({ items: [] });
 *
 * // After fetching new data
 * const newItems = await fetchItems();
 * state.set('items', replaceWith(newItems));
 * ```
 */
export function replaceWith<T>(newData: T): (prev: T) => T {
  return () => {
    // Full replacement - no smart diffing yet
    return deepClone(newData);
  };
}
