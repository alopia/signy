/**
 * View log messages
 *
 * Log message identifiers for the views module.
 *
 * @module views/log-messages
 */

/**
 * View log messages object with namespaced string identifiers.
 *
 * @example
 * ```typescript
 * import { ViewLogMessages } from './log-messages';
 * logger.error(ViewLogMessages.LAZY_NO_DEFAULT_EXPORT);
 * ```
 */
export const ViewLogMessages = {
  /** Lazy-loaded module has no default export */
  LAZY_NO_DEFAULT_EXPORT: 'view:lazy-no-default-export',

  /** Lazy component rendered outside Suspense boundary */
  LAZY_OUTSIDE_SUSPENSE: 'view:lazy-outside-suspense',

  /** A binding tried to set an `on*` attribute from a string or a javascript: URL */
  UNSAFE_ATTRIBUTE: 'view:unsafe-attribute',

  /** `use:name` got something that is neither a function nor `[function, argument]` */
  INVALID_DIRECTIVE: 'view:invalid-directive',

  /** `bind:` got a property other than value or checked, or a target without a `value` */
  INVALID_BINDING: 'view:invalid-binding',

  /** `Dynamic` resolved its component to something that is not a tag name or a function */
  INVALID_DYNAMIC: 'view:invalid-dynamic',

  /** The key of a For list returned the same key for two items */
  DUPLICATE_KEY: 'view:duplicate-key',
} as const;

/** Type for view log messages */
export type ViewLogMessage =
  (typeof ViewLogMessages)[keyof typeof ViewLogMessages];
