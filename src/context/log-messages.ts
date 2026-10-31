/**
 * Context log messages
 *
 * Log message identifiers for the context module.
 *
 * @module context/log-messages
 */

/**
 * Context log messages object with namespaced string identifiers.
 *
 * @example
 * ```typescript
 * import { ContextLogMessages } from './log-messages';
 * logger.error(ContextLogMessages.INVALID_PROVIDER, { contextName });
 * ```
 */
export const ContextLogMessages = {
  /** provide() was called on something that is not a Component */
  INVALID_PROVIDER: 'context:invalid-provider',

  /** inject() was called on something that is not a Component */
  INVALID_CONSUMER: 'context:invalid-consumer',
} as const;

/** Type for context log messages */
export type ContextLogMessage =
  (typeof ContextLogMessages)[keyof typeof ContextLogMessages];
