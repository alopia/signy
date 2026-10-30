/**
 * Attributes
 *
 * Sets attributes, properties, classes and styles on elements, statically or
 * bound to accessors. Shared by `h()`, `html` and the JSX runtime.
 *
 * @module views/attributes
 *
 * ## Known limitations
 *
 * **Spread ordering**: When using spread props, there's no guarantee of
 * attribute ordering. This matches Solid's behavior.
 */

import { getOwner, runWithOwner, type Owner } from '../reactivity/effect';
import { createRenderEffect, type Accessor } from '../reactivity/render';
import { untrack } from '../reactivity/signal/subtle';
import { applyDirective, bindControl, isLateProp } from './directives';
import { logger } from '../log';
import { ViewLogMessages } from './log-messages';
import { isUnsafeAttribute } from '../dom/unsafe-attribute';
import { insert } from './insert';
import { liveSpreads } from './live-props';

//=============================================
// Types
//=============================================

/**
 * Inline style as an object or a CSS string. Object keys may be kebab case
 * (`font-weight`) or camel case (`fontWeight`).
 */
export type StyleValue =
  | Record<string, string | number | null | undefined>
  | string
  | null
  | undefined;

//=============================================
// Attributes and properties
//=============================================

/**
 * Sets an attribute. `null`, `undefined` and `false` remove it, `true` sets
 * it empty. An `on*` attribute from a string and a `javascript:` URL are
 * never set.
 *
 * @param element - Target element
 * @param name - Attribute name
 * @param value - Attribute value
 */
export function setAttribute(
  element: Element,
  name: string,
  value: unknown
): void {
  // The compiler writes class on an SVG element through here
  if (name === 'class') className(element, value);
  else writeAttribute(element, name, value, false);
}

/**
 * setAttribute() that skips the read before the write when `fresh` says the
 * element is new.
 *
 * @internal
 */
export function writeAttribute(
  element: Element,
  name: string,
  value: unknown,
  fresh: boolean
): void {
  if (value == null || value === false) {
    if (!fresh && element.hasAttribute(name)) element.removeAttribute(name);
    return;
  }
  const str = value === true ? '' : String(value);
  if (isUnsafeAttribute(name, str)) {
    if (__DEV__) logger.warn(ViewLogMessages.UNSAFE_ATTRIBUTE, { name });
    if (!fresh && element.hasAttribute(name)) element.removeAttribute(name);
    return;
  }
  // Skip DOM write if value unchanged
  if (fresh || element.getAttribute(name) !== str) {
    element.setAttribute(name, str);
  }
}

/**
 * Sets a property on an element.
 *
 * @param element - Target element
 * @param name - Property name
 * @param value - Property value
 */
export function setProperty(
  element: Element,
  name: string,
  value: unknown
): void {
  if (typeof value === 'string' && isUnsafeAttribute(name, value)) {
    if (__DEV__) logger.warn(ViewLogMessages.UNSAFE_ATTRIBUTE, { name });
    return;
  }
  const el = element as unknown as Record<string, unknown>;
  // A text property such as value would show "undefined"
  if (value == null && typeof el[name] === 'string') value = '';
  if (el[name] !== value) el[name] = value;
}

/**
 * Sets an attribute present and empty for a truthy value, removes it for a
 * falsy one. Used by compiled JSX for `bool:name={value}`.
 *
 * @param element - Target element
 * @param name - Attribute name
 * @param value - Whether the attribute is present
 */
export function setBoolAttribute(
  element: Element,
  name: string,
  value: unknown
): void {
  if (value) element.setAttribute(name, '');
  else element.removeAttribute(name);
}

/**
 * Sets the class attribute from a string, an array or an object of class
 * names to booleans.
 *
 * @param element - Target element
 * @param value - Class value
 */
export function className(element: Element, value: unknown): void {
  let str: string | null;
  if (value == null || value === false) {
    str = null;
  } else if (Array.isArray(value)) {
    str = value.filter(Boolean).join(' ');
  } else if (typeof value === 'object') {
    str = Object.keys(value)
      .filter((cls) => (value as Record<string, unknown>)[cls])
      .join(' ');
  } else {
    str = String(value);
  }
  const el = element as Element & { [OWN_CLASS]?: string };
  const own = el[OWN_CLASS] ?? '';
  // Only on a change: a new row with no class keeps its shape
  if (own !== (str ?? '')) el[OWN_CLASS] = str ?? '';
  // className is a string on HTML elements only, SVG needs the attribute
  const html = typeof (element as HTMLElement).className === 'string';
  const current = html
    ? (element as HTMLElement).className
    : (element.getAttribute('class') ?? '');
  if (current === own) {
    // Only our classes on it, as on a list row: one plain write. An empty
    // value on an element without a class writes nothing.
    if (str !== null && html) {
      if (current !== str) (element as HTMLElement).className = str;
    } else {
      writeAttribute(element, 'class', str, false);
    }
    return;
  }
  // classList or class: added others, so only ours change
  const next = str ? str.split(/\s+/).filter(Boolean) : [];
  for (const name of own.split(/\s+/)) {
    if (name && !next.includes(name)) element.classList.remove(name);
  }
  if (next.length > 0) element.classList.add(...next);
}

/** The classes className() wrote last on an element */
const OWN_CLASS = Symbol('signy.class');

/** The style: properties of an element, put back after a style string */
const STYLE_PROPS = Symbol('signy.styleProps');

type StyledElement = Element & {
  [STYLE_PROPS]?: Map<string, string>;
};

/** Writes the style: properties again, after cssText replaced them all */
function restoreStyleProps(element: Element): void {
  const props = (element as StyledElement)[STYLE_PROPS];
  if (!props) return;
  const nodeStyle = (element as HTMLElement).style;
  for (const [name, value] of props) nodeStyle.setProperty(name, value);
}

/**
 * Toggles classes from an object of class names to booleans. Classes in
 * `prev` and missing from `value` are removed.
 *
 * @param element - Target element
 * @param value - Object mapping class names to booleans
 * @param prev - The value returned by the previous call
 * @returns The value to pass as `prev` next time
 */
export function classList(
  element: Element,
  value: Record<string, boolean | undefined>,
  prev: Record<string, boolean | undefined> = {}
): Record<string, boolean | undefined> {
  for (const cls of Object.keys(prev)) {
    if (!(cls in value)) {
      element.classList.remove(cls);
      delete prev[cls];
    }
  }
  for (const cls of Object.keys(value)) {
    const active = !!value[cls];
    if (prev[cls] !== active) {
      element.classList.toggle(cls, active);
      prev[cls] = active;
    }
  }
  return prev;
}

/**
 * Sets inline styles from an object or a CSS string. Properties set by the
 * previous object and missing now are removed.
 *
 * @param element - Target element
 * @param value - Style object or CSS string
 * @param prev - The value returned by the previous call
 * @returns The value to pass as `prev` next time
 */
export function style(
  element: HTMLElement | SVGElement,
  value: StyleValue,
  prev?: StyleValue
): StyleValue {
  const nodeStyle = element.style;

  if (!value) {
    if (prev) {
      element.removeAttribute('style');
      restoreStyleProps(element);
    }
    return undefined;
  }

  if (typeof value === 'string') {
    if (nodeStyle.cssText !== value) {
      nodeStyle.cssText = value;
      restoreStyleProps(element);
    }
    return value;
  }

  let cleared = false;
  if (typeof prev === 'string') {
    nodeStyle.cssText = '';
    prev = undefined;
    cleared = true;
  }

  const next: Record<string, string | number> = {};
  if (prev) {
    for (const prop of Object.keys(prev)) {
      if (value[prop] == null) setStyle(nodeStyle, prop, null);
    }
  }
  for (const prop of Object.keys(value)) {
    const val = value[prop];
    if (val == null) continue;
    if (!prev || prev[prop] !== val) setStyle(nodeStyle, prop, val);
    next[prop] = val;
  }
  if (cleared) restoreStyleProps(element);
  return next;
}

/**
 * Sets a single style property on an element.
 *
 * Used by compiled JSX for `style:property={value}` syntax.
 *
 * @param element - Target element
 * @param name - CSS property name
 * @param value - CSS property value
 */
export function setStyleProperty(
  element: HTMLElement,
  name: string,
  value: string | number | null | undefined
): void {
  const el = element as HTMLElement & StyledElement;
  if (value != null) {
    const str = String(value);
    (el[STYLE_PROPS] ??= new Map()).set(name, str);
    if (element.style.getPropertyValue(name) !== str) {
      element.style.setProperty(name, str);
    }
  } else {
    el[STYLE_PROPS]?.delete(name);
    if (element.style.getPropertyValue(name)) {
      element.style.removeProperty(name);
    }
  }
}

function setStyle(
  nodeStyle: CSSStyleDeclaration,
  prop: string,
  value: string | number | null
): void {
  // setProperty() only takes kebab case, the property setters only camel case
  if (prop.includes('-')) {
    if (value == null) nodeStyle.removeProperty(prop);
    else nodeStyle.setProperty(prop, String(value));
  } else {
    (nodeStyle as unknown as Record<string, string>)[prop] =
      value == null ? '' : String(value);
  }
}

//=============================================
// Spread
//=============================================

/**
 * Spreads props onto an element: attributes, `class`, `classList`, `style`,
 * `on*` event handlers, and the `on:`, `oncapture:`, `prop:`, `attr:`,
 * `bool:`, `class:` and `style:` namespaces, plus `ref`, `use:` and `bind:`.
 * Function values other than handlers are bound as reactive attributes.
 *
 * When `props` is an accessor or has getters, the spread re-runs when they
 * change.
 *
 * @param element - Target element
 * @param props - Props object or accessor returning one
 * @param _isSVG - Passed by compiled JSX, unused
 * @param skipChildren - False to also insert `props.children`
 *
 * @example
 * ```typescript
 * const attrs = new Signal({ class: 'active', disabled: false });
 *
 * const button = document.createElement('button');
 * spread(button, () => attrs.value);
 *
 * attrs.value = { class: 'inactive', disabled: true }; // Button updates
 * ```
 */
export function spread(
  element: Element,
  props: Record<string, unknown> | Accessor<Record<string, unknown>>,
  _isSVG?: boolean,
  skipChildren?: boolean
): void {
  // Compiled JSX passes false when the element has no children of its own,
  // so `<div {...props} />` renders props.children
  if (skipChildren === false) {
    insert(element, () =>
      typeof props === 'function' ? props()['children'] : props['children']
    );
  }

  if (typeof props === 'function' || hasGetters(props)) {
    const state: SpreadState = {
      listeners: new Map(),
      styles: undefined,
      classes: undefined,
      owner: getOwner(),
      applied: new Set(),
      keys: new Set(),
      ref: undefined,
    };
    createRenderEffect(() => {
      const resolved =
        typeof props === 'function'
          ? (props as Accessor<Record<string, unknown>>)()
          : props;
      applySpread(element, resolved, state);
    });
  } else {
    applySpread(element, props);
  }
}

/** What a reactive spread remembers from its previous run */
interface SpreadState {
  /** By prop key, as `onClick` and `on:click` are two listeners */
  listeners: Map<string, EventListener>;
  styles: StyleValue;
  classes: Record<string, boolean | undefined> | undefined;
  /** Where bindings and directives live: they must outlast a re-run */
  owner: Owner | null;
  /** The bind: and use: keys applied, each once */
  applied: Set<string>;
  /** The other keys of the last run, to clear the ones a dynamic spread drops */
  keys: Set<string>;
  /** The ref filled last, so a re-run fills only a new one */
  ref: unknown;
}

function hasGetters(props: Record<string, unknown>): boolean {
  if (liveSpreads.has(props)) return true;
  for (const key in props) {
    if (Object.getOwnPropertyDescriptor(props, key)?.get) return true;
  }
  return false;
}

function applySpread(
  element: Element,
  props: Record<string, unknown>,
  state?: SpreadState
): void {
  // Bindings and directives come last, as in h(): see isLateProp()
  let late: string[] | null = null;
  const entries: [string, unknown][] = [];
  for (const [key, value] of Object.entries(props)) {
    if (key === 'children' || key === 'ref') continue;
    if (isLateProp(key) && !key.startsWith('prop:')) (late ??= []).push(key);
    else entries.push([key, value]);
  }

  if (state) {
    // First, so clearing class does not undo a class: key that stays
    const keys = new Set(entries.map(([key]) => key));
    for (const key of state.keys) {
      if (!keys.has(key)) applySpreadKey(element, key, undefined, state);
    }
    state.keys = keys;
  }
  for (const [key, value] of entries) {
    applySpreadKey(element, key, value, state);
  }

  // The compiler fills a ref written on the element, not one in a spread
  const ref = props['ref'];
  if (ref && ref !== state?.ref) {
    if (state) state.ref = ref;
    untrack(() => fillRef(element, ref));
  }

  if (late) {
    for (const key of late) {
      // A re-run would add the listener and the effect again. Under the owner
      // of the spread, not its effect, so the first run's binding survives.
      if (state) {
        if (state.applied.has(key)) continue;
        state.applied.add(key);
        runWithOwner(state.owner, () => applyLate(element, key, props[key]));
      } else {
        applyLate(element, key, props[key]);
      }
    }
  }
}

function fillRef(element: Element, ref: unknown): void {
  if (typeof ref === 'function') ref(element);
  else if (typeof ref === 'object' && 'current' in (ref as object)) {
    (ref as { current: Element | null }).current = element;
  }
}

function applySpreadKey(
  element: Element,
  key: string,
  value: unknown,
  state: SpreadState | undefined
): void {
  if (key === 'class' || key === 'className') {
    className(element, value);
  } else if (key === 'classList') {
    const classes = classList(
      element,
      (value ?? {}) as Record<string, boolean | undefined>,
      state?.classes
    );
    if (state) state.classes = classes;
  } else if (key === 'style') {
    const styles = style(
      element as HTMLElement,
      value as StyleValue,
      state?.styles
    );
    if (state) state.styles = styles;
  } else if (key.startsWith('on')) {
    // A new handler replaces the previous one for the same key
    const [event, capture] = listenerOf(key);
    const previous = state?.listeners.get(key);
    if (previous) element.removeEventListener(event, previous, capture);
    if (typeof value === 'function') {
      element.addEventListener(event, value as EventListener, capture);
      state?.listeners.set(key, value as EventListener);
    } else {
      state?.listeners.delete(key);
    }
  } else if (key.startsWith('prop:')) {
    setProperty(element, key.slice(5), value);
  } else if (key.startsWith('attr:')) {
    setAttribute(element, key.slice(5), value);
  } else if (key.startsWith('bool:')) {
    setBoolAttribute(element, key.slice(5), value);
  } else if (key.startsWith('class:')) {
    element.classList.toggle(key.slice(6), !!value);
  } else if (key.startsWith('style:')) {
    setStyleProperty(
      element as HTMLElement,
      key.slice(6),
      value as string | number | null | undefined
    );
  } else if (typeof value === 'function') {
    createRenderEffect(() => {
      writeSpreadValue(element, key, (value as Accessor<unknown>)());
    });
  } else {
    writeSpreadValue(element, key, value);
  }
}

/**
 * Keys compiled JSX writes as properties: an attribute only sets the default
 * of form state, and content has no attribute at all
 */
const SPREAD_PROPERTIES = new Set([
  'value',
  'checked',
  'selected',
  'muted',
  'indeterminate',
  'innerHTML',
  'textContent',
  'innerText',
]);

/** A plain spread value: a property, as compiled JSX would set it, or an attribute */
function writeSpreadValue(element: Element, key: string, value: unknown): void {
  if (key === 'htmlFor') {
    setAttribute(element, 'for', value);
  } else if (SPREAD_PROPERTIES.has(key)) {
    setProperty(element, key, key === 'value' && value == null ? '' : value);
  } else if (element.localName.includes('-') && !key.includes('-')) {
    // A custom element takes props as properties, data- and aria- stay attributes
    setProperty(element, key, value);
  } else {
    setAttribute(element, key, value);
  }
}

/** The event and capture flag of `onClick`, `on:click` or `oncapture:click` */
function listenerOf(key: string): [string, boolean] {
  if (key.startsWith('on:')) return [key.slice(3), false];
  if (key.startsWith('oncapture:')) return [key.slice(10), true];
  return [key.slice(2).toLowerCase(), false];
}

function applyLate(element: Element, key: string, value: unknown): void {
  if (key.startsWith('use:')) applyDirective(element, value);
  else bindControl(element, key.slice(5), value);
}

//=============================================
// Bindings
//=============================================

/**
 * Creates a reactive attribute binding.
 *
 * @param element - Target element
 * @param name - Attribute name
 * @param accessor - Value accessor
 * @returns Cleanup function
 *
 * @example
 * ```typescript
 * const disabled = new Signal(false);
 *
 * const button = document.createElement('button');
 * bindAttribute(button, 'disabled', () => disabled.value);
 *
 * disabled.value = true; // Button becomes disabled
 * ```
 */
export function bindAttribute(
  element: Element,
  name: string,
  accessor: Accessor<unknown>
): () => void {
  return createRenderEffect(() => {
    if (name === 'class' || name === 'className') {
      className(element, accessor());
    } else {
      setAttribute(element, name, accessor());
    }
  });
}

/**
 * Creates a reactive style binding. Properties missing from a new value are
 * removed.
 *
 * @param element - Target element
 * @param accessor - Style object accessor
 * @returns Cleanup function
 *
 * @example
 * ```typescript
 * const color = new Signal('red');
 *
 * bindStyle(element, () => ({ color: color.value, fontWeight: 'bold' }));
 *
 * color.value = 'blue'; // Element color updates
 * ```
 */
export function bindStyle(
  element: HTMLElement,
  accessor: Accessor<StyleValue>
): () => void {
  let prev: StyleValue;
  return createRenderEffect(() => {
    prev = style(element, accessor(), prev);
  });
}

/**
 * Creates a reactive class list binding. Classes missing from a new value
 * are removed.
 *
 * @param element - Target element
 * @param accessor - Class object accessor (class name -> boolean)
 * @returns Cleanup function
 *
 * @example
 * ```typescript
 * const isActive = new Signal(false);
 * const isDisabled = new Signal(false);
 *
 * bindClassList(button, () => ({
 *   active: isActive.value,
 *   disabled: isDisabled.value
 * }));
 * ```
 */
export function bindClassList(
  element: Element,
  accessor: Accessor<Record<string, boolean | undefined>>
): () => void {
  let prev: Record<string, boolean | undefined> = {};
  return createRenderEffect(() => {
    prev = classList(element, accessor(), prev);
  });
}
