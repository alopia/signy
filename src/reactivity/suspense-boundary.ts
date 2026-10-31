/**
 * The Suspense boundary that lazy components and resources register their
 * loads with. Suspense puts it in its children's owner context, so it is
 * found by ownership, also from content rendered later.
 *
 * @module reactivity/suspense-boundary
 * @internal
 */

import { getContextValue, runWithContext } from './effect';

/**
 * Shows a fallback while any registered promise is pending.
 */
export interface SuspenseBoundary {
  register: (promise: Promise<unknown>) => void;
  unregister: (promise: Promise<unknown>) => void;
}

const SUSPENSE_BOUNDARY: unique symbol = Symbol('signy.suspenseBoundary');

/**
 * Runs fn under an owner whose content suspends `boundary`.
 *
 * @internal
 */
export function runInSuspenseBoundary<T>(
  boundary: SuspenseBoundary,
  fn: () => T
): T {
  return runWithContext(SUSPENSE_BOUNDARY, boundary, fn);
}

/**
 * The nearest Suspense boundary above the current owner.
 *
 * @internal
 */
export function getSuspenseBoundary(): SuspenseBoundary | undefined {
  return getContextValue(SUSPENSE_BOUNDARY) as SuspenseBoundary | undefined;
}
