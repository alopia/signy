/**
 * Unified Logger for signy
 *
 * Provides a class-based logging system with support for scoped loggers.
 * All logging respects the global log level and format configuration.
 *
 * Log levels (from most to least severe):
 * - error: Always logged
 * - warn: Logged at warn level and above
 * - info: Logged at info level and above
 * - debug: Logged at debug level and above
 * - trace: Most verbose, includes stack traces
 *
 * Supports two output formats:
 * - pretty: Human-readable console output (default)
 * - json: Structured JSON for log aggregation
 *
 * Log message identifiers (strings with ':') are automatically detected
 * and formatted with brackets. In dev mode, human-readable messages
 * are resolved from the message registry.
 *
 * @module log/logger
 *
 * @example
 * ```typescript
 * // Use global logger
 * import { logger } from 'signy';
 * logger.info('Application started');
 * // Output: [signy][INFO] Application started
 *
 * logger.error('app:invalid-state', { reason: 'timeout' });
 * // Output (dev): [signy][ERROR][app:invalid-state] Application is in an invalid state. {reason: 'timeout'}
 * // Output (prod): [signy][ERROR][app:invalid-state] {reason: 'timeout'}
 *
 * // Create scoped logger
 * import { createLogger } from 'signy';
 * const log = createLogger('Router');
 * log.debug('Navigating to /home');
 * // Output: [signy:Router][DEBUG] Navigating to /home
 *
 * // Message with context
 * logger.error('Something failed', { user: 'alice' });
 * // Output: [signy][ERROR] Something failed {user: 'alice'}
 * ```
 */

import { globalConfig } from '../app/global-config';
import {
  LogLevel,
  LogFormat,
  type LogEntry,
  type LogParam,
  mapErrorAndLogParams,
} from './types';
import { withDetails } from './format';

// Re-export for convenience
export { LogLevel, LogFormat };
export type { LogEntry, LogParam };

/**
 * Priority mapping for log levels (lower = more severe)
 */
const LEVEL_PRIORITY: Record<LogLevel, number> = {
  [LogLevel.ERROR]: 0,
  [LogLevel.WARN]: 1,
  [LogLevel.INFO]: 2,
  [LogLevel.DEBUG]: 3,
  [LogLevel.TRACE]: 4,
};

/**
 * Checks if a message should be logged based on current log level
 *
 * @param messageLevel - The level of the message to check
 * @returns True if the message should be logged
 */
export function shouldLog(messageLevel: LogLevel): boolean {
  // Dev builds default to warnings, so mistakes show without configuration
  const configLevel = globalConfig.getValueOr(
    'logLevel',
    __DEV__ ? LogLevel.WARN : LogLevel.ERROR
  ) as LogLevel;
  return LEVEL_PRIORITY[messageLevel] <= LEVEL_PRIORITY[configLevel];
}

/**
 * Logger class for structured logging
 *
 * Provides a complete logging API with support for scoped/namespaced loggers.
 * Can be used directly or extended for custom logging behavior.
 *
 * @example
 * ```typescript
 * // Global logger
 * import { logger } from 'signy';
 * logger.info('App started');
 * // Output: [signy][INFO] App started
 *
 * // Scoped logger
 * const log = new Logger('Router');
 * log.debug('Navigating', { path: '/home' });
 * // Output: [signy:Router][DEBUG] Navigating {path: '/home'}
 *
 * // Child logger
 * const childLog = log.child('Guards');
 * childLog.info('Checking auth');
 * // Output: [signy:Router:Guards][INFO] Checking auth
 *
 * // With message identifier only (dev mode shows resolved message)
 * log.error('router:no-match');
 * // Output (dev): [signy:Router][ERROR][router:no-match] No route matches the given path
 * // Output (prod): [signy:Router][ERROR][router:no-match]
 *
 * // With message identifier and context
 * log.error('router:no-match', { route: '/home' });
 * // Output (dev): [signy:Router][ERROR][router:no-match] No route matches the given path {route: '/home'}
 * ```
 */
export class Logger {
  /**
   * Creates a new logger instance
   *
   * @param scope - Optional scope/namespace for this logger
   */
  constructor(public readonly scope?: string) {}

  //=============================================
  // Public logging methods
  //=============================================

  /**
   * Logs an error message with optional context
   *
   * @param p1 - Message, message identifier, context, or lazy message (optional)
   * @param p2 - Message, context, or lazy message (optional)
   */
  error(p1?: LogParam, p2?: LogParam): void {
    this._log(LogLevel.ERROR, p1, p2);
  }

  /**
   * Logs a warning message with optional context
   *
   * @param p1 - Message, message identifier, context, or lazy message (optional)
   * @param p2 - Message, context, or lazy message (optional)
   */
  warn(p1?: LogParam, p2?: LogParam): void {
    this._log(LogLevel.WARN, p1, p2);
  }

  /**
   * Logs an informational message
   *
   * @param p1 - Message, message identifier, context, or lazy message (optional)
   * @param p2 - Message, context, or lazy message (optional)
   *
   * @example
   * ```typescript
   * // Plain message
   * logger.info('Operation complete');
   * // Output: [signy][INFO] Operation complete
   *
   * // Message with context
   * logger.info('Plugin installed', { plugin: 'router' });
   * // Output: [signy][INFO] Plugin installed {plugin: 'router'}
   *
   * // Context only
   * logger.info({ user: 'alice' });
   * // Output: [signy][INFO] {user: 'alice'}
   *
   * // Message identifier (resolved in dev)
   * logger.info('app:not-mounted');
   * // Output (dev): [signy][INFO][app:not-mounted] Application is not mounted.
   * // Output (prod): [signy][INFO][app:not-mounted]
   *
   * // Message identifier with context
   * logger.info('app:not-mounted', { status: 'created' });
   * // Output (dev): [signy][INFO][app:not-mounted] Application is not mounted. {status: 'created'}
   *
   * // Lazy evaluation for expensive operations
   * logger.info(() => `Processed ${JSON.stringify(data)}`);
   * // Output: [signy][INFO] Processed {"key":"value"}
   * ```
   */
  info(p1?: LogParam, p2?: LogParam): void {
    this._log(LogLevel.INFO, p1, p2);
  }

  /**
   * Logs a debug message
   *
   * @param p1 - Message, message identifier, context, or lazy message (optional)
   * @param p2 - Message, context, or lazy message (optional)
   */
  debug(p1?: LogParam, p2?: LogParam): void {
    this._log(LogLevel.DEBUG, p1, p2);
  }

  /**
   * Logs a trace message (most verbose level)
   *
   * @param p1 - Message, message identifier, context, or lazy message (optional)
   * @param p2 - Message, context, or lazy message (optional)
   */
  trace(p1?: LogParam, p2?: LogParam): void {
    this._log(LogLevel.TRACE, p1, p2);
  }

  /**
   * Creates a child logger with nested scope
   *
   * @param name - Child scope name
   * @returns New logger with combined scope
   *
   * @example
   * ```typescript
   * const routerLog = createLogger('Router');
   * const guardLog = routerLog.child('Guards');
   * // guardLog.scope === 'Router:Guards'
   * ```
   */
  child(name: string): Logger {
    const newScope = this.scope ? `${this.scope}:${name}` : name;
    return new Logger(newScope);
  }

  //=============================================
  // Protected methods (for extending)
  //=============================================

  /**
   * Creates a structured log entry
   *
   * Can be overridden in subclasses for custom entry structure.
   */
  protected createEntry(
    level: LogLevel,
    message: string,
    details?: string,
    context?: Record<string, unknown>
  ): LogEntry {
    return {
      scope: this.scope,
      level,
      message,
      details,
      context,
      timestamp: Date.now(),
    };
  }

  /**
   * Formats console message
   *
   * Can be overridden in subclasses for custom formatting.
   */
  protected formatMessage(entry: LogEntry): string {
    let prefix = '[signy';
    if (entry.scope) {
      prefix += `:${entry.scope}`;
    }
    prefix += `][${entry.level.toUpperCase()}]`;

    const text = withDetails(entry.message, entry.details);
    return text ? `${prefix} ${text}` : prefix;
  }

  /**
   * Outputs a log entry based on current format configuration
   *
   * Can be overridden in subclasses for custom output handling
   * (e.g., sending to external services).
   */
  protected output(entry: LogEntry): void {
    if (
      globalConfig.getValueOr('logFormat', LogFormat.PRETTY) === LogFormat.JSON
    ) {
      console[entry.level](JSON.stringify(entry));
    } else {
      const message = this.formatMessage(entry);
      if (entry.context) {
        console[entry.level](message, entry.context);
      } else {
        console[entry.level](message);
      }
    }
  }

  //=============================================
  // Private methods
  //=============================================

  /**
   * Generic log method handling flexible parameters
   *
   * Detects parameter types automatically:
   * - Strings with ':' are treated as message identifiers
   * - Other strings are treated as plain messages
   * - Objects are treated as context
   * - Functions are lazily evaluated to strings
   *
   * @param level - Log level (required)
   * @param p1 - First parameter: message, message id, context, or lazy message
   * @param p2 - Second parameter: message, context, or lazy message
   *
   * @example
   * ```typescript
   * // No parameters
   * _log(LogLevel.ERROR);
   *
   * // One parameter
   * _log(LogLevel.ERROR, 'app:not-mounted');     // message identifier
   * _log(LogLevel.ERROR, 'Failed to login');     // plain message
   * _log(LogLevel.ERROR, { user: 'alice' });     // context only
   * _log(LogLevel.ERROR, () => 'Lazy message');  // lazy message
   *
   * // Two parameters
   * _log(LogLevel.ERROR, 'app:not-mounted', { user: 'alice' });  // message id + context
   * _log(LogLevel.ERROR, 'Failed', { user: 'alice' });           // message + context
   * _log(LogLevel.ERROR, { user: 'alice' }, 'Failed');           // context + message
   * ```
   */
  private _log(level: LogLevel, p1?: LogParam, p2?: LogParam): void {
    if (!shouldLog(level)) return;

    const { message, details, context } = mapErrorAndLogParams(p1, p2);
    const entry = this.createEntry(level, message, details, context);
    this.output(entry);
  }
}

/**
 * Global logger singleton
 *
 * Use this for general logging without a specific scope.
 *
 * @example
 * ```typescript
 * import { logger } from 'signy';
 *
 * logger.info('Application started');
 * logger.error('app:invalid-state', { reason: 'timeout' });
 * logger.debug('Processing', { items: 42 });
 * ```
 */
export const logger = new Logger();

/**
 * Creates a scoped logger
 *
 * @param scope - Logger scope/namespace
 * @returns New logger instance with the specified scope
 *
 * @example
 * ```typescript
 * const log = createLogger('Router');
 * log.debug('Navigating', { path: '/home' });
 * // Output: [signy:Router][DEBUG] Navigating {path: '/home'}
 *
 * const childLog = log.child('Guards');
 * childLog.info('Checking auth');
 * // Output: [signy:Router:Guards][INFO] Checking auth
 * ```
 */
export function createLogger(scope: string): Logger {
  return new Logger(scope);
}
