/**
 * DOM Query Utilities
 *
 * Provides utilities for querying and creating DOM elements.
 *
 * @module dom/query
 *
 * @example
 * ```typescript
 * import { query, queryAll, createElement, getElement } from 'signy';
 *
 * // Query single element
 * const button = query('.submit-btn');
 *
 * // Query multiple elements
 * const items = queryAll('.list-item');
 *
 * // Create element with attributes
 * const div = createElement('div', { class: 'container' }, ['Hello']);
 *
 * // Get element from selector or element
 * const el = getElement('#app');
 * ```
 *
 * ## Known limitations
 *
 * None.
 */

import type { ElementOrSelector } from '../types';
import { isUnsafeAttribute } from './unsafe-attribute';
import { logger } from '../log';
import { ViewLogMessages } from '../views/log-messages';

// Re-export for documentation
export type { ElementOrSelector };

//=============================================
// Query Functions
//=============================================

/**
 * Queries for a single element matching the selector.
 *
 * @param selector - CSS selector string
 * @param parent - Parent element or document to search within (defaults to document)
 * @returns The first matching element or null if not found
 *
 * @example
 * ```typescript
 * const button = query('.submit-btn');
 * const item = query('.item', container);
 * ```
 */
export function query(
  selector: string,
  parent: Element | Document = document
): Element | null {
  return parent.querySelector(selector);
}

/**
 * Queries for all elements matching the selector.
 *
 * @param selector - CSS selector string
 * @param parent - Parent element or document to search within (defaults to document)
 * @returns Array of matching elements (empty array if none found)
 *
 * @example
 * ```typescript
 * const buttons = queryAll('.btn');
 * const items = queryAll('.item', container);
 * ```
 */
export function queryAll(
  selector: string,
  parent: Element | Document = document
): Element[] {
  return Array.from(parent.querySelectorAll(selector));
}

//=============================================
// Element Creation
//=============================================

/**
 * Creates a new HTML element with optional attributes and children.
 *
 * @template K - HTML element tag name type
 * @param tag - HTML tag name (e.g., 'div', 'span', 'button')
 * @param attributes - Object of attribute key-value pairs
 * @param children - Array of child elements or text strings
 * @returns The created HTML element
 *
 * @example
 * ```typescript
 * const div = createElement('div',
 *   { class: 'container', id: 'main' },
 *   [createElement('span', {}, ['Hello']), 'World']
 * );
 * ```
 */
export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes?: Record<string, string>,
  children?: (Element | string)[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);

  if (attributes) {
    for (const [key, value] of Object.entries(attributes)) {
      if (isUnsafeAttribute(key, value)) {
        if (__DEV__)
          logger.warn(ViewLogMessages.UNSAFE_ATTRIBUTE, { name: key });
        continue;
      }
      element.setAttribute(key, value);
    }
  }

  if (children) {
    for (const child of children) {
      if (typeof child === 'string') {
        element.appendChild(document.createTextNode(child));
      } else {
        element.appendChild(child);
      }
    }
  }

  return element;
}

//=============================================
// Element Resolution
//=============================================

/**
 * Gets an element from either a CSS selector string or an Element instance.
 *
 * @param target - Either a CSS selector string or an Element
 * @returns The element or null if selector doesn't match
 *
 * @example
 * ```typescript
 * const el1 = getElement('#app');           // From selector
 * const el2 = getElement(document.body);    // From element
 * ```
 */
export function getElement(target: Element | string): Element | null {
  if (typeof target === 'string') {
    return document.querySelector(target);
  }
  return target;
}
