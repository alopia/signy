/**
 * Reactivity log messages
 *
 * Log message identifiers for the reactivity module.
 *
 * @module reactivity/log-messages
 */

/**
 * Reactivity log messages object with namespaced string identifiers.
 *
 * @example
 * ```typescript
 * import { ReactiveLogMessages } from './log-messages';
 * logger.error(ReactiveLogMessages.SIGNAL_DISPOSED);
 * ```
 */
export const ReactiveLogMessages = {
  /** Effect flush exceeded maximum iterations (infinite loop) */
  EFFECT_FLUSH_EXCEEDED: 'reactivity:effect-flush-exceeded',

  /** Effect created outside a reactive root. Effect will never be disposed */
  EFFECT_UNOWNED: 'reactivity:effect-unowned',

  /** onCleanup called outside a reactive root. Cleanup will never run */
  CLEANUP_UNOWNED: 'reactivity:cleanup-unowned',

  /** Cannot access disposed store */
  STORE_DISPOSED: 'reactivity:store-disposed',

  /** A store write path or key would reach Object.prototype */
  STORE_UNSAFE_KEY: 'reactivity:store-unsafe-key',

  /** Cannot access disposed signal */
  SIGNAL_DISPOSED: 'reactivity:signal-disposed',

  /** An effect threw. The other effects in the flush still run */
  EFFECT_ERROR: 'reactivity:effect-error',

  /** Error occurred during cleanup function execution */
  CLEANUP_ERROR: 'reactivity:cleanup-error',

  /** mapByItem() got the same item, or key, twice. Both share one row */
  MAP_DUPLICATE_KEY: 'reactivity:map-duplicate-key',
} as const;

/** Type for reactivity log messages */
export type ReactiveLogMessage =
  (typeof ReactiveLogMessages)[keyof typeof ReactiveLogMessages];
