/**
 * Event helpers for compiled JSX. Delegation lives in views/events, shared
 * with h() and html.
 *
 * @module jsx/events
 *
 * ## Known limitations
 *
 * None.
 */

import { setDelegatedHandler } from '../views/events';

export { delegateEvents, clearDelegatedEvents } from '../views/events';

/**
 * Adds an event listener to an element, delegated when `delegated` is set.
 * Compiled JSX calls it for `on:event` and for delegated events alike.
 *
 * @param element - Target element
 * @param event - Event name
 * @param handler - Event handler
 * @param delegated - Whether to use delegation
 */
export function addEventListener(
  element: Element,
  event: string,
  handler: EventListener,
  delegated?: boolean
): void {
  if (delegated) {
    setDelegatedHandler(element, event, handler);
  } else {
    element.addEventListener(event, handler);
  }
}

/**
 * Adds a capture-phase event listener.
 *
 * @param element - Target element
 * @param event - Event name
 * @param handler - Event handler
 */
export function addCaptureEventListener(
  element: Element,
  event: string,
  handler: EventListener
): void {
  element.addEventListener(event, handler, true);
}
