/**
 * Application class
 *
 * ## Known limitations
 *
 * None.
 */

import type {
  AppConfigOptions,
  ElementOrSelector,
  ComponentOptions,
} from '../types';
import { AppConfig } from './app-config';
import { Component } from '../component/component';
import { getElement } from '../dom';
import { panic, logger } from '../log';
import { AppLogMessages } from './log-messages';
import { VERSION } from '../constants';
import { features, isFeaturesActive } from '../core/features';

import {
  InstallableRegistry,
  type Installable,
  type InstallationOptions,
} from './installable-registry';

/**
 * Application lifecycle status
 */
export enum AppStatus {
  /** Application created but not yet mounted */
  CREATED = 0,

  /** Application successfully mounted to DOM */
  MOUNTED = 1,

  /** Application unmounted from DOM */
  UNMOUNTED = 2,
}

/**
 * Options for creating an application instance.
 */
export interface ApplicationOptions {
  /** Root component instance or class to render */
  rootComponent?: Component | (new () => Component);

  /** Mount point selector or element (default: '#app') */
  mountPoint?: ElementOrSelector;

  /** Initial configuration options */
  config?: AppConfigOptions;
}

/**
 * Main application class that manages the entire app lifecycle.
 * Provides a unified API for configuration, plugins, and mounting.
 *
 * @example
 * ```typescript
 * // Simple - with component class
 * const app = application(AppComponent);
 * app.mount('#app');
 *
 * // With constructor params - use instance
 * const app = application(new AppComponent({ title: 'My App' }));
 * app.mount('#app');
 *
 * // Configure before mounting
 * const app = application({
 *   rootComponent: AppComponent
 * });
 * app.config.configure({
 *   mode: 'development',
 *   debug: true
 * });
 * app.mount('#app');
 * ```
 */
export class Application {
  //=============================================
  // Static Methods
  //=============================================

  /**
   * Creates a new application instance.
   * Static method alternative to `application()`.
   *
   * @param options - Application options, component instance, or component class
   * @returns A new Application instance
   *
   * @example
   * ```typescript
   * import { Application } from 'signy';
   *
   * // With component class
   * const app = Application.create(MyComponent);
   *
   * // With component instance
   * const app = Application.create(new MyComponent({ title: 'Hello' }));
   *
   * // With full options
   * const app = Application.create({
   *   rootComponent: MyComponent,
   *   config: { mode: 'production' }
   * });
   *
   * app.mount('#app');
   * ```
   */
  static create(
    options?: ApplicationOptions | Component | (new () => Component)
  ): Application {
    return application(options);
  }

  //=============================================
  // Public Instance Fields
  //=============================================

  /** Application configuration manager */
  readonly config: AppConfig;

  //=============================================
  // Private Instance Fields
  //=============================================

  /** Root component instance */
  private rootComponent?: Component;

  /** Container element where app is mounted */
  private container: Element | null = null;

  /** Application lifecycle status */
  private _status: AppStatus = AppStatus.CREATED;

  /** Default mount point from options */
  private mountPoint: ElementOrSelector;

  /** Plugin registry for tracking installed plugins */
  private pluginRegistry: InstallableRegistry<Application>;

  /** Components mounted with mountComponent(), unmounted with the app */
  private readonly _mountedComponents = new Set<Component>();

  /** App-level providers for dependency injection (plugins, router, etc.) */
  private _providers = new Map<string | symbol, unknown>();

  /** Unique application ID */
  private readonly _id: string;

  /** Static counter for generating unique IDs */
  private static _instanceCounter = 0;

  /**
   * Creates a new application instance.
   * Use `application()` for a more concise syntax.
   *
   * @param options - Application options, component instance, or component class
   */
  constructor(
    options?: ApplicationOptions | Component | (new () => Component)
  ) {
    // Normalize options to ApplicationOptions
    const opts = this.normalizeOptions(options);

    this.config = new AppConfig();
    this.pluginRegistry = new InstallableRegistry<Application>();
    this.mountPoint = opts.mountPoint ?? '#app';
    this._id = `app-${++Application._instanceCounter}`;

    // Handle both component instance and class
    if (opts.rootComponent) {
      if (opts.rootComponent instanceof Component) {
        // Prevent adding same component instance to multiple apps
        if (!opts.rootComponent._bindApp(this)) {
          panic(AppLogMessages.COMPONENT_ALREADY_BOUND);
        }
        this.rootComponent = opts.rootComponent;
      } else if (typeof opts.rootComponent === 'function') {
        // Create component with app reference in constructor
        const RootClass = opts.rootComponent as new (
          props: object,
          options: ComponentOptions
        ) => Component;
        this.rootComponent = new RootClass({}, { app: this });
      }
    }

    if (opts.config) {
      this.config.configure(opts.config);
    }
  }

  /**
   * Normalizes constructor input to ApplicationOptions.
   */
  private normalizeOptions(
    options?: ApplicationOptions | Component | (new () => Component)
  ): ApplicationOptions {
    if (options instanceof Component) {
      return { rootComponent: options };
    }
    if (typeof options === 'function') {
      return { rootComponent: options };
    }
    return options ?? {};
  }

  //=============================================
  // Getters and Setters
  //=============================================

  /**
   * Gets the framework version.
   *
   * @returns Framework version from package.json
   *
   * @example
   * ```typescript
   * console.log(`Running Signy v${app.version}`);
   * ```
   */
  get version(): string {
    return VERSION;
  }

  /**
   * Gets the current application lifecycle status.
   * Useful for debugging and conditional logic.
   *
   * @returns Current application status
   *
   * @example
   * ```typescript
   * if (app.status === AppStatus.MOUNTED) {
   *   // App is running
   * }
   * ```
   */
  get status(): AppStatus {
    return this._status;
  }

  /**
   * Unique identifier for this application instance.
   */
  get id(): string {
    return this._id;
  }

  /**
   * Whether this application is currently mounted.
   */
  get isMounted(): boolean {
    return this._status === AppStatus.MOUNTED;
  }

  //=============================================
  // Mounting Methods
  //=============================================

  /**
   * Mounts the application to a DOM element.
   *
   * @param target - DOM element or CSS selector where app should be mounted.
   *                 If not provided, uses mountPoint from options (default: '#app')
   * @returns The Application instance for chaining
   * @throws {Error} If mount target is not found or app is already mounted
   *
   * @example
   * ```typescript
   * // Use default mount point from options or '#app'
   * app.mount();
   *
   * // Override with specific target
   * app.mount('#custom-target');
   * app.mount(document.getElementById('custom-target'));
   * ```
   */
  mount(target?: ElementOrSelector | undefined): this {
    // Only allow mounting from CREATED state
    // (no remount from UNMOUNTED)
    if (this._status !== AppStatus.CREATED) {
      panic(AppLogMessages.INVALID_STATE);
    }

    // Use provided target or fall back to mountPoint from options
    const mountTarget = target ?? this.mountPoint;
    this.container = getElement(mountTarget);
    if (!this.container) {
      panic(AppLogMessages.INVALID_MOUNT_TARGET, {
        target: mountTarget,
      });
    }

    if (this.rootComponent) {
      // Component already has app reference from constructor
      try {
        this.rootComponent.mount(this.container);
      } catch (error) {
        // The root disposed itself, the plugins installed for it go too
        this._teardown();
        throw error;
      }
    }

    this._status = AppStatus.MOUNTED;

    // Emit app mount event for dev tools
    if (isFeaturesActive()) features.emit.appMount(this);

    return this;
  }

  /**
   * Unmounts the application from the DOM.
   *
   * After calling unmount(), you must create a new app instance to mount again.
   *
   * @returns The Application instance for chaining
   *
   * @example
   * ```typescript
   * app.unmount();
   *
   * // To mount again, create a new instance
   * const newApp = application(AppComponent);
   * newApp.mount('#app');
   * ```
   */
  unmount(): this {
    // Only unmount if currently mounted
    // (no-op for CREATED or UNMOUNTED)
    if (
      this._status !== AppStatus.MOUNTED &&
      this._mountedComponents.size === 0
    ) {
      logger.warn(AppLogMessages.NOT_MOUNTED, { status: this._status });
      return this;
    }

    this._teardown();

    // Emit app unmount event for dev tools
    if (isFeaturesActive()) features.emit.appUnmount(this);

    return this;
  }

  /** Unmounts the components and clears the plugins and providers. */
  private _teardown(): void {
    for (const component of this._mountedComponents) component.unmount();
    this._mountedComponents.clear();

    if (this.rootComponent) {
      this.rootComponent.unmount();
    }

    // The container is not cleared: each component removed what it added, and
    // the page may have put other nodes in it

    // After the components, which may still use plugin services on unmount
    this.pluginRegistry.clear();
    this._providers.clear();

    // Clear all references
    this.rootComponent = undefined;
    this.container = null;

    this._status = AppStatus.UNMOUNTED;
  }

  //=============================================
  // Component Methods
  //=============================================

  /**
   * Creates a component instance explicitly bound to this application.
   * Useful for micro-frontends or when explicit app binding is needed.
   *
   * **When to use:**
   * - Micro-frontends with multiple apps running on the same page
   * - Testing scenarios where you want isolated app contexts
   *
   * **When NOT to use:**
   * - Single app scenarios (use `new Component()` instead - simpler)
   *
   * @param ComponentClass - Component class to instantiate
   * @param options - Constructor options for the component
   * @returns Component instance bound to this application
   *
   * @example
   * ```typescript
   * // Multi-app scenario (micro-frontends)
   * const mainApp = application(MainApp);
   * const widgetApp = application(WidgetApp);
   *
   * const navbar = mainApp.createComponent(Navbar);
   * const widget = widgetApp.createComponent(Widget, { id: 'widget-1' });
   *
   * // Each component is bound to its specific app
   * ```
   */
  createComponent<T extends Component, P = Record<string, unknown>>(
    ComponentClass: new (props: P, options?: ComponentOptions) => T,
    props?: P,
    options?: ComponentOptions
  ): T {
    // Merge app reference into options
    const componentOptions = { ...options, app: this };
    return new ComponentClass(props ?? ({} as P), componentOptions);
  }

  /**
   * Creates and mounts a component to a DOM element.
   * Convenience method that combines createComponent() + mount().
   *
   * Useful for adding multiple components to different parts of the page
   * while keeping them in the same application context.
   *
   * @param ComponentClass - Component class to instantiate
   * @param target - DOM element or CSS selector to mount to
   * @param props - Optional component props
   * @param options - Optional component options
   * @returns The mounted component instance
   *
   * @example
   * ```typescript
   * const app = application(MainApp);
   * app.mount('#main');
   *
   * // Add more components to the same app
   * const header = app.mountComponent(Header, '#header', { title: 'My App' });
   * const sidebar = app.mountComponent(Sidebar, '#sidebar');
   * const footer = app.mountComponent(Footer, '#footer');
   *
   * // All components share the same app context (plugins, providers, etc.)
   * ```
   */
  mountComponent<T extends Component, P = Record<string, unknown>>(
    ComponentClass: new (props: P, options?: ComponentOptions) => T,
    target: ElementOrSelector,
    props?: P,
    options?: ComponentOptions
  ): T {
    const component = this.createComponent(ComponentClass, props, options);
    component.mount(target as Element | string);
    // Drop the ones unmounted on their own since, so the set does not hold them
    for (const mounted of this._mountedComponents) {
      if (!mounted.isMounted) this._mountedComponents.delete(mounted);
    }
    this._mountedComponents.add(component);
    return component;
  }

  //=============================================
  // Plugin Methods
  //=============================================

  /**
   * Use a plugin with the application.
   * Plugins can extend app functionality. By default, prevents duplicate installations
   * for safety. Use `{ force: true }` to explicitly reinstall a plugin.
   *
   * Similar to Vue 3's plugin system but with added force override capability.
   *
   * @param plugin - Plugin function or object with `install` method
   * @param options - Optional plugin configuration (use `force: true` to reinstall)
   * @returns The Application instance for chaining
   *
   * @example
   * ```typescript
   * // Normal usage - prevents duplicates
   * app.use(money);
   * app.use(money); // Skipped with a warning
   *
   * // Plugin with options
   * app.use(love, { options: { apiKey: 'xyz123' } });
   *
   * // Force reinstall with different config
   * app.use(analytics, { options: { env: 'development' } });
   * app.use(analytics, { force: true, options: { env: 'production' } }); // Reinstalls
   *
   * // Plugin object with install method (Vue-style)
   * const myPlugin: InstallableObject<Application> = {
   *   install(app, options) {
   *     // Configure application
   *     app.config.set('debug', options.debug);
   *   }
   * };
   * app.use(myPlugin, { options: { debug: true } });
   *
   * // Plugin function
   * const simplePlugin: InstallableFunction<Application> = (app, options) => {
   *   app.config.set('theme', options.theme);
   * };
   * app.use(simplePlugin, { options: { theme: 'dark' } });
   * ```
   */
  use(plugin: Installable<Application>, options?: InstallationOptions): this {
    this.pluginRegistry.install(plugin, this, options);
    return this;
  }

  //=============================================
  // Dependency Injection Methods
  //=============================================

  /**
   * Provides a value at the application level.
   * All components in this app can access this value via inject().
   *
   * Used by plugins (like Router) to register themselves with the app.
   * For micro-frontends, each app has its own providers, ensuring isolation.
   *
   * @template T - Type of the provided value
   * @param key - Injection key (string or symbol)
   * @param value - Value to provide
   *
   * @example
   * ```typescript
   * // Plugin registering itself
   * app.provide(ROUTER_KEY, router);
   *
   * // Custom app-level service
   * app.provide('api', new ApiService());
   * ```
   */
  provide<T>(key: string | symbol, value: T): void {
    this._providers.set(key, value);
  }

  /**
   * Gets a value from the application-level providers.
   * Called by Component.inject() as a fallback after walking the component tree.
   *
   * @template T - Type of the value
   * @param key - Injection key (string or symbol)
   * @returns The provided value, or undefined if not found
   *
   * @example
   * ```typescript
   * const router = app.get(ROUTER_KEY);
   * const api = app.get<ApiService>('api');
   * ```
   */
  get<T>(key: string | symbol): T | undefined {
    return this._providers.get(key) as T | undefined;
  }

  /**
   * Checks if a value is provided at the application level.
   *
   * @param key - Injection key to check
   * @returns True if the key has a provided value
   */
  has(key: string | symbol): boolean {
    return this._providers.has(key);
  }
}

//=============================================
// Factory functions
//=============================================

/**
 * Creates a new application instance.
 *
 * Factory function shorthand for `new Application(options)`.
 *
 * @param options - Application options, component instance, or component class
 * @returns A new Application instance
 *
 * @example
 * ```typescript
 * import { application } from 'signy';
 *
 * // With component class (shorter syntax for simple cases)
 * const app = application(MyComponent);
 *
 * // With component instance (use when you need constructor params)
 * const app = application(new MyComponent({ title: 'Hello' }));
 *
 * // With full options
 * const app = application({
 *   rootComponent: MyComponent,
 *   config: { mode: 'production' }
 * });
 *
 * // Mount and start the app
 * app.mount('#app');
 * ```
 */
export function application(
  options?: ApplicationOptions | Component | (new () => Component)
): Application {
  return new Application(options);
}
