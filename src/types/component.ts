/**
 * Component-related types
 */

import type { Application } from '../app/application';
import type { Component } from '../component/component';

/**
 * Any component class, whatever its props. A class with typed props fits
 * because nothing calls it through this type without a cast.
 */
export type ComponentClass = new (props: never, options: never) => Component;

/**
 * Virtual node from hyperscript (h function) - can be Element, DocumentFragment, Text, or Comment
 * Comment nodes are used by control flow primitives like Match for placeholder nodes
 */
export type VNode = Element | DocumentFragment | Text | Comment;

/**
 * Render result - what a component's render() method can return
 * Arrays are supported for htm templates with multiple root elements
 */
export type RenderResult = VNode | VNode[] | null | void;

/**
 * Injection key for type-safe provide/inject
 */
export type InjectionKey<T> = symbol & { __type?: T };

//=============================================
// Shadow DOM Types
//=============================================

/**
 * Shadow DOM mode
 * - `'open'`: shadowRoot is accessible from outside (recommended)
 * - `'closed'`: shadowRoot is hidden from outside
 */
export type ShadowMode = 'open' | 'closed';

/**
 * SSR rendering strategy for Shadow DOM components
 * - `'light'`: Render to light DOM on server, upgrade to shadow on client
 * - `'declarative'`: Use Declarative Shadow DOM (`<template shadowrootmode>`)
 */
export type ShadowSSRMode = 'light' | 'declarative';

/**
 * Shadow DOM configuration options
 *
 * @example
 * ```typescript
 * class Widget extends Component {
 *   protected shadow: ShadowOptions = {
 *     mode: 'open',
 *     delegatesFocus: true,
 *   };
 * }
 * ```
 */
export interface ShadowOptions {
  /**
   * Shadow DOM mode.
   * - `'open'`: shadowRoot accessible via element.shadowRoot (recommended)
   * - `'closed'`: shadowRoot hidden from external access
   *
   * @default 'open'
   */
  mode?: ShadowMode;

  /**
   * Whether focus should be delegated to the first focusable element
   * in the shadow tree when the host element receives focus.
   *
   * @default false
   */
  delegatesFocus?: boolean;

  /**
   * SSR rendering strategy.
   * - `'light'`: Render to light DOM on server, hydrate to shadow on client
   * - `'declarative'`: Use Declarative Shadow DOM for SSR
   * - `undefined`: Shadow DOM only (no SSR support)
   *
   * @default undefined
   */
  ssr?: ShadowSSRMode;

  /**
   * Slot assignment mode for slotable children.
   * - `'named'`: Children are assigned to slots based on their slot attribute
   * - `'manual'`: Slots are assigned programmatically via slot.assign()
   *
   * @default 'named'
   */
  slotAssignment?: 'named' | 'manual';
}

/**
 * Normalized shadow configuration (always an object)
 * Used internally after resolving `shadow: true` to default options
 */
export interface NormalizedShadowOptions {
  mode: ShadowMode;
  delegatesFocus: boolean;
  ssr?: ShadowSSRMode;
  slotAssignment: SlotAssignmentMode;
}

//=============================================
// Component Options
//=============================================

export interface ComponentOptions {
  /**
   * Parent application instance.
   * Automatically set when component is created via application().
   *
   * @internal
   */
  app?: Application;

  /**
   * Enable Shadow DOM for this component instance.
   * Set to `true` for default options or provide a configuration object.
   *
   * Constructor option takes precedence over class property.
   *
   * @example
   * ```typescript
   * // Via constructor (runtime decision)
   * const widget = new Widget({}, { shadow: true });
   *
   * // With shadow options
   * const widget = new Widget({}, {
   *   shadow: { mode: 'open', delegatesFocus: true }
   * });
   * ```
   */
  shadow?: boolean | ShadowOptions;

  /**
   * Styles to apply to Shadow DOM.
   * Only used when shadow DOM is enabled.
   *
   * Can be a string, array of strings, or CSSStyleSheet objects
   * (for Constructable Stylesheets - better performance).
   *
   * Constructor option is merged with class property styles.
   *
   * @example
   * ```typescript
   * const widget = new Widget({}, {
   *   shadow: true,
   *   styles: ':host { display: block; } .content { padding: 16px; }'
   * });
   * ```
   */
  styles?: string | string[] | CSSStyleSheet[];

  /**
   * Setup hook - called synchronously during mount.
   * Use this to inject dependencies and set up reactive state.
   *
   * inject() works reliably inside setup() (owner context is established).
   * Runs before render, during mount.
   *
   * @returns Optional object to merge into component instance
   *
   * @example
   * ```typescript
   * setup() {
   *   const api = this.inject(ApiKey);
   *   const theme = this.inject('theme', 'light');
   *
   *   return {
   *     async loadData() {
   *       const data = await api.get('/data');
   *       return data;
   *     }
   *   };
   * }
   * ```
   */
  setup?: (this: Component) => void | Record<string, unknown>;
}
