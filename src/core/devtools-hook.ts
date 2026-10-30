/**
 * DevTools Global Hook
 *
 * Provides a global hook for browser DevTools extensions to connect to signy.
 * This is similar to how React DevTools and Vue DevTools work.
 *
 * The hook is only created in development mode and exposes a minimal,
 * read-only API for security.
 *
 * @module core/devtools-hook
 *
 * @example
 * ```typescript
 * // In signy-dev or browser extension:
 * const hook = getDevToolsHook();
 * if (hook) {
 *   hook.on('app:mount', (app) => {
 *     console.log('App mounted:', app.id);
 *   });
 * }
 * ```
 */

import type { ApplicationLike } from './feature-types';
import { features } from './features';
import { logger } from '../log';
import { FeatureLogMessages } from './log-messages';
import { VERSION } from '../constants';

//=============================================
// Types
//=============================================

/**
 * Handler for DevTools hook events
 */
export type DevToolsEventHandler = (...args: unknown[]) => void;

/**
 * DevTools hook events
 */
export interface DevToolsEvents {
  'app:mount': (app: ApplicationLike) => void;
  'app:unmount': (app: ApplicationLike) => void;
  'feature:install': (featureId: string, featureName: string) => void;
  'feature:uninstall': (featureId: string) => void;
}

/**
 * Public interface exposed to browser extensions.
 * Intentionally minimal and mostly read-only for security.
 */
export interface DevToolsHook {
  /**
   * signy version
   */
  readonly version: string;

  /**
   * List of mounted applications
   */
  readonly apps: readonly ApplicationLike[];

  /**
   * List of installed feature IDs
   */
  readonly installedFeatures: readonly string[];

  /**
   * Whether a browser extension is connected
   */
  isConnected: boolean;

  /**
   * Register an event handler
   * @param event - Event name
   * @param handler - Handler function
   * @returns Cleanup function
   */
  on<K extends keyof DevToolsEvents>(
    event: K,
    handler: DevToolsEvents[K]
  ): () => void;

  /**
   * Emit an event to registered handlers
   * @internal Called by Signy internals
   */
  emit<K extends keyof DevToolsEvents>(
    event: K,
    ...args: Parameters<DevToolsEvents[K]>
  ): void;
}

//=============================================
// Global Hook Key
//=============================================

/**
 * Global key for the DevTools hook.
 * Using a string key (not Symbol) so browser extensions can access it.
 */
const DEVTOOLS_HOOK_KEY = '__SIGNY_DEVTOOLS_HOOK__';

//=============================================
// Hook Implementation
//=============================================

/**
 * Creates the DevTools hook implementation.
 */
function createDevToolsHook(): DevToolsHook {
  const apps: ApplicationLike[] = [];
  const listeners = new Map<string, Set<DevToolsEventHandler>>();

  return {
    version: VERSION,

    get apps(): readonly ApplicationLike[] {
      // Return a copy for security
      return [...apps];
    },

    get installedFeatures(): readonly string[] {
      return features.installed.filter((id) => id !== BRIDGE_ID);
    },

    isConnected: false,

    on<K extends keyof DevToolsEvents>(
      event: K,
      handler: DevToolsEvents[K]
    ): () => void {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(handler as DevToolsEventHandler);

      return () => {
        listeners.get(event)?.delete(handler as DevToolsEventHandler);
      };
    },

    emit<K extends keyof DevToolsEvents>(
      event: K,
      ...args: Parameters<DevToolsEvents[K]>
    ): void {
      const handlers = listeners.get(event);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(...args);
          } catch {
            // Ignore errors from extension handlers
          }
        }
      }

      // Special handling for app events - maintain apps array
      if (event === 'app:mount') {
        apps.push(args[0] as ApplicationLike);
      } else if (event === 'app:unmount') {
        const app = args[0] as ApplicationLike;
        const idx = apps.findIndex((a) => a.id === app.id);
        if (idx !== -1) apps.splice(idx, 1);
      }
    },
  };
}

//=============================================
// Bridge from the framework to the hook
//=============================================

/** Id of the internal feature that forwards framework events to the hook. */
const BRIDGE_ID = 'signy:devtools-hook';

let disconnectBridge: (() => void) | null = null;

/**
 * Forwards app mounts and feature changes from this copy of Signy to the hook,
 * which an extension listens to. Without it the hook never saw an app.
 */
function connectBridge(hook: DevToolsHook): void {
  if (disconnectBridge) return;

  const stopObserving = features.observe({
    installed: (id, name) => {
      if (id !== BRIDGE_ID) hook.emit('feature:install', id, name);
    },
    uninstalled: (id) => {
      if (id !== BRIDGE_ID) hook.emit('feature:uninstall', id);
    },
  });

  const uninstall = features.install({
    id: BRIDGE_ID,
    name: 'DevTools hook',
    install: (ctx) => {
      ctx.onApp({
        onMount: (app) => hook.emit('app:mount', app),
        onUnmount: (app) => hook.emit('app:unmount', app),
      });
    },
  });

  disconnectBridge = () => {
    stopObserving();
    uninstall();
    disconnectBridge = null;
  };
}

//=============================================
// Singleton Management
//=============================================

let hookInstance: DevToolsHook | null = null;

/**
 * Whether a global value is a hook, not something else under its name: an
 * element with that id makes the name a global too (DOM clobbering).
 */
function isDevToolsHook(value: unknown): value is DevToolsHook {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as DevToolsHook).on === 'function' &&
    typeof (value as DevToolsHook).emit === 'function'
  );
}

/**
 * Gets the global DevTools hook, creating it if necessary.
 *
 * Returns null in non-browser environments or if the hook
 * hasn't been initialized.
 *
 * @returns The DevTools hook or null
 */
export function getDevToolsHook(): DevToolsHook | null {
  // Check if we're in a browser environment
  if (typeof globalThis === 'undefined') {
    return null;
  }

  // Return cached instance
  if (hookInstance) {
    return hookInstance;
  }

  // Check if hook already exists (from another bundle)
  const existing = (globalThis as Record<string, unknown>)[DEVTOOLS_HOOK_KEY];
  if (isDevToolsHook(existing)) {
    hookInstance = existing;
    return hookInstance;
  }

  return null;
}

/**
 * Initializes the DevTools hook.
 *
 * This should be called by signy-dev when dev tools are enabled.
 * It creates the global hook and makes it accessible to browser extensions.
 *
 * @returns The DevTools hook
 */
export function initDevToolsHook(): DevToolsHook {
  // Check if we're in a browser environment
  if (typeof globalThis === 'undefined') {
    // Return a no-op hook for SSR/Node
    return createDevToolsHook();
  }

  // Check if hook already exists
  const existing = (globalThis as Record<string, unknown>)[DEVTOOLS_HOOK_KEY];
  if (isDevToolsHook(existing)) {
    hookInstance = existing;
    connectBridge(hookInstance);
    return hookInstance;
  }

  // Create new hook
  hookInstance = createDevToolsHook();
  (globalThis as Record<string, unknown>)[DEVTOOLS_HOOK_KEY] = hookInstance;
  connectBridge(hookInstance);

  logger.debug(FeatureLogMessages.DEVTOOLS_INIT);

  return hookInstance;
}

/**
 * Destroys the DevTools hook.
 *
 * Used for testing and cleanup.
 *
 * @internal
 */
export function destroyDevToolsHook(): void {
  disconnectBridge?.();
  if (typeof globalThis !== 'undefined') {
    delete (globalThis as Record<string, unknown>)[DEVTOOLS_HOOK_KEY];
  }
  hookInstance = null;
}
