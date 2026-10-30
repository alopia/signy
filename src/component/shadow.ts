/**
 * Shadow DOM Support Module
 *
 * Provides Shadow DOM functionality for Signy components, enabling
 * true CSS and DOM isolation for micro frontends and embeddable widgets.
 *
 * This module follows a hybrid OOP + helper functions approach:
 * - Components use class properties and methods for Shadow DOM
 * - Helper functions are available for advanced use cases
 *
 * @module component/shadow
 *
 * @example
 * ```typescript
 * // Class-based usage (recommended)
 * class Widget extends Component {
 *   protected shadow = true;
 *   protected styles = ':host { display: block; }';
 * }
 *
 * // With options
 * class IsolatedWidget extends Component {
 *   protected shadow: ShadowOptions = {
 *     mode: 'open',
 *     delegatesFocus: true,
 *   };
 * }
 *
 * // Helper function usage
 * const options = normalizeShadowOptions(true);
 * const root = attachShadow(element, options);
 * applyStyles(root, ':host { display: block; }');
 * ```
 *
 * ## Known limitations
 *
 * - Constructable Stylesheets are not supported in all browsers (Safari < 16.4)
 * - Declarative Shadow DOM SSR requires browser support
 */

import type { ShadowOptions, NormalizedShadowOptions } from '../types';
import { logger, panic } from '../log';
import { ComponentLogMessages } from './log-messages';
import { delegateShadowRoot } from '../views/events';
import { setBounded } from '../utils/bounded-cache';
import { appliedStyles } from './applied-styles';

//=============================================
// Constants
//=============================================

/** Parsed sheets by CSS text, shared by every root that adopts them */
const sheetCache = new Map<string, CSSStyleSheet>();

/** Roots attached here, closed ones included, by host */
const attachedRoots = new WeakMap<Element, ShadowRoot>();

/**
 * Default Shadow DOM options
 */
export const DEFAULT_SHADOW_OPTIONS: NormalizedShadowOptions = {
  mode: 'open',
  delegatesFocus: false,
  slotAssignment: 'named',
};

/**
 * Check if Shadow DOM is supported in the current environment
 */
export const SHADOW_DOM_SUPPORTED =
  typeof Element !== 'undefined' &&
  typeof Element.prototype.attachShadow === 'function';

/**
 * Check if Constructable Stylesheets are supported
 */
export const CONSTRUCTABLE_STYLESHEETS_SUPPORTED =
  typeof CSSStyleSheet !== 'undefined' &&
  typeof CSSStyleSheet.prototype.replaceSync === 'function';

/**
 * Check if Declarative Shadow DOM is supported
 */
export const DECLARATIVE_SHADOW_DOM_SUPPORTED =
  typeof HTMLTemplateElement !== 'undefined' &&
  'shadowRootMode' in HTMLTemplateElement.prototype;

//=============================================
// Type Guards
//=============================================

/**
 * Check if a value is a ShadowOptions object
 */
export function isShadowOptions(value: unknown): value is ShadowOptions {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Check if shadow is enabled (true or valid options object)
 */
export function isShadowEnabled(
  shadow: boolean | ShadowOptions | undefined
): shadow is true | ShadowOptions {
  if (shadow === true) return true;
  if (isShadowOptions(shadow)) {
    // Empty object means enabled with defaults
    return true;
  }
  return false;
}

//=============================================
// Normalization Functions
//=============================================

/**
 * Normalize shadow configuration to a consistent options object.
 * Handles `true`, `undefined`, and partial options.
 *
 * @param shadow - Shadow configuration (boolean, options, or undefined)
 * @returns Normalized options object, or null if shadow is disabled
 *
 * @example
 * ```typescript
 * normalizeShadowOptions(true);
 * // { mode: 'open', delegatesFocus: false, slotAssignment: 'named' }
 *
 * normalizeShadowOptions({ mode: 'closed' });
 * // { mode: 'closed', delegatesFocus: false, slotAssignment: 'named' }
 *
 * normalizeShadowOptions(false);
 * // null
 * ```
 */
export function normalizeShadowOptions(
  shadow: boolean | ShadowOptions | undefined
): NormalizedShadowOptions | null {
  if (!isShadowEnabled(shadow)) {
    return null;
  }

  const options = shadow === true ? {} : shadow;

  return {
    mode: options.mode ?? DEFAULT_SHADOW_OPTIONS.mode,
    delegatesFocus:
      options.delegatesFocus ?? DEFAULT_SHADOW_OPTIONS.delegatesFocus,
    ssr: options.ssr,
    slotAssignment:
      options.slotAssignment ?? DEFAULT_SHADOW_OPTIONS.slotAssignment,
  };
}

/**
 * Merge shadow options from class property and constructor.
 * Constructor options take precedence.
 *
 * @param classOption - Shadow option from class property
 * @param constructorOption - Shadow option from constructor
 * @returns Merged and normalized options
 */
export function mergeShadowOptions(
  classOption: boolean | ShadowOptions | undefined,
  constructorOption: boolean | ShadowOptions | undefined
): NormalizedShadowOptions | null {
  // Constructor option takes precedence
  if (constructorOption !== undefined) {
    // Explicit false disables even if class has shadow enabled
    if (constructorOption === false) {
      return null;
    }
    return normalizeShadowOptions(constructorOption);
  }

  return normalizeShadowOptions(classOption);
}

//=============================================
// Shadow Root Functions
//=============================================

/**
 * Create a shadow root attachment configuration.
 * Maps NormalizedShadowOptions to ShadowRootInit.
 *
 * @param options - Normalized shadow options
 * @returns ShadowRootInit configuration
 */
export function createShadowRootInit(
  options: NormalizedShadowOptions
): ShadowRootInit {
  return {
    mode: options.mode,
    delegatesFocus: options.delegatesFocus,
    slotAssignment: options.slotAssignment,
  };
}

/**
 * Attach a shadow root to an element.
 *
 * @param element - Element to attach shadow root to
 * @param options - Shadow options (or use defaults)
 * @returns The created ShadowRoot
 * @throws If Shadow DOM is not supported
 *
 * @example
 * ```typescript
 * const shadowRoot = attachShadow(element, { mode: 'open' });
 * shadowRoot.innerHTML = '<slot></slot>';
 * ```
 */
export function attachShadow(
  element: Element,
  options: NormalizedShadowOptions = DEFAULT_SHADOW_OPTIONS
): ShadowRoot {
  if (!SHADOW_DOM_SUPPORTED) {
    logger.warn(ComponentLogMessages.SHADOW_DOM_NOT_SUPPORTED);
    throw new Error('Shadow DOM is not supported');
  }

  // A root cannot be detached, so a remount into the same host reuses it
  const existing = attachedRoots.get(element);
  if (existing) return existing;

  const init = createShadowRootInit(options);
  let root: ShadowRoot;
  try {
    root = element.attachShadow(init);
  } catch (cause) {
    panic(ComponentLogMessages.SHADOW_DOM_ATTACH_FAILED, {
      tag: element.tagName.toLowerCase(),
      cause,
    });
  }
  if (init.mode === 'closed') delegateShadowRoot(root);
  attachedRoots.set(element, root);
  return root;
}

/**
 * Check if an element already has a shadow root.
 *
 * @param element - Element to check
 * @returns True if element has a shadow root
 */
export function hasShadowRoot(element: Element): boolean {
  return element.shadowRoot !== null;
}

/**
 * Get the shadow root of an element, if it exists and is accessible.
 *
 * @param element - Element to get shadow root from
 * @returns The shadow root, or null if none or closed
 */
export function getShadowRoot(element: Element): ShadowRoot | null {
  return element.shadowRoot;
}

//=============================================
// Style Functions
//=============================================

/**
 * Normalize styles to an array of strings.
 * Handles string, array of strings, CSSStyleSheet, and mixed array inputs.
 *
 * @param styles - Styles in various formats
 * @returns Array of style strings (CSSStyleSheets are kept separate)
 */
export function normalizeStyles(
  styles:
    | string
    | string[]
    | CSSStyleSheet[]
    | Array<string | CSSStyleSheet>
    | undefined
): { strings: string[]; sheets: CSSStyleSheet[] } {
  if (!styles) {
    return { strings: [], sheets: [] };
  }

  if (typeof styles === 'string') {
    return { strings: [styles], sheets: [] };
  }

  const strings: string[] = [];
  const sheets: CSSStyleSheet[] = [];

  for (const style of styles) {
    if (typeof style === 'string') {
      strings.push(style);
    } else if (style instanceof CSSStyleSheet) {
      sheets.push(style);
    }
  }

  return { strings, sheets };
}

/**
 * Create a CSSStyleSheet from a style string.
 * Needs Constructable Stylesheets, see CONSTRUCTABLE_STYLESHEETS_SUPPORTED.
 *
 * @param css - CSS string
 * @returns CSSStyleSheet instance
 */
export function createStyleSheet(css: string): CSSStyleSheet {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  return sheet;
}

/**
 * Apply styles to a shadow root.
 * Uses adoptedStyleSheets if supported (shared, performant),
 * falls back to inline style elements.
 *
 * @param shadowRoot - The shadow root to apply styles to
 * @param styles - Styles to apply (string, array, or CSSStyleSheet)
 *
 * @example
 * ```typescript
 * // String styles
 * applyStyles(shadowRoot, ':host { display: block; }');
 *
 * // Multiple styles
 * applyStyles(shadowRoot, [baseStyles, componentStyles]);
 *
 * // Pre-created stylesheets (best performance)
 * const sheet = createStyleSheet(':host { display: block; }');
 * applyStyles(shadowRoot, [sheet]);
 * ```
 */
export function applyStyles(
  shadowRoot: ShadowRoot,
  styles:
    | string
    | string[]
    | CSSStyleSheet[]
    | Array<string | CSSStyleSheet>
    | undefined
): void {
  if (!styles) return;

  const { strings, sheets } = normalizeStyles(styles);

  // Use adoptedStyleSheets if supported (better performance)
  if (CONSTRUCTABLE_STYLESHEETS_SUPPORTED) {
    const adoptedSheets: CSSStyleSheet[] = [...sheets];

    // One sheet per CSS string, adopted by every instance
    for (const css of strings) {
      let sheet = sheetCache.get(css);
      if (!sheet) {
        sheet = createStyleSheet(css);
        setBounded(sheetCache, css, sheet);
      }
      adoptedSheets.push(sheet);
    }

    if (adoptedSheets.length > 0) {
      shadowRoot.adoptedStyleSheets = adoptedSheets;
    }
  } else {
    // Fallback: Create inline <style> elements
    for (const css of strings) {
      const styleEl = document.createElement('style');
      styleEl.textContent = css;
      appliedStyles.add(styleEl);
      shadowRoot.appendChild(styleEl);
    }

    // CSSStyleSheets can't be used without adoptedStyleSheets support
    if (sheets.length > 0) {
      logger.warn(ComponentLogMessages.SHADOW_DOM_NOT_SUPPORTED);
    }
  }
}

/**
 * Merge styles from multiple sources (class property, constructor, etc.)
 *
 * @param sources - Array of style sources to merge
 * @returns Combined styles array
 */
export function mergeStyles(
  ...sources: Array<string | string[] | CSSStyleSheet[] | undefined>
): Array<string | CSSStyleSheet> {
  const result: Array<string | CSSStyleSheet> = [];

  for (const source of sources) {
    if (!source) continue;

    if (typeof source === 'string') {
      result.push(source);
    } else if (Array.isArray(source)) {
      for (const item of source) {
        result.push(item);
      }
    }
  }

  return result;
}

//=============================================
// Slot Helper Functions
//=============================================

/**
 * Selector for a named slot, or the default one. Quotes, backslashes and line
 * breaks in the name are escaped, so any name gives a valid selector.
 */
function slotSelector(slotName?: string): string {
  if (!slotName) return 'slot:not([name])';
  const escaped = slotName
    .replace(/["\\]/g, '\\$&')
    .replace(/[\n\r\f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `);
  return `slot[name="${escaped}"]`;
}

/**
 * Get all slotted elements for a slot.
 *
 * @param shadowRoot - The shadow root containing the slot
 * @param slotName - Name of the slot (undefined for default slot)
 * @returns Array of elements assigned to the slot
 *
 * @example
 * ```typescript
 * // Get default slot content
 * const content = getSlottedElements(shadowRoot);
 *
 * // Get named slot content
 * const header = getSlottedElements(shadowRoot, 'header');
 * ```
 */
export function getSlottedElements(
  shadowRoot: ShadowRoot,
  slotName?: string
): Element[] {
  const selector = slotSelector(slotName);

  const slot = shadowRoot.querySelector(selector) as HTMLSlotElement | null;

  if (!slot) {
    return [];
  }

  return slot.assignedElements();
}

/**
 * Get all slotted nodes (including text nodes) for a slot.
 *
 * @param shadowRoot - The shadow root containing the slot
 * @param slotName - Name of the slot (undefined for default slot)
 * @returns Array of nodes assigned to the slot
 */
export function getSlottedNodes(
  shadowRoot: ShadowRoot,
  slotName?: string
): Node[] {
  const selector = slotSelector(slotName);

  const slot = shadowRoot.querySelector(selector) as HTMLSlotElement | null;

  if (!slot) {
    return [];
  }

  return slot.assignedNodes();
}

/**
 * Check if a slot has any assigned content.
 *
 * @param shadowRoot - The shadow root containing the slot
 * @param slotName - Name of the slot (undefined for default slot)
 * @returns True if slot has an element or text that is not only whitespace
 */
export function hasSlottedContent(
  shadowRoot: ShadowRoot,
  slotName?: string
): boolean {
  // Text counts too, a label for example, but not the indenting between tags
  return getSlottedNodes(shadowRoot, slotName).some(
    (node) =>
      node.nodeType === Node.ELEMENT_NODE ||
      (node.nodeType === Node.TEXT_NODE && node.textContent!.trim() !== '')
  );
}

/**
 * Listen for slot changes on a specific slot.
 *
 * @param shadowRoot - The shadow root containing the slot
 * @param slotName - Name of the slot (undefined for default slot)
 * @param callback - Callback when slot content changes
 * @returns Cleanup function to remove listener
 *
 * @example
 * ```typescript
 * const cleanup = onSlotChange(shadowRoot, 'header', (elements) => {
 *   console.log('Header slot changed:', elements);
 * });
 *
 * // Later: cleanup();
 * ```
 */
export function onSlotChange(
  shadowRoot: ShadowRoot,
  slotName: string | undefined,
  callback: (elements: Element[]) => void
): () => void {
  const selector = slotSelector(slotName);

  const slot = shadowRoot.querySelector(selector) as HTMLSlotElement | null;

  if (!slot) {
    return () => {};
  }

  const handler = () => {
    callback(slot.assignedElements());
  };

  slot.addEventListener('slotchange', handler);

  return () => {
    slot.removeEventListener('slotchange', handler);
  };
}

//=============================================
// Event Helper Functions
//=============================================

/**
 * Options for creating composed custom events
 */
export interface ComposedEventOptions<T = unknown> {
  /** Event detail data */
  detail?: T;
  /** Whether event bubbles (default: true) */
  bubbles?: boolean;
  /** Whether event is cancelable (default: false) */
  cancelable?: boolean;
}

/**
 * Create a custom event that crosses shadow DOM boundaries.
 * Sets `composed: true` to allow the event to escape the shadow root.
 *
 * @param name - Event name
 * @param options - Event options
 * @returns CustomEvent that will cross shadow boundaries
 *
 * @example
 * ```typescript
 * // In shadow DOM component
 * const event = createComposedEvent('value-change', { detail: { value: 42 } });
 * this.dispatchEvent(event);
 *
 * // Parent can listen normally
 * element.addEventListener('value-change', (e) => console.log(e.detail.value));
 * ```
 */
export function createComposedEvent<T = unknown>(
  name: string,
  options: ComposedEventOptions<T> = {}
): CustomEvent<T> {
  return new CustomEvent<T>(name, {
    detail: options.detail,
    bubbles: options.bubbles ?? true,
    cancelable: options.cancelable ?? false,
    composed: true, // Always true - the whole point of this function
  });
}

/**
 * Dispatch a composed custom event from an element.
 * Convenience wrapper for createComposedEvent + dispatchEvent.
 *
 * @param element - Element to dispatch from
 * @param name - Event name
 * @param detail - Event detail data
 * @returns True if event was not cancelled
 *
 * @example
 * ```typescript
 * // In component method
 * emit(this.container, 'value-change', { value: 42 });
 * ```
 */
export function emit<T = unknown>(
  element: Element | ShadowRoot,
  name: string,
  detail?: T
): boolean {
  const event = createComposedEvent(name, { detail });
  return element.dispatchEvent(event);
}

//=============================================
// SSR Helper Functions
//=============================================

/**
 * Check if we're in a server-side rendering context.
 * Used to determine if light DOM fallback should be used.
 */
export function isSSR(): boolean {
  return typeof window === 'undefined' || typeof document === 'undefined';
}

/**
 * Determine if shadow DOM should be used based on options and environment.
 * Returns false during SSR unless declarative shadow DOM is used.
 *
 * @param options - Normalized shadow options
 * @returns True if shadow DOM should be attached
 */
export function shouldUseShadowDOM(
  options: NormalizedShadowOptions | null
): boolean {
  if (!options) return false;

  // During SSR, check the ssr mode
  if (isSSR()) {
    // Only use shadow DOM on server with declarative mode
    return options.ssr === 'declarative' && DECLARATIVE_SHADOW_DOM_SUPPORTED;
  }

  // On client, always use shadow DOM if enabled
  return SHADOW_DOM_SUPPORTED;
}

/**
 * Generate Declarative Shadow DOM template HTML.
 * Used for SSR with shadow DOM support.
 *
 * @param options - Shadow options
 * @param content - Shadow root content HTML
 * @param styles - Styles to include
 * @returns HTML string with declarative shadow DOM template
 *
 * @example
 * ```typescript
 * const html = generateDeclarativeShadowDOM(
 *   { mode: 'open' },
 *   '<slot></slot>',
 *   ':host { display: block; }'
 * );
 * // <template shadowrootmode="open"><style>:host { display: block; }</style><slot></slot></template>
 * ```
 */
export function generateDeclarativeShadowDOM(
  options: NormalizedShadowOptions,
  content: string,
  styles?: string | string[]
): string {
  const { strings } = normalizeStyles(styles);
  // `</` would end the style element early, `<\/` is the same CSS
  const styleHTML = strings
    .map((css) => `<style>${css.replace(/<\//g, '<\\/')}</style>`)
    .join('');

  const attrs = [
    `shadowrootmode="${options.mode}"`,
    options.delegatesFocus ? 'shadowrootdelegatesfocus' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return `<template ${attrs}>${styleHTML}${content}</template>`;
}
