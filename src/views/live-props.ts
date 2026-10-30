/**
 * Props whose keys are read from their sources on each access, so a key a
 * dynamic JSX spread gains or drops shows up. Everything that copies props
 * keeps them live through these: mergeProps(), splitProps(), h() and Dynamic.
 *
 * @module views/live-props
 * @internal
 */

const hasOwn = Object.prototype.hasOwnProperty;

type Source = Record<PropertyKey, unknown>;

/** Every live props object, so spread() knows it is reactive without a key */
export const liveSpreads = new WeakSet<object>();

/** Whether a value is live props */
export function isLiveProps(value: unknown): boolean {
  return typeof value === 'object' && value !== null && liveSpreads.has(value);
}

/** Whether a source is live props, or a function a dynamic spread compiles to */
export function isLiveSource(source: unknown): boolean {
  return typeof source === 'function' || isLiveProps(source);
}

/**
 * Live props over `sources`, functions or objects, the last one with a key
 * winning. `keep` filters the keys, for splitProps(). A property defined on
 * the result wins over the sources, as h() does for children.
 */
export function liveProps(
  sources: readonly unknown[],
  keep: (key: PropertyKey) => boolean = () => true
): Record<string, unknown> {
  const own: Source = {};
  const read = (source: unknown): Source =>
    ((typeof source === 'function' ? source() : source) ?? {}) as Source;
  const find = (key: PropertyKey): Source | undefined => {
    if (key === '__proto__') return undefined;
    if (hasOwn.call(own, key)) return own;
    if (!keep(key)) return undefined;
    for (let i = sources.length - 1; i >= 0; i--) {
      const source = read(sources[i]);
      if (hasOwn.call(source, key)) return source;
    }
    return undefined;
  };
  const props: Record<string, unknown> = new Proxy(
    {},
    {
      get: (_, key) => find(key)?.[key],
      has: (_, key) => find(key) !== undefined,
      ownKeys: () => {
        const keys = new Set<string>(Object.keys(own));
        for (const source of sources) {
          for (const key of Object.keys(read(source))) {
            if (key !== '__proto__' && keep(key)) keys.add(key);
          }
        }
        return [...keys];
      },
      getOwnPropertyDescriptor: (_, key) =>
        find(key)
          ? {
              get: () => props[key as string],
              enumerable: true,
              configurable: true,
            }
          : undefined,
      defineProperty: (_, key, descriptor) => {
        Object.defineProperty(own, key, { ...descriptor, configurable: true });
        return true;
      },
      set: (_, key, value) => {
        own[key] = value;
        return true;
      },
    }
  );
  liveSpreads.add(props);
  return props;
}
