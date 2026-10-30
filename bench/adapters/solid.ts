/**
 * Solid behind the subset of Signy's API the reactivity, store and list
 * suites use, for bench:solid. What has no clean Solid equivalent is left
 * out, so those cases are reported as skipped. bench/solid.ts bundles it with
 * the browser condition: Solid's Node build is the server one, without
 * reactivity.
 */
import {
  batch,
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSelector as solidSelector,
  createSignal,
  indexArray,
  mapArray,
  untrack,
  type Accessor,
} from 'solid-js';
import {
  createStore,
  produce as solidProduce,
  type SetStoreFunction,
} from 'solid-js/store';

class SolidSignal<T> {
  private readonly _get: Accessor<T>;
  private readonly _set: (value: () => T) => void;

  constructor(value: T) {
    const [get, set] = createSignal(value);
    this._get = get;
    this._set = set as (value: () => T) => void;
  }

  get value(): T {
    return this._get();
  }

  set value(next: T) {
    this._set(() => next);
  }

  peek(): T {
    return untrack(this._get);
  }
}

class SolidComputed<T> {
  private readonly _memo: Accessor<T>;

  constructor(fn: () => T) {
    this._memo = createMemo(fn);
  }

  get value(): T {
    return this._memo();
  }
}

export const signal = <T>(value: T) => new SolidSignal(value);
export const computed = <T>(fn: () => T) => new SolidComputed(fn);
export const Computed = SolidComputed;
export const effect = (fn: () => unknown) => createEffect(fn);
export { batch, createRenderEffect, createRoot };

/** Solid runs effects synchronously, there is nothing left to flush */
export const flushAll = (): void => {};

export function createSelector<T>(source: () => T) {
  const isSelected = solidSelector(source);
  return (key: T) => ({
    get value() {
      return isSelected(key);
    },
  });
}

export function store<T extends object>(value: T) {
  const [state, setState] = createStore(structuredClone(value));
  const set = setState as SetStoreFunction<T> & ((...args: unknown[]) => void);
  return {
    state,
    set: (...args: unknown[]) => set(...args),
    update: (fn: (prev: T) => void) => setState(fn as never),
  };
}

export const produce = solidProduce;

/** A recursive copy like Signy's, so replaceWith() costs the same work */
function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    out[key] = clone((value as Record<string, unknown>)[key]);
  }
  return out as T;
}

/** Signy's replaceWith(): the whole value, cloned */
export const replaceWith =
  <T>(data: T) =>
  () =>
    clone(data);

// In a memo, as Signy maps in its own computation and not in the consumer
export const mapByItem = <T, U>(
  list: () => readonly T[],
  fn: (item: T, index: () => number) => U
) => createMemo(mapArray(list, fn));

export const mapByIndex = <T, U>(
  list: () => readonly T[],
  fn: (item: () => T, index: number) => U
) => createMemo(indexArray(list, fn));
