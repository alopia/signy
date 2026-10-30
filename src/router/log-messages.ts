/**
 * Router log messages
 *
 * Log message identifiers for the router module.
 *
 * @module router/log-messages
 */

/**
 * Router log messages object with namespaced string identifiers.
 *
 * @example
 * ```typescript
 * import { RouterLogMessages } from './log-messages';
 * logger.error(RouterLogMessages.NO_MATCH);
 * ```
 */
export const RouterLogMessages = {
  /** No route matches the given path */
  NO_MATCH: 'router:no-match',

  /** Route data loader failed to load data */
  LOADER_FAILED: 'router:loader-failed',

  /** Router not installed. Use app.use(router) before mounting */
  NOT_INSTALLED: 'router:not-installed',

  /** Named route not found */
  ROUTE_NOT_FOUND: 'router:route-not-found',

  /** An error occurred during navigation */
  NAVIGATION_ERROR: 'router:navigation-error',

  /** Redirects kept redirecting, past the redirect limit */
  REDIRECT_LOOP: 'router:redirect-loop',

  /** push() or replace() was given a URL with a scheme or a host */
  EXTERNAL_PATH: 'router:external-path',
} as const;

/** Type for router log messages */
export type RouterLogMessage =
  (typeof RouterLogMessages)[keyof typeof RouterLogMessages];
