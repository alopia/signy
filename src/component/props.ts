/**
 * Props Utilities
 *
 * Provides utilities for working with component props including merging,
 * splitting, and handling reactive prop values.
 *
 * Inspired by Solid.js props utilities.
 *
 * @module component/props
 *
 * @example
 * ```typescript
 * import { mergeProps, splitProps } from 'signy';
 *
 * // Merge default props with user props
 * const merged = mergeProps(defaultProps, userProps);
 *
 * // Split known props from rest
 * const [local, others] = splitProps(props, ['onClick', 'disabled']);
 * ```
 *
 * ## Known limitations
 *
 * None.
 */

import { isLiveProps, liveProps } from '../views/live-props';

//=============================================
// Types
//=============================================

/**
 * Props object type (any object with string keys)
 */
export type Props = Record<string, unknown>;

/**
 * Tuple returned by splitProps
 * @template T - Full props type
 * @template K - Keys to extract
 */
export type SplitProps<T, K extends keyof T> = [Pick<T, K>, Omit<T, K>];

//=============================================
// mergeProps
//=============================================

/**
 * Merges multiple prop objects into a single object.
 *
 * Unlike Object.assign or spread, this function preserves getters and
 * handles reactive accessors correctly. Later sources override earlier ones.
 *
 * @template T - The merged props type
 * @param sources - Prop objects to merge (later wins)
 * @returns A new object with all props merged
 *
 * @example
 * ```typescript
 * // Basic usage
 * const defaults = { size: 'medium', disabled: false };
 * const userProps = { size: 'large' };
 *
 * const merged = mergeProps(defaults, userProps);
 * // { size: 'large', disabled: false }
 * ```
 *
 * @example
 * ```typescript
 * // With reactive props (getters preserved)
 * const dynamicProps = {
 *   get class() { return theme() === 'dark' ? 'dark-mode' : 'light-mode'; }
 * };
 *
 * const merged = mergeProps({ class: 'default' }, dynamicProps);
 * // merged.class will be reactive!
 * ```
 *
 * @example
 * ```typescript
 * // In a component
 * class Button extends Component {
 *   static defaultProps = {
 *     type: 'button',
 *     disabled: false,
 *   };
 *
 *   constructor(props: ButtonProps) {
 *     super(mergeProps(Button.defaultProps, props));
 *   }
 * }
 * ```
 */
export function mergeProps<T extends Props>(...sources: Partial<T>[]): T {
  // Props from a dynamic spread can gain keys, so the merge reads them live
  if (sources.some(isLiveProps)) return liveProps(sources) as T;

  // Create result object
  const result = {} as T;

  for (const source of sources) {
    if (source == null) continue;

    // Get all property descriptors from source
    const descriptors = Object.getOwnPropertyDescriptors(source);

    for (const key of Object.keys(descriptors)) {
      const descriptor = descriptors[key];
      if (!descriptor) continue;

      // If it's a getter, preserve it
      if (descriptor.get) {
        Object.defineProperty(result, key, {
          enumerable: true,
          configurable: true,
          get: descriptor.get,
          set: descriptor.set,
        });
      } else {
        // For regular values, just copy
        Object.defineProperty(result, key, {
          enumerable: true,
          configurable: true,
          writable: true,
          value: descriptor.value,
        });
      }
    }
  }

  return result;
}

//=============================================
// splitProps
//=============================================

/**
 * Splits props into two objects: one with specified keys, one with the rest.
 *
 * Useful for extracting component-specific props while passing the rest
 * to a child element or component. Preserves getters for reactive props.
 *
 * @template T - The props type
 * @template K - Keys to extract into the first object
 * @param props - The props object to split
 * @param keys - Array of keys to extract
 * @returns A tuple of [picked, rest]
 *
 * @example
 * ```typescript
 * // Basic usage
 * const props = { onClick: fn, disabled: true, class: 'btn', id: 'my-btn' };
 *
 * const [local, others] = splitProps(props, ['onClick', 'disabled']);
 * // local: { onClick: fn, disabled: true }
 * // others: { class: 'btn', id: 'my-btn' }
 * ```
 *
 * @example
 * ```typescript
 * // In a component - handle local props, spread rest to element
 * class Button extends Component<ButtonProps> {
 *   protected render() {
 *     const [local, rest] = splitProps(this.props, ['variant', 'size', 'onClick']);
 *
 *     // Use local props for component logic
 *     const className = `btn btn-${local.variant} btn-${local.size}`;
 *
 *     // Spread rest to the native button
 *     return html`<button class=${className} ...${rest}>${this.props.children}</button>`;
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Multiple splits
 * const [handlers, styles, rest] = splitPropsMultiple(
 *   props,
 *   ['onClick', 'onHover'],
 *   ['class', 'style']
 * );
 * ```
 */
export function splitProps<T extends Props, K extends keyof T>(
  props: T,
  keys: readonly K[]
): SplitProps<T, K> {
  const keySet = new Set(keys as readonly (keyof T)[]);
  if (isLiveProps(props)) {
    return [
      liveProps([props], (key) => keySet.has(key as keyof T)),
      liveProps([props], (key) => !keySet.has(key as keyof T)),
    ] as SplitProps<T, K>;
  }

  const picked = {} as Pick<T, K>;
  const rest = {} as Omit<T, K>;

  const descriptors = Object.getOwnPropertyDescriptors(props);

  for (const key of Object.keys(descriptors) as (keyof T)[]) {
    const descriptor = descriptors[key as string];
    if (!descriptor) continue;

    const target = keySet.has(key) ? picked : rest;

    if (descriptor.get) {
      // Preserve getter
      Object.defineProperty(target, key, {
        enumerable: true,
        configurable: true,
        get: descriptor.get,
        set: descriptor.set,
      });
    } else {
      // Copy value
      Object.defineProperty(target, key, {
        enumerable: true,
        configurable: true,
        writable: true,
        value: descriptor.value,
      });
    }
  }

  return [picked, rest] as SplitProps<T, K>;
}

/**
 * Splits props into multiple groups.
 *
 * Allows splitting into more than two groups at once.
 *
 * **Note:** If the same key appears in multiple groups, it will be assigned
 * to the last group containing it. Earlier groups will not receive that key.
 *
 * @template T - The props type
 * @param props - The props object to split
 * @param keyGroups - Arrays of keys for each group
 * @returns Array of prop objects (one for each key group + rest)
 *
 * @example
 * ```typescript
 * const [handlers, styles, rest] = splitPropsMultiple(
 *   props,
 *   ['onClick', 'onHover'],
 *   ['class', 'style']
 * );
 * ```
 */
export function splitPropsMultiple<T extends Props>(
  props: T,
  ...keyGroups: (keyof T)[][]
): Props[] {
  const result: Props[] = keyGroups.map(() => ({}));
  const rest: Props = {};

  // Create a map from key to group index
  const keyToGroup = new Map<keyof T, number>();
  keyGroups.forEach((group, index) => {
    group.forEach((key) => {
      keyToGroup.set(key, index);
    });
  });

  if (isLiveProps(props)) {
    return [
      ...keyGroups.map((_, index) =>
        liveProps([props], (key) => keyToGroup.get(key as keyof T) === index)
      ),
      liveProps([props], (key) => !keyToGroup.has(key as keyof T)),
    ];
  }

  const descriptors = Object.getOwnPropertyDescriptors(props);

  for (const key of Object.keys(descriptors) as (keyof T)[]) {
    const descriptor = descriptors[key as string];
    if (!descriptor) continue;

    const groupIndex = keyToGroup.get(key);
    const target = groupIndex !== undefined ? result[groupIndex] : rest;

    if (descriptor.get) {
      Object.defineProperty(target, key, {
        enumerable: true,
        configurable: true,
        get: descriptor.get,
        set: descriptor.set,
      });
    } else {
      Object.defineProperty(target, key, {
        enumerable: true,
        configurable: true,
        writable: true,
        value: descriptor.value,
      });
    }
  }

  return [...result, rest];
}

/**
 * Creates default props that can be overridden.
 *
 * Shorthand for mergeProps with defaults as first argument.
 *
 * **Note:** Explicit `undefined` values in `props` will override defaults.
 * If you want to preserve defaults for missing keys, filter out `undefined`
 * values before passing to this function, or use nullish coalescing in
 * your component.
 *
 * @template T - The props type
 * @param defaults - Default prop values
 * @param props - User-provided props (undefined values override defaults)
 * @returns Merged props with defaults
 *
 * @example
 * ```typescript
 * const props = withDefaults(
 *   { size: 'medium', disabled: false },
 *   userProps
 * );
 *
 * // Note: { size: undefined } will result in size being undefined, not 'medium'
 * ```
 */
export function withDefaults<T extends Props>(
  defaults: Partial<T>,
  props: Partial<T>
): T {
  return mergeProps(defaults, props) as T;
}
