/**
 * DOM Utilities Module
 *
 * Consolidated DOM manipulation, query, reference, and event utilities.
 *
 * @module dom
 *
 * @example Using the DOM namespace (recommended for discoverability)
 * ```typescript
 * import { DOM } from 'signy';
 *
 * // Query elements
 * const button = DOM.query<HTMLButtonElement>('#submit');
 * const items = DOM.queryAll('.item');
 *
 * // Create elements
 * const div = DOM.createElement('div', { class: 'container' });
 *
 * // Class manipulation
 * DOM.addClass(element, 'active');
 * DOM.removeClass(element, 'hidden');
 * DOM.toggleClass(element, 'expanded');
 *
 * // Attribute manipulation
 * DOM.setAttributes(element, { 'data-id': '123', role: 'button' });
 *
 * // Element references
 * const ref = DOM.createRef<HTMLDivElement>();
 * const refWithValue = DOM.createRefWithValue(document.body);
 *
 * // Event listeners with auto-cleanup
 * DOM.on(document, 'keydown', (e) => console.log(e.key));
 * DOM.onKeydown(document, 'Escape', () => closeModal());
 * DOM.onClickOutside(() => menuRef.current, () => closeMenu());
 * ```
 *
 * @example Direct imports
 * ```typescript
 * import { query, addClass, createRef, createEventListener } from 'signy';
 *
 * const el = query('#app');
 * addClass(el, 'loaded');
 * ```
 */

//=============================================
// Re-exports
//=============================================

export * from './query';
export * from './manipulation';
export * from './ref';
export * from './events';
export * from './html';
export * from './template';
export * from './head';

//=============================================
// Imports for namespace
//=============================================

import {
  query,
  queryAll,
  getElement,
  createElement,
  type ElementOrSelector,
} from './query';

import {
  addClass,
  removeClass,
  toggleClass,
  hasClass,
  setAttributes,
  getAttributes,
  removeAttributes,
  getAttribute,
  hasAttribute,
} from './manipulation';

import {
  createRef,
  createRefWithValue,
  isRef,
  type Ref,
  type RefWithValue,
} from './ref';

import {
  createEventListener,
  createKeydownListener,
  createClickOutside,
  type MaybeAccessor,
  type EventListenerOptions,
  type KeydownListenerOptions,
} from './events';

import {
  createTemplate,
  createMany,
  createFragment,
  clearTemplateCache,
} from './template';

//=============================================
// DOM Namespace
//=============================================

/**
 * DOM utilities namespace for IDE-friendly discoverability.
 *
 * Provides a unified interface for all DOM-related operations.
 *
 * @example
 * ```typescript
 * import { DOM } from 'signy';
 *
 * // All DOM utilities accessible via autocomplete
 * DOM.query('#app');
 * DOM.addClass(el, 'active');
 * DOM.createRef<HTMLDivElement>();
 * DOM.on(window, 'resize', handler);
 * ```
 */
export const DOM = {
  //=============================================
  // Query & Element Creation
  //=============================================

  /**
   * Query a single element by selector.
   * @see {@link query}
   */
  query,

  /**
   * Query all elements matching a selector.
   * @see {@link queryAll}
   */
  queryAll,

  /**
   * Get element from selector or return element as-is.
   * @see {@link getElement}
   */
  getElement,

  /**
   * Create a new element with optional attributes.
   * @see {@link createElement}
   */
  createElement,

  /**
   * Create a cached template for fast element cloning.
   * @see {@link createTemplate}
   */
  createTemplate,

  /**
   * Create multiple elements efficiently from a template.
   * @see {@link createMany}
   */
  createMany,

  /**
   * Create a DocumentFragment containing multiple elements.
   * @see {@link createFragment}
   */
  createFragment,

  /**
   * Clear the template cache.
   * @see {@link clearTemplateCache}
   */
  clearTemplateCache,

  //=============================================
  // Class Manipulation
  //=============================================

  /**
   * Add classes to an element.
   * @see {@link addClass}
   */
  addClass,

  /**
   * Remove classes from an element.
   * @see {@link removeClass}
   */
  removeClass,

  /**
   * Toggle a class on an element.
   * @see {@link toggleClass}
   */
  toggleClass,

  /**
   * Check if element has a class.
   * @see {@link hasClass}
   */
  hasClass,

  //=============================================
  // Attribute Manipulation
  //=============================================

  /**
   * Set multiple attributes on an element.
   * @see {@link setAttributes}
   */
  setAttributes,

  /**
   * Get all attributes from an element.
   * @see {@link getAttributes}
   */
  getAttributes,

  /**
   * Remove multiple attributes from an element.
   * @see {@link removeAttributes}
   */
  removeAttributes,

  /**
   * Get a single attribute value.
   * @see {@link getAttribute}
   */
  getAttribute,

  /**
   * Check if element has an attribute.
   * @see {@link hasAttribute}
   */
  hasAttribute,

  //=============================================
  // Element References
  //=============================================

  /**
   * Create an element reference container.
   * @see {@link createRef}
   */
  createRef,

  /**
   * Create an element reference with initial value.
   * @see {@link createRefWithValue}
   */
  createRefWithValue,

  /**
   * Check if value is a Ref.
   * @see {@link isRef}
   */
  isRef,

  //=============================================
  // Event Listeners
  //=============================================

  /**
   * Add an event listener with auto-cleanup.
   * @see {@link createEventListener}
   */
  on: createEventListener,

  /**
   * Add an event listener with auto-cleanup.
   * Alias for `on`.
   * @see {@link createEventListener}
   */
  createEventListener,

  /**
   * Add a keydown listener with key filtering.
   * @see {@link createKeydownListener}
   */
  onKeydown: createKeydownListener,

  /**
   * Add a keydown listener with key filtering.
   * Alias for `onKeydown`.
   * @see {@link createKeydownListener}
   */
  createKeydownListener,

  /**
   * Detect clicks outside an element.
   * @see {@link createClickOutside}
   */
  onClickOutside: createClickOutside,

  /**
   * Detect clicks outside an element.
   * Alias for `onClickOutside`.
   * @see {@link createClickOutside}
   */
  createClickOutside,
} as const;

//=============================================
// Type Re-exports
//=============================================

export type {
  ElementOrSelector,
  Ref,
  RefWithValue,
  MaybeAccessor,
  EventListenerOptions,
  KeydownListenerOptions,
};
