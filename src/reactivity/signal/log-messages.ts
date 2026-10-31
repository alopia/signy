/**
 * Signal Log Messages
 *
 * Centralized log message constants for the Signal module.
 * Ensures consistent error/warning messages across the codebase.
 *
 * @module reactivity/signal/log-messages
 *
 * @example
 * ```typescript
 * import { SignalLogMessages } from './log-messages';
 * import { panic } from '../../log';
 *
 * panic(SignalLogMessages.SIGNAL_DISPOSED, 'Additional context here');
 * ```
 *
 * ## Known limitations
 *
 * None.
 */

/**
 * Log message constants for the signal module.
 * All messages should be defined here for consistency and easy maintenance.
 */
export const SignalLogMessages = {
  /**
   * Error when trying to read or write a disposed signal
   */
  SIGNAL_DISPOSED: 'Signal has been disposed',

  /**
   * Error when trying to read or write a disposed computed
   */
  COMPUTED_DISPOSED: 'Computed has been disposed',

  /**
   * Error when a circular dependency is detected in computed values
   */
  COMPUTED_CIRCULAR: 'Circular dependency detected in computed',

  /**
   * Error when flushAll() keeps finding new work, usually an effect or binding
   * that writes a signal it reads
   */
  FLUSH_EXCEEDED: 'flushAll() did not settle, work keeps scheduling more work',
} as const;
