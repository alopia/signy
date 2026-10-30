/**
 * Application Configuration
 */

import type { AppConfigOptions } from '../types';
import { Config } from '../utils/config';

/**
 * Class for managing application configuration.
 * Each signy app instance has its own AppConfig.
 *
 * Extended for semantic naming and future-proofing.
 */
export class AppConfig extends Config<AppConfigOptions> {}
