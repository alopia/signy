/**
 * Error handling utilities for signy
 *
 * Provides custom error class and error creation/throwing functions
 * with message identifiers for better debugging and production error tracking.
 *
 * Message identifiers (strings with ':') are automatically detected and
 * resolved to human-readable messages in development mode.
 *
 * @module log/error
 *
 * @example
 * ```typescript
 * // Message identifier (resolved in dev mode)
 * panic('app:not-mounted');
 * // Error: [app:not-mounted] Application is not mounted.
 *
 * // Plain message
 * panic('Something failed');
 * // Error: Something failed
 *
 * // Message identifier with context
 * panic('router:no-match', { path: '/unknown' });
 * // Error: [router:no-match] No route matches the given path
 *
 * // Plain message with context
 * panic('Failed to load', { user: 'alice' });
 * // Error: Failed to load
 * ```
 */

import { mapErrorAndLogParams, type LogParam } from './types';
import { withDetails } from './format';

/**
 * Base signy error class
 *
 * Supports flexible parameter ordering - message/message id and context
 * can be provided in any order.
 *
 * @example
 * ```typescript
 * // Message identifier
 * new SignyError('app:not-mounted');
 *
 * // Plain message
 * new SignyError('Something failed');
 *
 * // Message identifier with context
 * new SignyError('router:no-match', { path: '/unknown' });
 *
 * // Plain message with context
 * new SignyError('Failed', { user: 'alice' });
 *
 * // Context with message
 * new SignyError({ message: 'Failed', user: 'alice' });
 * ```
 */
export class SignyError extends Error {
  /**
   * Creates a new signy error
   *
   * @param p1 - Message, message identifier, or context
   * @param p2 - Message or context
   */
  constructor(p1?: LogParam, p2?: LogParam) {
    const { message, details, context } = mapErrorAndLogParams(p1, p2);

    super(
      withDetails(message, details),
      context ? { cause: context } : undefined
    );
    this.name = 'SignyError';

    // Maintains proper stack trace for where our error was thrown
    // use V8's slightly cleaner stack traces that skip the constructor frame
    const V8Error = Error as {
      captureStackTrace?: (target: object, constructor: Function) => void;
    };
    if (typeof V8Error.captureStackTrace === 'function') {
      V8Error.captureStackTrace(this, SignyError);
    }
  }
}

/**
 * Creates and throws an error
 *
 * Use this function when a fatal error occurs that should halt execution.
 * Named after Rust's panic!() for clear intent.
 *
 * @param p1 - Message, message identifier, or context
 * @param p2 - Message or context
 * @throws {SignyError} Always throws
 *
 * @example
 * ```typescript
 * // Message identifier (resolved in dev)
 * panic('app:not-mounted');
 *
 * // Plain message
 * panic('Something failed');
 *
 * // Message identifier with context
 * panic('router:no-match', { path: '/unknown' });
 *
 * // Plain message with context
 * panic('Failed', { user: 'alice' });
 * ```
 */
export function panic(p1?: LogParam, p2?: LogParam): never {
  throw new SignyError(p1, p2);
}

/**
 * Asserts a condition, throws error if false
 *
 * TypeScript assertion function that narrows types when condition is true.
 *
 * @param condition - Condition to assert
 * @param p1 - Message, message identifier, or context
 * @param p2 - Message, message identifier, or context
 * @throws {SignyError} If condition is false
 *
 * @example
 * ```typescript
 * // With message identifier
 * assert(value !== null, 'core:defensive-check-failed');
 *
 * // With plain message
 * assert(value !== null, 'Value required');
 *
 * // With context
 * assert(tagName !== null, 'component:mount-failed', { tagName });
 * ```
 */
export function assert(
  condition: boolean,
  p1?: LogParam,
  p2?: LogParam
): asserts condition {
  if (!condition) {
    throw new SignyError(p1, p2);
  }
}

/**
 * Creates an error without throwing it
 *
 * Useful when you need to return an error instead of throwing it,
 * or when working with error boundaries.
 *
 * @param p1 - Message, message identifier, or context
 * @param p2 - Message or context
 * @returns SignyError instance
 *
 * @example
 * ```typescript
 * const err = createError('component:mount-failed');
 * const err = createError('Mount failed');
 * const err = createError('router:no-match', { path: '/unknown' });
 * ```
 */
export function createError(p1?: LogParam, p2?: LogParam): SignyError {
  return new SignyError(p1, p2);
}
