/**
 * Common types used across the library
 */

//=============================================
// Common Types
//=============================================

export type Nullable<T> = T | null;

export type Optional<T> = T | undefined;

export type ElementOrSelector = Element | string;

export interface Dictionary<T = unknown> {
  [key: string]: T;
}

export type Listener<T = unknown> = (data: T) => void;

export type Unsubscribe = () => void;

/**
 * Application configuration options
 */
export interface AppConfigOptions {
  /** Custom global properties */
  [key: string]: unknown;
}

/**
 * Log levels for controlling output verbosity
 * Re-exported from log module for type usage
 */
import type { LogLevel, LogFormat } from '../log/types';
export type { LogLevel, LogFormat };

/**
 * Global signy configuration options
 * These settings apply across all signy instances
 */
export interface GlobalConfigOptions {
  /** Global log level */
  logLevel?: LogLevel;

  /** Log output format (pretty or JSON) */
  logFormat?: LogFormat;

  /** Environment */
  environment?: 'dev' | 'qa' | 'stage' | 'prod' | (string & {});

  /** Enable performance tracking */
  enablePerformanceTracking?: boolean;

  /** Custom global properties */
  [key: string]: unknown;
}
