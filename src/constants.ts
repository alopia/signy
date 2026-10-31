/**
 * Global constants
 *
 * @module constants
 */

/**
 * Framework version
 */
export const VERSION = __VERSION__;

export const ENV = {
  DEV: 'development',
  PROD: 'production',
  TEST: 'test',
} as const;

export const EVENTS = {
  MOUNT: 'mount',
  UPDATE: 'update',
  UNMOUNT: 'unmount',
  NAVIGATE: 'navigate',
} as const;

//=============================================
// Environment Detection
//=============================================

/**
 * Whether the code is running on the server (Node.js / Deno / Bun).
 * True when `window` is not defined.
 *
 * Use this to conditionally execute server-only or client-only code.
 *
 * @example
 * ```typescript
 * import { isServer } from 'signy';
 *
 * if (isServer) {
 *   // Server-only code (e.g., file system access)
 *   console.log('Running on server');
 * }
 * ```
 */
export const isServer: boolean = typeof window === 'undefined';

/**
 * Whether the code is running in the browser.
 * True when `window` is defined.
 *
 * Use this to conditionally execute browser-only code.
 *
 * @example
 * ```typescript
 * import { isClient } from 'signy';
 *
 * if (isClient) {
 *   // Browser-only code (e.g., DOM manipulation, localStorage)
 *   document.title = 'My App';
 * }
 * ```
 */
export const isClient: boolean = !isServer;

/** NODE_ENV when running under Node or a bundler that defines it */
function nodeEnv(): string | undefined {
  return (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env?.['NODE_ENV'];
}

/**
 * Whether the code is running in a development environment.
 * Checks `process.env.NODE_ENV` if available.
 *
 * @example
 * ```typescript
 * import { isDev } from 'signy';
 *
 * if (isDev) {
 *   console.log('Development mode - extra logging enabled');
 * }
 * ```
 */
export const isDev: boolean = (() => {
  try {
    return nodeEnv() === 'development';
  } catch {
    return false;
  }
})();

/**
 * Whether the code is running in a production environment.
 *
 * @example
 * ```typescript
 * import { isProd } from 'signy';
 *
 * if (isProd) {
 *   // Enable production optimizations
 * }
 * ```
 */
export const isProd: boolean = (() => {
  try {
    return nodeEnv() === 'production';
  } catch {
    return false;
  }
})();

//=============================================
// Comment Markers
//=============================================

/**
 * Comment marker names for control flow and reactive boundaries.
 * These identify different types of reactive insertion points in the DOM.
 * @internal
 */
export const Markers = {
  /** Show component marker */
  SHOW: 'show',
  /** For component start marker */
  FOR_START: 'for:start',
  /** For component end marker */
  FOR_END: 'for:end',
  /** Switch component marker */
  SWITCH: 'switch',
  /** Match component marker */
  MATCH: 'match',
  /** Index component start marker */
  INDEX_START: 'index:start',
  /** Index component end marker */
  INDEX_END: 'index:end',
  /** Portal component marker */
  PORTAL: 'portal',
  /** Dynamic component marker */
  DYNAMIC: 'dynamic',
  /** Closes what a component added to a container, after a last marker */
  COMPONENT_END: 'component:end',
  /** ErrorBoundary component marker */
  ERROR_BOUNDARY: 'error-boundary',
  /** Suspense component start marker */
  SUSPENSE_START: 'suspense:start',
  /** Suspense component end marker */
  SUSPENSE_END: 'suspense:end',
  /** Lazy component loading placeholder */
  LAZY_LOADING: 'lazy:loading',
  /** End of a list row made of several nodes */
  ROW_END: 'row:end',
  /** End of a control flow branch made of several nodes */
  BRANCH_END: 'branch:end',
} as const;

//=============================================
// Lazy Loading States
//=============================================

/**
 * States for lazy-loaded components.
 * @internal
 */
export const LazyStates = {
  /** Component not yet requested */
  IDLE: 'idle',
  /** Component is loading */
  LOADING: 'loading',
  /** Component loaded successfully */
  READY: 'ready',
  /** Component failed to load */
  ERROR: 'error',
} as const;

/** Type for lazy component states */
export type LazyState = (typeof LazyStates)[keyof typeof LazyStates];

//=============================================
// Data Attributes
//=============================================

/**
 * Data attribute for shadow DOM host elements.
 * Applied to container elements that host a shadow root.
 * @internal
 */
export const DATA_ATTR_SHADOW = 'data-signy-shadow';

/**
 * Data attribute on head tags that useHead() created, so they can be told
 * from tags that were in the page.
 * @internal
 */
export const DATA_ATTR_HEAD = 'data-signy-head';
