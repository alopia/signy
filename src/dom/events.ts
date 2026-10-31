/**
 * DOM Event Listeners with Auto-Cleanup
 *
 * Provides utilities for adding event listeners that automatically
 * clean up when the owning reactive context is disposed.
 *
 * @module dom/events
 *
 * @example
 * ```typescript
 * import { createEventListener, createKeydownListener, createClickOutside } from 'signy';
 *
 * class MyComponent extends Component {
 *   protected onMount() {
 *     // Auto-cleanup when component unmounts
 *     createEventListener(document, 'keydown', (e) => {
 *       if (e.key === 'Escape') this.close();
 *     });
 *
 *     // With options
 *     createEventListener(window, 'scroll', this.handleScroll, {
 *       passive: true
 *     });
 *
 *     // Keyboard shortcut
 *     createKeydownListener(document, 'Escape', () => this.close());
 *
 *     // Click outside detection
 *     createClickOutside(
 *       () => this.dropdownRef.current,
 *       () => this.closeDropdown()
 *     );
 *   }
 * }
 * ```
 *
 * ## Known limitations
 *
 * **Reactive targets require effect context**: When using a reactive target
 * (accessor function), the listener re-attachment happens in an effect.
 * This means changes are batched and may not be immediate.
 */

import { effect, onCleanup } from '../reactivity/effect';

//=============================================
// Types
//=============================================

/**
 * A value that can be either a direct value or an accessor function.
 */
export type MaybeAccessor<T> = T | (() => T);

/**
 * Valid event target types
 */
type EventTargetLike = Window | Document | HTMLElement | Element | EventTarget;

/**
 * Options for createEventListener
 */
export interface EventListenerOptions extends AddEventListenerOptions {
  /**
   * If true, the listener won't be attached until the target is available.
   * Useful for reactive targets that may be null initially.
   * @default true
   */
  skipNull?: boolean;
}

/**
 * Options for createKeydownListener
 */
export interface KeydownListenerOptions extends EventListenerOptions {
  /** Require Ctrl/Cmd key */
  ctrl?: boolean;
  /** Require Alt key */
  alt?: boolean;
  /** Require Shift key */
  shift?: boolean;
  /** Require Meta key (Cmd on Mac) */
  meta?: boolean;
}

//=============================================
// Helpers
//=============================================

/**
 * Unwraps a MaybeAccessor to get its value.
 */
function access<T>(value: MaybeAccessor<T>): T {
  return typeof value === 'function' ? (value as () => T)() : value;
}

/**
 * Checks if a value is an accessor function.
 */
function isAccessor<T>(value: MaybeAccessor<T>): value is () => T {
  return typeof value === 'function';
}

//=============================================
// createEventListener
//=============================================

/**
 * Adds an event listener to a Window that automatically cleans up.
 *
 * @param target - The Window to attach the listener to
 * @param event - The event name
 * @param handler - The event handler
 * @param options - Event listener options
 * @returns A cleanup function to manually remove the listener
 */
export function createEventListener<K extends keyof WindowEventMap>(
  target: MaybeAccessor<Window | null | undefined>,
  event: K,
  handler: (event: WindowEventMap[K]) => void,
  options?: EventListenerOptions
): () => void;

/**
 * Adds an event listener to a Document that automatically cleans up.
 *
 * @param target - The Document to attach the listener to
 * @param event - The event name
 * @param handler - The event handler
 * @param options - Event listener options
 * @returns A cleanup function to manually remove the listener
 */
export function createEventListener<K extends keyof DocumentEventMap>(
  target: MaybeAccessor<Document | null | undefined>,
  event: K,
  handler: (event: DocumentEventMap[K]) => void,
  options?: EventListenerOptions
): () => void;

/**
 * Adds an event listener to an HTMLElement that automatically cleans up.
 *
 * @param target - The HTMLElement to attach the listener to
 * @param event - The event name
 * @param handler - The event handler
 * @param options - Event listener options
 * @returns A cleanup function to manually remove the listener
 */
export function createEventListener<K extends keyof HTMLElementEventMap>(
  target: MaybeAccessor<HTMLElement | null | undefined>,
  event: K,
  handler: (event: HTMLElementEventMap[K]) => void,
  options?: EventListenerOptions
): () => void;

/**
 * Adds an event listener to any EventTarget that automatically cleans up.
 *
 * @param target - The EventTarget to attach the listener to
 * @param event - The event name
 * @param handler - The event handler
 * @param options - Event listener options
 * @returns A cleanup function to manually remove the listener
 */
export function createEventListener(
  target: MaybeAccessor<EventTargetLike | null | undefined>,
  event: string,
  handler: (event: Event) => void,
  options?: EventListenerOptions
): () => void;

/**
 * Implementation of createEventListener.
 */
export function createEventListener(
  target: MaybeAccessor<EventTargetLike | null | undefined>,
  event: string,
  handler: (event: Event) => void,
  options?: EventListenerOptions
): () => void {
  const { skipNull = true, ...listenerOptions } = options ?? {};

  // Track if manually cleaned up
  let manuallyRemoved = false;

  // Track current attached target for cleanup
  let currentTarget: EventTargetLike | null = null;

  const attachListener = (t: EventTargetLike | null | undefined) => {
    if (manuallyRemoved) return;

    // Remove from previous target if different
    if (currentTarget && currentTarget !== t) {
      currentTarget.removeEventListener(event, handler, listenerOptions);
      currentTarget = null;
    }

    // Skip null targets if configured
    if (!t) {
      if (!skipNull && t === null) {
        currentTarget = null;
      }
      return;
    }

    // Attach to new target
    if (t !== currentTarget) {
      t.addEventListener(event, handler, listenerOptions);
      currentTarget = t;
    }
  };

  const removeListener = () => {
    manuallyRemoved = true;
    if (currentTarget) {
      currentTarget.removeEventListener(event, handler, listenerOptions);
      currentTarget = null;
    }
  };

  // If target is an accessor (reactive), use an effect to track changes
  if (isAccessor(target)) {
    effect(() => {
      const t = target();
      attachListener(t);

      // Cleanup when effect re-runs or disposes
      onCleanup(() => {
        if (currentTarget) {
          currentTarget.removeEventListener(event, handler, listenerOptions);
          currentTarget = null;
        }
      });
    });
  } else {
    // Static target - attach immediately
    attachListener(target);

    // Register cleanup for when owner disposes
    onCleanup(removeListener);
  }

  return removeListener;
}

//=============================================
// createKeydownListener
//=============================================

/**
 * Creates a keyboard event listener with key filtering.
 *
 * @param target - The target to attach the listener to
 * @param key - The key or keys to listen for
 * @param handler - The handler to call when the key is pressed
 * @param options - Event listener options (plus modifier requirements)
 * @returns A cleanup function
 *
 * @example
 * ```typescript
 * // Listen for Escape key
 * createKeydownListener(document, 'Escape', () => closeModal());
 *
 * // Listen for multiple keys
 * createKeydownListener(document, ['Enter', ' '], () => submit());
 *
 * // With modifiers
 * createKeydownListener(document, 's', () => save(), { ctrl: true });
 * ```
 */
export function createKeydownListener(
  target: MaybeAccessor<EventTargetLike | null | undefined>,
  key: string | string[],
  handler: (event: KeyboardEvent) => void,
  options?: KeydownListenerOptions
): () => void {
  const { ctrl, alt, shift, meta, ...listenerOptions } = options ?? {};
  const keys = Array.isArray(key) ? key : [key];

  return createEventListener(
    target as MaybeAccessor<Document>,
    'keydown',
    (e: KeyboardEvent) => {
      // Check key match
      if (!keys.includes(e.key)) return;

      // Check modifiers
      if (ctrl !== undefined && e.ctrlKey !== ctrl) return;
      if (alt !== undefined && e.altKey !== alt) return;
      if (shift !== undefined && e.shiftKey !== shift) return;
      if (meta !== undefined && e.metaKey !== meta) return;

      handler(e);
    },
    listenerOptions
  );
}

//=============================================
// createClickOutside
//=============================================

/**
 * Creates a click-outside listener for detecting clicks outside an element.
 *
 * @param element - The element to detect clicks outside of
 * @param handler - Called when a click occurs outside the element
 * @param options - Event listener options
 * @returns A cleanup function
 *
 * @example
 * ```typescript
 * const dropdownRef = createRef<HTMLDivElement>();
 *
 * createClickOutside(
 *   () => dropdownRef.current,
 *   () => closeDropdown()
 * );
 * ```
 */
export function createClickOutside(
  element: MaybeAccessor<Element | null | undefined>,
  handler: (event: MouseEvent) => void,
  options?: EventListenerOptions
): () => void {
  return createEventListener(
    document,
    'click',
    (e: MouseEvent) => {
      const el = access(element);
      if (!el) return;

      // composedPath(), as e.target is the host for a click in a shadow root
      if (!e.composedPath().includes(el)) handler(e);
    },
    options
  );
}
