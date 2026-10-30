/**
 * Lazy Route Loading
 *
 * Provides lazy loading for route components with preloading support,
 * loading state tracking, and integration with the router's Outlet.
 *
 * Works seamlessly with the existing `lazy()` function for functional
 * components while providing class-based Component support for routes.
 *
 * @module router/lazy-route
 *
 * @example
 * ```typescript
 * import { router, lazyRoute } from 'signy';
 *
 * const Dashboard = lazyRoute(() => import('./Dashboard'));
 *
 * const routes = [
 *   { path: '/', component: HomePage },
 *   { path: '/dashboard', component: Dashboard },
 *   { path: '/settings', component: lazyRoute(() => import('./Settings'), {
 *     loading: LoadingSpinner,
 *     error: ErrorPage,
 *   })},
 * ];
 *
 * const appRouter = router({ routes });
 *
 * // Preload on hover for instant navigation
 * link.onmouseenter = () => Dashboard.preload();
 * ```
 *
 * ## Known limitations
 *
 * **No retry UI**: Failed imports show the error component without a retry
 * button. The import is retried on the next render of the route.
 */

import { Component, construct } from '../component/component';
import type { ComponentClass } from '../types';
import { Signal } from '../reactivity';
import { runWithOwner } from '../reactivity/effect';

//=============================================
// Types
//=============================================

/**
 * State of a lazy route component
 */
export type LazyRouteState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Module with a default Component export
 */
export interface ComponentModule {
  default: ComponentClass;
}

/**
 * Dynamic import function for route components
 */
export type RouteImporter = () => Promise<ComponentModule>;

/**
 * Options for lazy route loading
 */
export interface LazyRouteOptions {
  /**
   * Component to show while loading.
   * Receives no props.
   */
  loading?: ComponentClass;

  /**
   * Component to show on error.
   * Receives { error: Error } props.
   */
  error?: ComponentClass;

  /**
   * Minimum loading time in ms (prevents flash of loading state)
   */
  minLoadTime?: number;

  /**
   * Custom name for debugging
   */
  name?: string;
}

/**
 * A lazy route component with metadata
 */
export interface LazyRouteComponent {
  /** Renders the loaded component with the route props it gets */
  new (props?: Record<string, unknown>): Component;

  /** Current loading state */
  readonly state: Signal<LazyRouteState>;

  /** Whether the component is currently loading */
  readonly loading: Signal<boolean>;

  /** Error if the import failed */
  readonly error: Signal<Error | undefined>;

  /** Preload the component (returns promise) */
  preload(): Promise<ComponentClass>;

  /** The resolved component class (undefined until loaded) */
  readonly componentClass: Signal<ComponentClass | undefined>;

  /** Symbol to identify lazy route components */
  readonly $$lazyRoute: true;
}

//=============================================
// Preload Registry
//=============================================

/**
 * Registry of preloaded components for deduplication
 */
const preloadRegistry = new Map<RouteImporter, Promise<ComponentClass>>();

//=============================================
// lazyRoute Implementation
//=============================================

/**
 * Creates a lazy-loaded route component.
 *
 * The returned class can be used directly in route configuration.
 * It will automatically load the component when the route is matched
 * and display loading/error states as configured.
 *
 * @param importer - Dynamic import function returning the component module
 * @param options - Optional configuration for loading/error states
 * @returns A component class that lazy-loads the actual component
 *
 * @example
 * ```typescript
 * // Basic usage
 * const routes = [
 *   { path: '/dashboard', component: lazyRoute(() => import('./Dashboard')) },
 * ];
 *
 * // With loading and error components
 * const routes = [
 *   {
 *     path: '/analytics',
 *     component: lazyRoute(() => import('./Analytics'), {
 *       loading: AnalyticsLoader,
 *       error: AnalyticsError,
 *     }),
 *   },
 * ];
 *
 * // Preload on link hover
 * const LazyDashboard = lazyRoute(() => import('./Dashboard'));
 * link.onmouseenter = () => LazyDashboard.preload();
 * ```
 */
export function lazyRoute(
  importer: RouteImporter,
  options: LazyRouteOptions = {}
): LazyRouteComponent {
  // State signals
  const state = new Signal<LazyRouteState>('idle');
  const error = new Signal<Error | undefined>(undefined);
  const componentClass = new Signal<ComponentClass | undefined>(undefined);

  // Loading derived state
  const loading = new Signal<boolean>(false);

  // Load promise (for deduplication)
  let loadPromise: Promise<ComponentClass> | null = null;

  /**
   * Loads the component if not already loaded
   */
  const load = async (): Promise<ComponentClass> => {
    // Already loaded
    const current = componentClass.value;
    if (current) {
      return current;
    }

    // Check preload registry
    const preloaded = preloadRegistry.get(importer);
    if (preloaded) {
      try {
        const result = await preloaded;
        componentClass.value = result;
        state.value = 'ready';
        loading.value = false;
        return result;
      } catch (_err) {
        // Fall through to retry
      }
    }

    // Already loading - return existing promise
    if (loadPromise) {
      return loadPromise;
    }

    state.value = 'loading';
    loading.value = true;
    error.value = undefined;

    const startTime = Date.now();

    loadPromise = (async () => {
      try {
        // Perform the dynamic import
        const module = await importer();

        // Ensure default export exists and is a Component class
        if (!module || !module.default) {
          throw new Error(
            `Lazy route module ${options.name ?? 'unknown'} has no default export`
          );
        }

        // Apply minimum load time if specified
        if (options.minLoadTime) {
          const elapsed = Date.now() - startTime;
          const remaining = options.minLoadTime - elapsed;
          if (remaining > 0) {
            await new Promise((resolve) => setTimeout(resolve, remaining));
          }
        }

        const LoadedClass = module.default;
        componentClass.value = LoadedClass;
        state.value = 'ready';
        loading.value = false;
        return LoadedClass;
      } catch (err) {
        const loadError = err instanceof Error ? err : new Error(String(err));
        error.value = loadError;
        state.value = 'error';
        loading.value = false;
        loadPromise = null; // Allow retry
        throw loadError;
      }
    })();

    // Store in registry for deduplication
    preloadRegistry.set(importer, loadPromise);

    return loadPromise;
  };

  /**
   * Wrapper component that handles loading states
   */
  class LazyRouteWrapper extends Component {
    private _loadedComponent: Component | null = null;
    private _loadingComponent: Component | null = null;
    private _errorComponent: Component | null = null;
    private _container: HTMLDivElement | null = null;
    private _props: Record<string, unknown>;
    private _unmounted = false;

    constructor(props: Record<string, unknown> = {}) {
      super();
      this._props = props;

      // Register cleanup in constructor for components used via direct render()
      this.onUnmount(() => {
        this._unmounted = true;
        this._clearContent();
        if (this._loadedComponent) {
          this._loadedComponent.unmount();
          this._loadedComponent = null;
        }
      });
    }

    protected render(): Element | DocumentFragment | void {
      this._container = document.createElement('div');
      this._container.style.display = 'contents';

      const currentState = state.value;
      const LoadedClass = componentClass.value;

      if (currentState === 'ready' && LoadedClass) {
        // Already loaded - render immediately
        this._renderLoaded(LoadedClass);
      } else {
        // Start loading. After an error this retries, so one failed request
        // does not break the route until a reload
        this._renderLoading();
        void this._startLoading();
      }

      return this._container;
    }

    private async _startLoading(): Promise<void> {
      try {
        const LoadedClass = await load();
        // Navigated away while loading: nothing may mount under a dead owner
        if (this._unmounted) return;
        this._clearContent();
        this._renderLoaded(LoadedClass);
      } catch {
        // Error already set by load()
        if (this._unmounted) return;
        this._clearContent();
        this._renderError();
      }
    }

    private _renderLoading(): void {
      if (!this._container) return;

      if (options.loading) {
        const Loading = options.loading;
        this._loadingComponent = this._showChild(() => construct(Loading));
      }
      // If no loading component, container stays empty (could add default spinner)
    }

    private _renderLoaded(LoadedClass: ComponentClass): void {
      if (!this._container) return;

      this._loadedComponent = this._showChild(() =>
        construct(LoadedClass, this._props)
      );
    }

    private _renderError(): void {
      if (!this._container) return;

      const currentError = error.value;
      if (options.error) {
        const ErrorView = options.error;
        this._errorComponent = this._showChild(() =>
          construct(ErrorView, { error: currentError })
        );
      } else {
        // Default error display
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText =
          'padding: 20px; color: #c00; background: #fee; border-radius: 4px;';
        errorDiv.textContent = `Failed to load: ${currentError?.message ?? 'Unknown error'}`;
        this._container.appendChild(errorDiv);
      }
    }

    /**
     * Creates and renders a child under this wrapper, so it runs setup() and
     * onMount(), can inject(), and is unmounted with the wrapper. Loading
     * finishes in a promise callback, where no owner is current.
     */
    private _showChild(create: () => Component): Component {
      const child = runWithOwner(this, create);
      const rendered = runWithOwner(this, () => child._renderAsChild());
      if (rendered instanceof Node) {
        this._container!.appendChild(rendered);
      }
      return child;
    }

    private _clearContent(): void {
      if (this._loadingComponent) {
        this._loadingComponent.unmount();
        this._loadingComponent = null;
      }
      if (this._errorComponent) {
        this._errorComponent.unmount();
        this._errorComponent = null;
      }
      if (this._container) {
        this._container.innerHTML = '';
      }
    }
  }

  // Attach metadata to the wrapper class
  const LazyComponent = LazyRouteWrapper as unknown as LazyRouteComponent;

  Object.defineProperties(LazyComponent, {
    state: { value: state, enumerable: true },
    loading: { value: loading, enumerable: true },
    error: { value: error, enumerable: true },
    componentClass: { value: componentClass, enumerable: true },
    preload: { value: load, enumerable: true },
    $$lazyRoute: { value: true, enumerable: true },
  });

  return LazyComponent;
}

/**
 * Checks if a component is a lazy route component
 */
export function isLazyRouteComponent(
  value: unknown
): value is LazyRouteComponent {
  return (
    typeof value === 'function' &&
    (value as LazyRouteComponent).$$lazyRoute === true
  );
}

/**
 * Preloads multiple lazy route components in parallel
 *
 * @param components - Array of lazy route components to preload
 * @returns Promise that resolves when all components are loaded
 *
 * @example
 * ```typescript
 * const LazyDashboard = lazyRoute(() => import('./Dashboard'));
 * const LazySettings = lazyRoute(() => import('./Settings'));
 *
 * // Preload on app idle
 * requestIdleCallback(() => {
 *   preloadRoutes([LazyDashboard, LazySettings]);
 * });
 * ```
 */
export async function preloadRoutes(
  components: LazyRouteComponent[]
): Promise<void> {
  await Promise.all(components.map((c) => c.preload().catch(() => {})));
}

/**
 * Clears the preload registry (useful for testing)
 * @internal
 */
export function clearPreloadRegistry(): void {
  preloadRegistry.clear();
}
