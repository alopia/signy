/**
 * Core log messages
 *
 * Generic/core log message identifiers used across the signy library.
 *
 * @module core/log-messages
 */

/**
 * Core log messages object with namespaced string identifiers.
 *
 * @example
 * ```typescript
 * import { CoreLogMessages } from '../core/log-messages';
 * logger.error(CoreLogMessages.DEFENSIVE_CHECK_FAILED);
 * ```
 */
export const CoreLogMessages = {
  /** Defensive check failed: an unexpected internal state was detected */
  DEFENSIVE_CHECK_FAILED: 'core:defensive-check-failed',
} as const;

/** Type for core log messages */
export type CoreLogMessage =
  (typeof CoreLogMessages)[keyof typeof CoreLogMessages];

//=============================================
// Feature Registry Log Messages
//=============================================

/**
 * Feature registry log messages.
 */
export const FeatureLogMessages = {
  /** Feature was successfully installed */
  INSTALLED: 'feature:installed',

  /** Feature was successfully uninstalled */
  UNINSTALLED: 'feature:uninstalled',

  /** Attempted to install a feature that is already installed */
  ALREADY_INSTALLED: 'feature:already-installed',

  /** Error occurred during feature uninstall hook */
  UNINSTALL_ERROR: 'feature:uninstall-error',

  /** Error occurred during handler cleanup */
  CLEANUP_ERROR: 'feature:cleanup-error',

  /** A feature's event handler threw. The app goes on */
  HANDLER_ERROR: 'feature:handler-error',

  /** DevTools hook was initialized */
  DEVTOOLS_INIT: 'feature:devtools-init',
} as const;

/** Type for feature log messages */
export type FeatureLogMessage =
  (typeof FeatureLogMessages)[keyof typeof FeatureLogMessages];
