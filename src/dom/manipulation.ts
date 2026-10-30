/**
 * DOM Manipulation Utilities
 *
 * Provides utilities for manipulating DOM element classes and attributes.
 *
 * @module dom/manipulation
 *
 * @example
 * ```typescript
 * import { addClass, removeClass, toggleClass, hasClass, setAttributes } from 'signy';
 *
 * // Class manipulation
 * addClass(button, 'active', 'primary');
 * removeClass(button, 'disabled');
 * toggleClass(menu, 'open');
 *
 * if (hasClass(button, 'active')) {
 *   // Do something
 * }
 *
 * // Attribute manipulation
 * setAttributes(input, {
 *   type: 'text',
 *   placeholder: 'Enter name'
 * });
 * ```
 *
 * ## Known limitations
 *
 * None.
 */

import { isUnsafeAttribute } from './unsafe-attribute';
import { logger } from '../log';
import { ViewLogMessages } from '../views/log-messages';

//=============================================
// Class Manipulation
//=============================================

/**
 * Adds one or more CSS classes to an element.
 *
 * @param element - The DOM element
 * @param classNames - Class names to add
 *
 * @example
 * ```typescript
 * addClass(button, 'active', 'primary');
 * ```
 */
export function addClass(element: Element, ...classNames: string[]): void {
  element.classList.add(...classNames);
}

/**
 * Removes one or more CSS classes from an element.
 *
 * @param element - The DOM element
 * @param classNames - Class names to remove
 *
 * @example
 * ```typescript
 * removeClass(button, 'active', 'disabled');
 * ```
 */
export function removeClass(element: Element, ...classNames: string[]): void {
  element.classList.remove(...classNames);
}

/**
 * Toggles a CSS class on an element.
 *
 * @param element - The DOM element
 * @param className - Class name to toggle
 * @param force - If provided, adds class if true, removes if false
 * @returns True if the class is now present, false otherwise
 *
 * @example
 * ```typescript
 * toggleClass(menu, 'open');
 * toggleClass(button, 'active', isActive);
 * ```
 */
export function toggleClass(
  element: Element,
  className: string,
  force?: boolean
): boolean {
  return element.classList.toggle(className, force);
}

/**
 * Checks if an element has a specific CSS class.
 *
 * @param element - The DOM element
 * @param className - Class name to check
 * @returns True if element has the class, false otherwise
 *
 * @example
 * ```typescript
 * if (hasClass(button, 'active')) {
 *   // Do something
 * }
 * ```
 */
export function hasClass(element: Element, className: string): boolean {
  return element.classList.contains(className);
}

//=============================================
// Attribute Manipulation
//=============================================

/**
 * Sets multiple attributes on an element.
 *
 * @param element - The DOM element
 * @param attributes - Object of attribute key-value pairs
 *
 * @example
 * ```typescript
 * setAttributes(input, {
 *   type: 'text',
 *   placeholder: 'Enter name',
 *   'data-id': '123'
 * });
 * ```
 */
export function setAttributes(
  element: Element,
  attributes: Record<string, string>
): void {
  for (const [key, value] of Object.entries(attributes)) {
    if (isUnsafeAttribute(key, value)) {
      if (__DEV__) logger.warn(ViewLogMessages.UNSAFE_ATTRIBUTE, { name: key });
      continue;
    }
    element.setAttribute(key, value);
  }
}

/**
 * Gets all attributes from an element as an object.
 *
 * @param element - The DOM element
 * @returns Object with attribute names as keys and values
 *
 * @example
 * ```typescript
 * const attrs = getAttributes(element);
 * console.log(attrs.id, attrs.class);
 * ```
 */
export function getAttributes(element: Element): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attrs = element.attributes;
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs.item(i);
    if (attr) {
      attributes[attr.name] = attr.value;
    }
  }
  return attributes;
}

/**
 * Removes one or more attributes from an element.
 *
 * @param element - The DOM element
 * @param attributeNames - Attribute names to remove
 *
 * @example
 * ```typescript
 * removeAttributes(input, 'disabled', 'readonly');
 * ```
 */
export function removeAttributes(
  element: Element,
  ...attributeNames: string[]
): void {
  for (const name of attributeNames) {
    element.removeAttribute(name);
  }
}

/**
 * Gets a single attribute value from an element.
 *
 * @param element - The DOM element
 * @param attributeName - The attribute name
 * @returns The attribute value or null if not set
 *
 * @example
 * ```typescript
 * const id = getAttribute(element, 'data-id');
 * ```
 */
export function getAttribute(
  element: Element,
  attributeName: string
): string | null {
  return element.getAttribute(attributeName);
}

/**
 * Checks if an element has a specific attribute.
 *
 * @param element - The DOM element
 * @param attributeName - The attribute name to check
 * @returns True if the element has the attribute
 *
 * @example
 * ```typescript
 * if (hasAttribute(input, 'required')) {
 *   // Input is required
 * }
 * ```
 */
export function hasAttribute(element: Element, attributeName: string): boolean {
  return element.hasAttribute(attributeName);
}
