/**
 * Global signy Configuration
 *
 * This module provides a singleton global configuration that applies across
 * all signy instances. Useful for global settings like environment, log level,
 * and performance tracking.
 */

import type { GlobalConfigOptions } from '../types';
import { Config } from '../utils/config';

/**
 * Global configuration class for signy
 *
 * Extended for semantic naming and future-proofing.
 */
export class GlobalConfig extends Config<GlobalConfigOptions> {}

/**
 * Global configuration singleton instance
 * Use this to configure global signy settings
 *
 * @example
 * ```typescript
 * import { globalConfig } from 'signy';
 *
 * // Configure specific options
 * globalConfig.configure({
 *   debug: true,
 *   logLevel: 'info',
 *   enablePerformanceTracking: true
 * });
 *
 * // Check if debug is enabled
 * if (globalConfig.getValue('debug')) {
 *   console.log('Debug mode enabled');
 * }
 *
 * // Access all configuration
 * console.log(globalConfig.all);
 * ```
 */
export const globalConfig = new GlobalConfig();
