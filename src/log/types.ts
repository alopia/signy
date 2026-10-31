/**
 * Logging types, levels, and shared utilities
 *
 * Provides log level enums, format options, and common utility functions
 * used across the logging system.
 *
 * The levels are strings. A priority map in the logger orders them: a more
 * severe level is always logged, a more verbose one is filtered by config.
 *
 * @module log/types
 */

import { getLogMessage } from './message-resolver';

//=============================================
// Log Messages
//=============================================

/**
 * Log message type - namespaced string identifier for log messages.
 *
 * Format: `{namespace}:{kebab-case-name}`
 *
 * Namespaces correspond to source directories:
 * - `core:` - Core/generic messages
 * - `app:` - Application messages
 * - `component:` - Component messages
 * - `router:` - Router messages
 * - `reactivity:` - Reactivity messages
 * - `view:` - View messages
 * - `dom:` - DOM messages
 *
 * @example
 * ```typescript
 * const msg: LogMessage = 'router:no-match';
 * const msg: LogMessage = 'reactivity:signal-disposed';
 * ```
 */
export type LogMessage = string;

/**
 * Lazy message type - either a string or a function that returns a string.
 * Functions are only evaluated if the log level is enabled.
 */
export type LazyMessage = string | (() => string);

/**
 * Flexible log parameter type - supports messages, context, and lazy messages.
 *
 * Log message identifiers are strings containing ':' like 'router:no-match'.
 * Plain messages are strings without a namespace separator.
 */
export type LogParam = string | Record<string, unknown> | LazyMessage;

/**
 * Resolves a lazy message to a string
 */
export function resolveLazyMessage(msg: LazyMessage): string {
  return typeof msg === 'function' ? msg() : msg;
}

//=============================================
// Log Levels and Formats
//=============================================

export const enum LogLevel {
  /** Always log - unrecoverable or critical issues */
  ERROR = 'error',
  /** Warnings and above - potential issues */
  WARN = 'warn',
  /** Info and above - general information */
  INFO = 'info',
  /** Everything - detailed debugging */
  DEBUG = 'debug',
  /** Most verbose - stack traces and detailed flow */
  TRACE = 'trace',
}

/**
 * Log output format
 */
export const enum LogFormat {
  /** Human-readable formatted output (default) */
  PRETTY = 0,
  /** JSON structured output for log aggregation */
  JSON = 1,
}

/**
 * Structured log entry for handlers and JSON output
 */
export interface LogEntry {
  /** Log scope/namespace */
  scope?: string;
  /** Log level */
  level: LogLevel;
  /** Log message (may include message identifier like 'app:not-mounted') */
  message: string;
  /** Additional details */
  details?: string;
  /** Additional context */
  context?: Record<string, unknown>;
  /** Unix timestamp in milliseconds */
  timestamp: number;
}

//=============================================
// Utility Functions
//=============================================

/**
 * Map parameters for error constructor and logging functions
 */
export function mapErrorAndLogParams(
  param1?: LogParam,
  param2?: LogParam
): { message: string; details?: string; context?: Record<string, unknown> } {
  let message: string = '';
  let context: Record<string, unknown> | undefined;

  const isParam1String =
    typeof param1 === 'string' || typeof param1 === 'function';
  const isParam2String =
    typeof param2 === 'string' || typeof param2 === 'function';

  if (isParam1String && !isParam2String) {
    // param1 is message, param2 is context
    message = resolveLazyMessage(param1 as LazyMessage);
    context = param2 as Record<string, unknown> | undefined;
  } else if (!isParam1String && isParam2String) {
    // param1 is context, param2 is message
    context = param1 as Record<string, unknown> | undefined;
    message = resolveLazyMessage(param2 as LazyMessage);
  } else if (isParam1String && isParam2String) {
    // both are messages - prefer param2
    message = resolveLazyMessage(param2 as LazyMessage);
  } else if (!isParam1String && !isParam2String) {
    // both are context - prefer param2
    context = param2 as Record<string, unknown> | undefined;
  }

  const details = getLogMessage(message);

  return { message, details, context };
}

/**
 * Resolves context and message from flexible parameter order
 *
 * Allows functions to accept context and message in any order by detecting
 * which parameter is which based on type.
 *
 * @param first - Either a context object or message string
 * @param second - Either a message string or context object
 * @returns Tuple of [context, message] in standardized order
 *
 * @example
 * ```typescript
 * // Both calls produce the same result:
 * resolveContextAndMessage({ id: 1 }, 'Error message');
 * // => [{ id: 1 }, 'Error message']
 *
 * resolveContextAndMessage('Error message', { id: 1 });
 * // => [{ id: 1 }, 'Error message']
 * ```
 */
export function resolveContextAndMessage(
  first?: Record<string, unknown> | string,
  second?: string | Record<string, unknown>
): [Record<string, unknown> | undefined, string | undefined] {
  if (typeof first === 'string') {
    return [second as Record<string, unknown> | undefined, first];
  }
  return [first, second as string | undefined];
}
