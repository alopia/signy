/**
 * Installable/Plugin log messages
 *
 * Log message identifiers for the installable registry module.
 *
 * @module app/installable-log-messages
 */

/**
 * Installable log messages object with namespaced string identifiers.
 *
 * @example
 * ```typescript
 * import { InstallableLogMessages } from './installable-log-messages';
 * logger.error(InstallableLogMessages.INVALID);
 * ```
 */
export const InstallableLogMessages = {
  /** Invalid installable. Must have an install() method */
  INVALID: 'installable:invalid',

  /** Failed to install plugin or module */
  INSTALL_FAILED: 'installable:install-failed',

  /** Plugin or module is already installed */
  ALREADY_INSTALLED: 'installable:already-installed',

  /** The cleanup an install returned threw. The other cleanups still run */
  UNINSTALL_FAILED: 'installable:uninstall-failed',
} as const;

/** Type for installable log messages */
export type InstallableLogMessage =
  (typeof InstallableLogMessages)[keyof typeof InstallableLogMessages];
