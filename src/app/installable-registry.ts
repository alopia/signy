/**
 * Installable Registry - Plugin/Extension Management
 *
 * Provides a class-based registry for tracking and installing plugins, middleware,
 * or any installable items into a context (Application, Router, etc.).
 *
 * @module app/installable-registry
 * @internal This module is for internal use only. Do not import directly from application code.
 *
 * @example
 * ```typescript
 * // Internal usage within Signy modules only
 * import { InstallableRegistry } from './installable-registry';
 *
 * // Create a registry for your context
 * const registry = new InstallableRegistry<Application>();
 *
 * // Install a plugin
 * registry.install(myPlugin, app, { options: { debug: true } });
 *
 * // Check if installed
 * if (registry.has(myPlugin)) {
 *   console.log('Plugin is installed');
 * }
 * ```
 *
 * ## Known limitations
 *
 * None.
 */

import { panic, logger, SignyError } from '../log';
import { InstallableLogMessages } from './installable-log-messages';

//=============================================
// Types
//=============================================

/**
 * What an install returns: nothing, or a cleanup that undoes it.
 */
export type InstallResult = void | (() => void);

/**
 * Installable function type - a function that receives context and options.
 * It may return a cleanup, run when the item is uninstalled.
 *
 * @template TContext - The context type (e.g., Application, Router)
 * @template TOptions - Installation options type
 */
export type InstallableFunction<TContext = unknown, TOptions = unknown> = (
  context: TContext,
  options?: TOptions
) => InstallResult;

/**
 * Installable object type - an object with an install method.
 *
 * @template TContext - The context type (e.g., Application, Router)
 * @template TOptions - Installation options type
 */
export interface InstallableObject<TContext = unknown, TOptions = unknown> {
  /**
   * Install method called when item is registered. It may return a cleanup,
   * run when the item is uninstalled.
   */
  install: (context: TContext, options?: TOptions) => InstallResult;

  /**
   * Optional name for debugging and error messages.
   */
  name?: string;
}

/**
 * Installable item - either a function or object with install method.
 *
 * @template TContext - The context type (e.g., Application, Router)
 * @template TOptions - Installation options type
 */
export type Installable<TContext = unknown, TOptions = unknown> =
  | InstallableFunction<TContext, TOptions>
  | InstallableObject<TContext, TOptions>;

/**
 * Options for installing an item.
 *
 * @template TOptions - Item-specific options type
 */
export interface InstallationOptions<TOptions = unknown> {
  /**
   * Force reinstallation even if already installed.
   * Use this to reconfigure an item with different options.
   */
  force?: boolean;

  /**
   * Item-specific options passed to the install function.
   */
  options?: TOptions;
}

//=============================================
// InstallableRegistry Class
//=============================================

/**
 * Registry for tracking and installing plugins/extensions.
 *
 * Manages the lifecycle of installable items with:
 * - Duplicate prevention (with optional force reinstall)
 * - User-friendly error messages, with the plugin's error as `cause`
 *
 * @template TContext - The context type items are installed into
 *
 * @example
 * ```typescript
 * class Application {
 *   private plugins = new InstallableRegistry<Application>();
 *
 *   use(plugin: Installable<Application>, options?: InstallationOptions): this {
 *     this.plugins.install(plugin, this, options);
 *     return this;
 *   }
 * }
 *
 * // Usage
 * app.use(myPlugin);
 * app.use(myPlugin); // Skipped with warning
 * app.use(myPlugin, { force: true }); // Reinstalls
 * ```
 */
export class InstallableRegistry<TContext = unknown> {
  //=============================================
  // Private Properties
  //=============================================

  /** Installed items and the cleanup each install returned */
  private readonly _installed = new Map<
    Installable<TContext, never>,
    (() => void) | undefined
  >();

  //=============================================
  // Public Getters
  //=============================================

  /**
   * Number of installed items.
   */
  get size(): number {
    return this._installed.size;
  }

  //=============================================
  // Public Methods
  //=============================================

  /**
   * Checks if an item is already installed.
   *
   * @param item - Item to check
   * @returns True if the item is installed
   *
   * @example
   * ```typescript
   * if (registry.has(myPlugin)) {
   *   console.log('Already installed');
   * }
   * ```
   */
  has(item: Installable<TContext, never>): boolean {
    return this._installed.has(item);
  }

  /**
   * Installs an item into the context.
   *
   * @template TOptions - Item-specific options type
   * @param item - Item to install (function or object with install method)
   * @param context - Context instance to install into
   * @param options - Installation options
   * @throws If item is invalid or installation fails. The error of a failed
   *   installation has the plugin's error as `cause`
   *
   * @example
   * ```typescript
   * // Simple install
   * registry.install(myPlugin, app);
   *
   * // With options
   * registry.install(myPlugin, app, { options: { debug: true } });
   *
   * // Force reinstall
   * registry.install(myPlugin, app, { force: true });
   * ```
   */
  install<TOptions = unknown>(
    item: Installable<TContext, TOptions>,
    context: TContext,
    options?: InstallationOptions<TOptions>
  ): void {
    // Validate item
    this._validate(item);

    const wasInstalled = this.has(item);

    // Prevent duplicate installation unless forced
    if (wasInstalled && options?.force !== true) {
      logger.warn(InstallableLogMessages.ALREADY_INSTALLED, {
        itemName: this._getName(item),
      });
      return;
    }

    // A forced reinstall undoes the previous install first
    if (wasInstalled) this._runCleanup(item);
    this._installed.set(item, undefined);

    try {
      const cleanup = this._execute(item, context, options?.options);
      if (typeof cleanup === 'function') this._installed.set(item, cleanup);
    } catch (cause) {
      if (!wasInstalled) this._installed.delete(item);
      const error = new SignyError(InstallableLogMessages.INSTALL_FAILED, {
        itemName: this._getName(item),
      });
      Object.defineProperty(error, 'cause', {
        value: cause,
        configurable: true,
        writable: true,
      });
      throw error;
    }
  }

  /**
   * Uninstalls an item: runs the cleanup its install returned, if any.
   *
   * @param item - Item to remove
   * @returns True if the item was removed
   */
  remove(item: Installable<TContext, never>): boolean {
    if (!this._installed.has(item)) return false;
    this._runCleanup(item);
    return this._installed.delete(item);
  }

  /**
   * Gets all installed items.
   *
   * @returns A new Set containing all installed items
   */
  getAll(): Set<Installable<TContext, never>> {
    return new Set(this._installed.keys());
  }

  /**
   * Uninstalls every item, the last installed first.
   */
  clear(): void {
    if (this._installed.size === 0) return;
    const items = Array.from(this._installed.keys()).reverse();
    for (const item of items) this._runCleanup(item);
    this._installed.clear();
  }

  //=============================================
  // Private Methods
  //=============================================

  /**
   * Validates an installable item structure.
   */
  private _validate<TOptions>(item: Installable<TContext, TOptions>): void {
    if (!item) {
      panic(InstallableLogMessages.INVALID);
    }

    const isFunction = typeof item === 'function';
    const isObject =
      typeof item === 'object' && typeof item.install === 'function';

    if (!isFunction && !isObject) {
      panic(InstallableLogMessages.INVALID, {
        receivedType: typeof item,
      });
    }
  }

  /**
   * Gets a user-friendly name for an item.
   */
  private _getName<TOptions>(item: Installable<TContext, TOptions>): string {
    if (typeof item === 'function') {
      return item.name || 'AnonymousItem';
    }

    const obj = item as InstallableObject<TContext, TOptions>;
    return obj.name || obj.constructor?.name || 'UnnamedItem';
  }

  /**
   * Executes the installation logic.
   */
  private _execute<TOptions>(
    item: Installable<TContext, TOptions>,
    context: TContext,
    options?: TOptions
  ): InstallResult {
    if (typeof item === 'function') {
      return item(context, options);
    }
    return (item as InstallableObject<TContext, TOptions>).install(
      context,
      options
    );
  }

  /**
   * Runs and forgets the cleanup of an item. A throwing cleanup is logged, so
   * the others still run.
   */
  private _runCleanup(item: Installable<TContext, never>): void {
    const cleanup = this._installed.get(item);
    if (!cleanup) return;
    this._installed.set(item, undefined);
    try {
      cleanup();
    } catch (error) {
      logger.error(InstallableLogMessages.UNINSTALL_FAILED, {
        itemName: this._getName(item),
        error,
      });
    }
  }
}
