/**
 * Message Resolver Registry
 *
 * Provides a plug-and-play mechanism for human-readable error messages.
 * By default, returns undefined (production mode).
 * When `signy-dev` is imported, it auto-registers the message resolver.
 *
 * Uses Symbol.for() to work across multiple bundles (CDN scenario).
 *
 * @module log/message-resolver
 *
 * @example
 * ```typescript
 * // Without signy-dev - messages are undefined, just codes shown
 * import { panic } from 'signy/core';
 * panic('app:not-mounted'); // throws "[app:not-mounted]"
 *
 * // With signy-dev - human-readable messages automatically available
 * import 'signy-dev'; // just import anywhere
 * import { panic } from 'signy/core';
 * panic('app:not-mounted'); // throws "[app:not-mounted] Application is not mounted."
 * ```
 */

import type { LogMessage } from './types';

//=============================================
// Types
//=============================================

/**
 * Function signature for message resolvers
 */
export type MessageResolver = (message: LogMessage) => string;

//=============================================
// Global Registry (Symbol-based for cross-bundle support)
//=============================================

/**
 * Global symbol key for the message resolver.
 * Using Symbol.for() ensures same symbol across different bundles.
 */
const MESSAGE_RESOLVER_KEY = Symbol.for('signy:messageResolver');

/**
 * Gets the human-readable message for a log message identifier.
 *
 * Returns undefined if no resolver is registered (production mode).
 * When `signy-dev` is imported, messages become available automatically.
 *
 * @param message - The log message identifier (namespaced string)
 * @returns Human-readable message or undefined
 */
export function getLogMessage(message: LogMessage): string | undefined {
  const resolver = (globalThis as Record<symbol, MessageResolver | undefined>)[
    MESSAGE_RESOLVER_KEY
  ];
  return resolver ? resolver(message) : undefined;
}

/**
 * Registers a message resolver function.
 *
 * This is called automatically when `signy-dev` is imported.
 * Users typically don't need to call this directly.
 *
 * @param resolver - Function that maps codes to messages
 *
 * @internal
 */
export function registerMessageResolver(resolver: MessageResolver): void {
  (globalThis as Record<symbol, MessageResolver>)[MESSAGE_RESOLVER_KEY] =
    resolver;
}

/**
 * Clears the registered message resolver.
 *
 * Useful for testing or switching between dev/prod modes at runtime.
 *
 * @internal
 */
export function clearMessageResolver(): void {
  delete (globalThis as Record<symbol, MessageResolver | undefined>)[
    MESSAGE_RESOLVER_KEY
  ];
}
