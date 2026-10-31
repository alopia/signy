/**
 * Application log messages
 *
 * Log message identifiers for the application module.
 *
 * @module app/log-messages
 */

/**
 * Application log messages object with namespaced string identifiers.
 *
 * @example
 * ```typescript
 * import { AppLogMessages } from './log-messages';
 * logger.error(AppLogMessages.NOT_MOUNTED);
 * ```
 */
export const AppLogMessages = {
  /** Application is not mounted */
  NOT_MOUNTED: 'app:not-mounted',

  /** Invalid mount target. Must be a valid CSS selector or HTMLElement */
  INVALID_MOUNT_TARGET: 'app:invalid-mount-target',

  /** Application is in an invalid state */
  INVALID_STATE: 'app:invalid-state',

  /** Application instance not found */
  NOT_FOUND: 'app:not-found',

  /** Component instance is already bound to another application */
  COMPONENT_ALREADY_BOUND: 'app:component-already-bound',

  /** defineElement() got a prop named like a property every element has */
  ELEMENT_RESERVED_PROP: 'app:element-reserved-prop',
} as const;

/** Type for application log messages */
export type AppLogMessage =
  (typeof AppLogMessages)[keyof typeof AppLogMessages];
