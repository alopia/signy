/**
 * Component Creation
 *
 * Provides component instantiation for compiled JSX.
 * Handles both class-based and functional components.
 *
 * A component is created under the owner current when the compiled code runs,
 * the same owner chain h() uses, so it is disposed with that owner. The
 * insert() effect behind a conditional such as
 * `{show ? <Timer /> : <Placeholder />}` disposes what its previous run
 * created before it re-runs, so the component of the old branch unmounts and
 * its onCleanup() callbacks run. Nothing is tracked on the DOM nodes.
 *
 * @module jsx/components
 *
 * ## Known limitations
 *
 * None.
 */

import { Component } from '../component/component';
import { untrack } from '../reactivity/signal/subtle';
import { listenOnShadowHost } from '../views/hyperscript';
import type { JSXElement, JSXComponent } from './types';

//=============================================
// Component Creation
//=============================================

/**
 * Creates a component instance with the given props.
 *
 * Called by compiled JSX for component elements (capitalized tags).
 * Props with reactive values are wrapped in getters to preserve reactivity.
 *
 * @param Comp - Component class or function
 * @param props - Component props (may contain getters for reactive values)
 * @returns Rendered element
 *
 * @example
 * ```tsx
 * // JSX: <MyComponent count={count()} static="hello" />
 *
 * // Compiled to:
 * createComponent(MyComponent, {
 *   get count() { return count(); },  // Reactive prop
 *   static: "hello"                    // Static prop
 * });
 * ```
 */
export function createComponent<P extends Record<string, unknown>>(
  Comp: JSXComponent<P>,
  props: P
): JSXElement {
  // Check if it's a class component
  const isClassComponent =
    Comp.prototype instanceof Component ||
    Comp === (Component as unknown as JSXComponent<P>) ||
    (Comp.prototype && typeof Comp.prototype.render === 'function');

  // Created inside a binding, a component must not subscribe it: a signal read
  // while it is built would rebuild it
  if (isClassComponent) {
    return untrack(() =>
      createClassComponent(Comp as new (props: P) => Component, props)
    );
  }

  return untrack(() => (Comp as (props: P) => JSXElement)(props));
}

/**
 * Renders a class component the way h() does, through _renderAsChild(), so
 * both syntaxes run the same setup, options and shadow host.
 */
function createClassComponent<P extends Record<string, unknown>>(
  Comp: new (props: P) => Component,
  props: P
): JSXElement {
  const instance = new Comp(props);
  const rendered = instance._renderAsChild();

  listenOnShadowHost(rendered, props as Record<string, unknown>);

  return rendered instanceof Node
    ? (rendered as JSXElement)
    : document.createDocumentFragment();
}
