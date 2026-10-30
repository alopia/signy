/**
 * Component log messages
 *
 * Log message identifiers for the component module.
 *
 * @module component/log-messages
 */

/**
 * Component log messages object with namespaced string identifiers.
 *
 * @example
 * ```typescript
 * import { ComponentLogMessages } from './log-messages';
 * logger.error(ComponentLogMessages.MOUNT_FAILED);
 * ```
 */
export const ComponentLogMessages = {
  /** Component requires an Application context. Use application(Component).mount() */
  APP_REQUIRED: 'component:app-required',

  /** Failed to mount component. Target element not found or invalid */
  MOUNT_FAILED: 'component:mount-failed',

  /** Component is already mounted. Create a new instance instead */
  ALREADY_MOUNTED: 'component:already-mounted',

  /** Shadow DOM is not supported in this environment */
  SHADOW_DOM_NOT_SUPPORTED: 'component:shadow-dom-not-supported',

  /** attachShadow() refused the host, such as a <ul> or an <a> */
  SHADOW_DOM_ATTACH_FAILED: 'component:shadow-dom-attach-failed',
} as const;

/** Type for component log messages */
export type ComponentLogMessage =
  (typeof ComponentLogMessages)[keyof typeof ComponentLogMessages];
