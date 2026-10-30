/**
 * Hyperscript function for creating DOM elements
 * Compatible with htm and JSX transpilation
 *
 * Integrates with the owner chain for Solid-style component rendering.
 * When a component is encountered, it is instantiated (capturing the current owner),
 * rendered, and the resulting DOM is returned.
 *
 * Supports reactive values: when props or children are accessor functions,
 * they are evaluated and set up for reactive updates.
 *
 * @module views/hyperscript
 *
 * ## Known limitations
 *
 * None.
 */

import { Component, construct } from '../component/component';
import type { ComponentClass } from '../types';
import { renderEffect, type Accessor } from '../reactivity/render';
import { untrack } from '../reactivity/signal/subtle';
import { getOwner, runWithOwner } from '../reactivity/effect';
import { appendChildren } from './append';
import { applyDirective, bindControl, isLateProp } from './directives';
import { DELEGATED_EVENTS, setDelegatedHandler } from './events';
import { DATA_ATTR_SHADOW } from '../constants';
import { isLiveProps, liveProps } from './live-props';
import {
  className,
  setProperty,
  style,
  writeAttribute,
  type StyleValue,
} from './attributes';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/**
 * SVG element names. Tags that also exist in HTML (a, title, style, script)
 * stay HTML unless they get xmlns="http://www.w3.org/2000/svg".
 */
const SVG_TAGS = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'switch',
  'foreignObject',
  'path',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'rect',
  'text',
  'tspan',
  'textPath',
  'image',
  'marker',
  'pattern',
  'mask',
  'clipPath',
  'linearGradient',
  'radialGradient',
  'stop',
  'desc',
  'metadata',
  'view',
  'animate',
  'animateMotion',
  'animateTransform',
  'mpath',
  'set',
  'filter',
  'feBlend',
  'feColorMatrix',
  'feComponentTransfer',
  'feComposite',
  'feConvolveMatrix',
  'feDiffuseLighting',
  'feDisplacementMap',
  'feDistantLight',
  'feDropShadow',
  'feFlood',
  'feFuncA',
  'feFuncB',
  'feFuncG',
  'feFuncR',
  'feGaussianBlur',
  'feImage',
  'feMerge',
  'feMergeNode',
  'feMorphology',
  'feOffset',
  'fePointLight',
  'feSpecularLighting',
  'feSpotLight',
  'feTile',
  'feTurbulence',
]);

/**
 * Base child types (non-recursive)
 */
type ChildBase =
  Node | string | number | boolean | null | undefined | Component;

/**
 * Type for children that can be passed to h()
 */
type Child = ChildBase | Accessor<ChildBase> | ChildBase[];

/**
 * Type for element properties/attributes
 */
type Props = Record<string, unknown> | null;

/**
 * Creates a DOM element or renders a component.
 *
 * When type is a Component class:
 * 1. Creates instance (captures current owner as parent)
 * 2. Registers as child of current owner
 * 3. Renders the component (setting it as owner for its children)
 * 4. Returns the rendered DOM
 *
 * @param type - Tag name (e.g., 'div', 'span') or component class
 * @param props - Element attributes/properties or component props
 * @param children - Child elements, text nodes, or arrays of children
 * @returns DOM element or DocumentFragment
 *
 * @example
 * ```typescript
 * // HTML elements
 * const div = h('div', { class: 'container' }, 'Hello World');
 *
 * // Components - automatically rendered
 * const navbar = h(Navbar, { title: 'My App' });
 *
 * // With htm
 * html`<div><${Navbar} title="My App" /></div>`
 * ```
 */
export function h(
  type: string | ComponentClass | Function,
  props: Props,
  ...children: Child[]
): Element | DocumentFragment {
  // Created inside a binding, a component must not subscribe it
  if (typeof type === 'function') {
    return untrack(() => renderComponent(type, props, children));
  }

  const element = createTagElement(type, props);
  // Bindings and directives wait for the children and the other props: a
  // select value needs its options, a range value its limits
  let late: string[] | null = null;
  if (props) {
    for (const key in props) {
      if (isLateProp(key)) (late ??= []).push(key);
      else applyProp(element, key, props[key], true);
    }
  }
  appendChildren(element, children);
  if (late) for (const key of late) applyProp(element, key, props![key], true);
  return element;
}

function renderComponent(
  type: ComponentClass | Function,
  props: Props,
  children: Child[] | (() => Child[])
): Element | DocumentFragment {
  // Check if it's a Component class (has prototype with render)
  const isComponent =
    type.prototype instanceof Component ||
    type === Component ||
    (type.prototype && typeof type.prototype.render === 'function');

  if (isComponent) {
    // Children are built when the component first reads them, under it, so
    // a component among them sees its context and belongs to it
    let instance: Component | undefined;
    let built = false;
    let content: unknown;
    const componentProps = copyProps(props);
    // No child arguments: a children prop, as lazy() passes on, stays
    const given = Array.isArray(children) && children.length === 0;
    if (!given || !('children' in componentProps)) {
      Object.defineProperty(componentProps, 'children', {
        enumerable: true,
        configurable: true,
        get: () => {
          if (!built) {
            built = true;
            content = runWithOwner(instance ?? getOwner(), () =>
              untrack(() =>
                childContent(
                  typeof children === 'function' ? children() : children
                )
              )
            );
          }
          return content;
        },
      });
    }
    instance = construct(type as ComponentClass, componentProps);

    // Render the component as a child
    // This handles shadow DOM setup, setup() call, and proper rendering
    const rendered = instance._renderAsChild();
    listenOnShadowHost(rendered, componentProps);

    // Return the rendered DOM (or empty fragment if null)
    if (rendered instanceof Node) {
      return rendered as Element | DocumentFragment;
    }

    return document.createDocumentFragment();
  }

  // Functional component - just call it
  const functionProps = copyProps(props);
  if (typeof children === 'function') {
    // Built on each read, under the reader, as a JSX getter: Show builds its
    // branch when it shows it, Suspense inside its boundary
    Object.defineProperty(functionProps, 'children', {
      get: children,
      enumerable: true,
      configurable: true,
    });
  } else if (children.length > 0 || !('children' in functionProps)) {
    Object.defineProperty(functionProps, 'children', {
      value: children,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return (type as Function)(functionProps) as Element | DocumentFragment;
}

/**
 * Listens on a shadow host for the custom events in `on*` props, such as
 * `onRate` for `emit('rate')`. A standard event such as `onClick` stays a
 * prop: the component handles it, and a host listener would run it twice.
 *
 * @internal
 */
export function listenOnShadowHost(
  rendered: unknown,
  props: Record<string, unknown>
): void {
  if (
    !(rendered instanceof Element) ||
    !rendered.hasAttribute(DATA_ATTR_SHADOW)
  )
    return;
  for (const key of Object.keys(props)) {
    if (!key.startsWith('on') || key.startsWith('on:')) continue;
    // `onvalue-change` listens to `value-change`
    const name = key.slice(2).toLowerCase();
    if (`on${name}` in HTMLElement.prototype) continue;
    const handler = props[key];
    if (typeof handler === 'function') {
      rendered.addEventListener(name, handler as EventListener);
    }
  }
}

/** A copy of props that keeps getters, so a JSX prop stays live */
function copyProps(props: Props): Record<string, unknown> {
  // A copy of live props stays live, a children getter goes on top
  if (isLiveProps(props)) return liveProps([props]);
  return props
    ? Object.defineProperties({}, Object.getOwnPropertyDescriptors(props))
    : {};
}

/**
 * Children as nodes the way element children are, so accessors stay
 * reactive: one node, an array of them, or undefined.
 */
function childContent(children: Child[]): unknown {
  const fragment = document.createDocumentFragment();
  appendChildren(fragment, children);
  const childNodes = Array.from(fragment.childNodes);
  return childNodes.length === 1
    ? childNodes[0]
    : childNodes.length > 0
      ? childNodes
      : undefined;
}

/**
 * h() with children built on demand, for `html`: a component gets them when
 * it reads them, an element right away. `null` when there are none.
 *
 * @internal
 */
export function hLazy(
  type: string | ComponentClass | Function,
  props: Props,
  children: (() => unknown[]) | null
): Element | DocumentFragment {
  // No children between the tags: a children prop stays
  const read = (children ?? []) as (() => Child[]) | Child[];
  if (typeof type === 'function') {
    return untrack(() => renderComponent(type, props, read));
  }
  return h(type, props, ...(typeof read === 'function' ? read() : read));
}

/**
 * Whether the children of an element go in the SVG namespace: its own
 * namespace is SVG and it is not a foreignObject, whose content is HTML.
 * Lets a parent that is built first give `title` or `a` the right one.
 *
 * @internal
 */
export function childrenInSvg(
  type: string,
  props: Props,
  inSvg: boolean
): boolean {
  if (type === 'foreignObject') return false;
  const xmlns = props?.['xmlns'];
  return typeof xmlns === 'string'
    ? xmlns === SVG_NAMESPACE
    : inSvg || SVG_TAGS.has(type);
}

/** Props with the SVG namespace, for an element inside an svg */
export function inSvgNamespace(props: Props): Record<string, unknown> {
  return props && typeof props['xmlns'] === 'string'
    ? props
    : { ...props, xmlns: SVG_NAMESPACE };
}

/**
 * Creates the element for a tag. htm calls h() for children before their
 * parent, so an SVG element is known by its tag name, or by an explicit xmlns.
 *
 * @internal
 */
export function createTagElement(
  type: string,
  props: Props
): HTMLElement | SVGElement {
  const namespace =
    typeof props?.['xmlns'] === 'string'
      ? props['xmlns']
      : SVG_TAGS.has(type)
        ? SVG_NAMESPACE
        : null;
  return namespace
    ? (document.createElementNS(namespace, type) as SVGElement)
    : document.createElement(type);
}

/**
 * Applies one prop of h() or html: a ref, a listener, a binding or a static
 * value. `fresh` means the element is new, so it has no attribute to compare.
 *
 * @internal
 */
export function applyProp(
  element: Element,
  key: string,
  value: unknown,
  fresh: boolean
): void {
  if (key === 'children' || key === 'xmlns') {
    // Children are handled separately, xmlns chose the namespace
  } else if (key === 'ref') {
    if (typeof value === 'function') {
      (value as (el: Element) => void)(element);
    } else if (value && typeof value === 'object' && 'current' in value) {
      (value as { current: Element | null }).current = element;
    }
  } else if (key.startsWith('use:')) {
    applyDirective(element, value);
  } else if (key.startsWith('bind:')) {
    bindControl(element, key.slice(5), value);
  } else if (typeof value === 'function') {
    if (key.startsWith('on:')) {
      // A listener on the element itself, for an event delegation would miss
      element.addEventListener(key.slice(3), value as EventListener);
    } else if (key.startsWith('on')) {
      // onClick, onInput: delegated when the event bubbles
      const name = key.slice(2).toLowerCase();
      if (DELEGATED_EVENTS.has(name)) {
        setDelegatedHandler(element, name, value as EventListener);
      } else {
        element.addEventListener(name, value as EventListener);
      }
    } else {
      bindProp(element, key, value as Accessor<unknown>);
    }
  } else {
    setProp(element, key, value, fresh);
  }
}

/**
 * Sets one static prop: class, style, a `prop:` property, or an attribute,
 * also with `attr:` to force one.
 */
function setProp(
  element: Element,
  key: string,
  value: unknown,
  fresh: boolean
): void {
  if (key === 'class' || key === 'className') {
    className(element, value);
  } else if (key === 'style') {
    style(element as HTMLElement, value as StyleValue);
  } else if (key.startsWith('prop:')) {
    setProperty(element, key.slice(5), value);
  } else if (key.startsWith('attr:')) {
    writeAttribute(element, key.slice(5), value, fresh);
  } else {
    writeAttribute(element, key, value, fresh);
  }
}

/**
 * Binds one prop to an accessor.
 */
function bindProp(
  element: Element,
  key: string,
  accessor: Accessor<unknown>
): void {
  if (key === 'style') {
    renderEffect<StyleValue>((prev) =>
      style(element as HTMLElement, accessor() as StyleValue, prev)
    );
  } else {
    renderEffect(() => setProp(element, key, accessor(), false));
  }
}

/**
 * Creates a document fragment to group multiple children.
 * Used for fragments in `h()` calls and in the JSX runtime, which passes the
 * children in `props.children` instead.
 *
 * @param props - Props, with `children` when called by the JSX runtime
 * @param children - Child elements
 * @returns DocumentFragment containing children
 *
 * @example
 * ```typescript
 * // JSX
 * <>
 *   <div>First</div>
 *   <div>Second</div>
 * </>
 * ```
 */
export function Fragment(
  props: Props | { children?: unknown },
  ...children: Child[]
): DocumentFragment {
  const fragment = document.createDocumentFragment();
  appendChildren(
    fragment,
    children.length > 0
      ? children
      : [(props as { children?: unknown } | null)?.children]
  );
  return fragment;
}
