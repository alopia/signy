/**
 * Core JSX Runtime
 *
 * Provides the core runtime functions required by babel-plugin-jsx-dom-expressions.
 * These functions handle reactive insertions, attribute bindings, and spreads.
 *
 * @module jsx/runtime
 *
 * `insert()`, `spread()` and the attribute helpers are the ones `h()` and
 * `html` use, re-exported here under the names the compiler imports. The
 * compiler's effect wrapper is `createRenderEffect`: set
 * `effectWrapper: 'createRenderEffect'` in the plugin options.
 *
 * ## Known limitations
 *
 * None.
 */

import { Computed } from '../reactivity';
import { getOwner, onCleanup } from '../reactivity/effect';
import type { Accessor } from './types';
import { isUnsafeAttribute } from '../dom/unsafe-attribute';
import { isLiveSource, liveProps } from '../views/live-props';
import { logger } from '../log';
import { ViewLogMessages } from '../views/log-messages';
import { setBounded } from '../utils/bounded-cache';

//=============================================
// Shared view code
//=============================================

export { createRenderEffect } from '../reactivity/render';
export { insert } from '../views/insert';
export {
  setAttribute,
  setProperty,
  setBoolAttribute,
  className,
  classList,
  style,
  setStyleProperty,
  spread,
} from '../views/attributes';

//=============================================
// Memo (rxcore interface)
//=============================================

/**
 * Memo wrapper for cached computations.
 * Called by compiled JSX for memoized expressions.
 */
export function memo<T>(fn: () => T, equals?: boolean): Accessor<T> {
  // If equals is false, never memoize (always return fn)
  if (equals === false) return fn;
  const computed = new Computed(fn);
  // Owned, so the computed leaves its sources when the owner is disposed
  if (getOwner()) onCleanup(() => computed.dispose());
  return () => computed.get();
}

/**
 * Use directive handler for custom element directives.
 *
 * Called by compiled JSX for `use:` and `ref` directives.
 * Supports function refs, ref objects, and custom directives with accessors.
 *
 * @example
 * ```tsx
 * // Function ref
 * let inputRef: HTMLInputElement;
 * <input ref={el => inputRef = el} />
 *
 * // Ref object (created with createRef)
 * const inputRef = createRef<HTMLInputElement>();
 * <input ref={inputRef} />
 *
 * // Custom directive
 * function tooltip(el: HTMLElement, accessor: () => string) {
 *   el.title = accessor();
 * }
 * <div use:tooltip="Hello!" />
 * ```
 *
 * @param ref - A function ref, ref object, or custom directive function
 * @param element - The DOM element
 * @param accessor - Optional accessor for directive value
 */
export function use<T extends Element>(
  ref:
    | ((el: T) => void)
    | ((el: T, accessor: () => unknown) => void)
    | { current: T | null },
  element: T,
  accessor?: () => unknown
): void {
  if (accessor !== undefined) {
    // Custom directive: use:directive={value}
    (ref as (el: T, accessor: () => unknown) => void)(element, accessor);
  } else if (typeof ref === 'function') {
    // Function ref: ref={fn}
    (ref as (el: T) => void)(element);
  } else if (ref && typeof ref === 'object' && 'current' in ref) {
    // Ref object: ref={createRef()}
    (ref as { current: T | null }).current = element;
  }
}

//=============================================
// Spread
//=============================================

/**
 * Merges multiple props objects into a single props object.
 *
 * Used by babel-plugin-jsx-dom-expressions when spreading props on elements.
 * Later props take precedence over earlier ones. Handles reactive getters
 * by wrapping them in new getters to preserve reactivity.
 *
 * @param sources - Props objects to merge
 * @returns Merged props object
 *
 * @example
 * ```tsx
 * // JSX: <div {...baseProps} {...(isOpen ? { open: true } : {})} class="extra" />
 *
 * // Compiled to:
 * _$template().firstChild;
 * _$spread(el, mergeProps(baseProps, isOpen ? { open: true } : {}, { class: "extra" }));
 * ```
 */
export function mergeProps<T extends Record<string, unknown>>(
  ...sources: (Partial<T> | (() => Partial<T>) | undefined | null)[]
): T {
  // The compiler passes a dynamic spread as a function, whose keys can change.
  // Props that came from one stay live through this copy.
  if (sources.some(isLiveSource)) {
    return liveProps(sources) as T;
  }

  const result: Record<string, unknown> = {};

  for (const source of sources) {
    if (!source) continue;

    // Get all keys including getters from the prototype chain
    const descriptors = Object.getOwnPropertyDescriptors(source);

    for (const key of Object.keys(descriptors)) {
      const descriptor = descriptors[key]!;

      if ('get' in descriptor && descriptor.get) {
        // Preserve reactive getters
        Object.defineProperty(result, key, {
          get: descriptor.get,
          enumerable: true,
          configurable: true,
        });
      } else if (key !== '__proto__') {
        // Regular value. An own __proto__ key would swap the prototype
        result[key] = source[key as keyof typeof source];
      }
    }
  }

  return result as T;
}

//=============================================
// Refs
//=============================================

/**
 * Assigns a ref to an element.
 *
 * @param ref - Ref callback or object
 * @param element - Element to assign
 */
export function assignRef<T>(
  ref: ((el: T) => void) | { current: T | null } | undefined,
  element: T
): void {
  if (typeof ref === 'function') {
    ref(element);
  } else if (ref && typeof ref === 'object') {
    ref.current = element;
  }
}

//=============================================
// SVG Support
//=============================================

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/**
 * Cache for SVG templates to enable fast cloning.
 * Key is the HTML string, value is the parsed SVG node.
 */
const svgTemplateCache = new Map<string, Node>();

/**
 * Creates an SVG element using template cloning for performance.
 *
 * The template is parsed once and cloned on subsequent calls with the same
 * HTML string, which is significantly faster than parsing each time.
 *
 * @param html - SVG HTML string
 * @param _childCount - Number of children (unused, for API compatibility)
 * @returns SVGElement cloned from cached template
 */
export function createSvgElement(
  html: string,
  _childCount?: number
): SVGElement {
  let cached = svgTemplateCache.get(html);

  if (!cached) {
    const template = document.createElement('template');
    template.innerHTML = `<svg xmlns="${SVG_NAMESPACE}">${html}</svg>`;
    const svg = template.content.firstChild as SVGSVGElement;
    cached = svg.firstChild!;
    setBounded(svgTemplateCache, html, cached);
  }

  return cached.cloneNode(true) as SVGElement;
}

/**
 * Clears the SVG template cache.
 * Useful for testing or memory management.
 */
export function clearSvgTemplateCache(): void {
  svgTemplateCache.clear();
}

/**
 * Gets the current size of the SVG template cache.
 * Useful for debugging and monitoring.
 */
export function getSvgTemplateCacheSize(): number {
  return svgTemplateCache.size;
}

/**
 * Sets an attribute in a namespace, for SVG.
 *
 * @param element - SVG element
 * @param namespace - Attribute namespace, null for none
 * @param name - Attribute name
 * @param value - Attribute value
 */
export function setAttributeNS(
  element: Element,
  namespace: string | null,
  name: string,
  value: unknown
): void {
  // The NS lookups take the local name, without the prefix
  const local = name.slice(name.indexOf(':') + 1);
  if (value == null || value === false) {
    if (element.hasAttributeNS(namespace, local)) {
      element.removeAttributeNS(namespace, local);
    }
  } else {
    const str = String(value === true ? '' : value);
    if (isUnsafeAttribute(name, str)) {
      if (__DEV__) logger.warn(ViewLogMessages.UNSAFE_ATTRIBUTE, { name });
      if (element.hasAttributeNS(namespace, local)) {
        element.removeAttributeNS(namespace, local);
      }
      return;
    }
    // Skip DOM write if value unchanged
    if (element.getAttributeNS(namespace, local) !== str) {
      element.setAttributeNS(namespace, name, str);
    }
  }
}

//=============================================
// Context
//=============================================

/**
 * Current rendering context.
 * Used by dom-expressions for context propagation.
 */
export let currentContext: Record<symbol, unknown> | null = null;

/**
 * Sets the current context.
 */
export function setContext(ctx: Record<symbol, unknown> | null): void {
  currentContext = ctx;
}
