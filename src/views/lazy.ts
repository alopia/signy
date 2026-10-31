/**
 * Lazy Loading for Components and Modules
 *
 * Provides code-splitting and lazy loading with automatic loading state
 * tracking. Works seamlessly with the Suspense component for declarative
 * loading boundaries.
 *
 * Inspired by React.lazy() and Solid.js lazy() with signal-based state
 * management for fine-grained reactivity.
 *
 * @module views/lazy
 *
 * @example
 * ```typescript
 * import { lazy, Suspense, html } from 'signy';
 *
 * // Lazy load a component
 * const LazyChart = lazy(() => import('./ChartComponent'));
 *
 * // Use with Suspense boundary
 * html`
 *   <${Suspense} fallback=${html`<div>Loading chart...</div>`}>
 *     <${LazyChart} data=${chartData} />
 *   </${Suspense}>
 * `;
 *
 * // Preload for better UX (e.g., on hover)
 * button.onmouseenter = () => LazyChart.preload();
 * ```
 *
 * ## Known limitations
 *
 * **Single default export**: Currently only supports default exports
 * from lazy-loaded modules. Use a wrapper for named exports.
 */

import { Signal } from '../reactivity';
import { h } from './hyperscript';
import type { ComponentClass } from '../types';
import { panic, logger } from '../log';
import { LazyStates, Markers, type LazyState } from '../constants';
import { ViewLogMessages } from './log-messages';
import { Show } from './control-flow';
import {
  getSuspenseBoundary,
  type SuspenseBoundary,
} from '../reactivity/suspense-boundary';

export type { SuspenseBoundary };

//=============================================
// Types
//=============================================

// Re-export LazyState type from constants for consumer convenience
export type { LazyState } from '../constants';
// Re-export LazyStates constant for direct access
export { LazyStates } from '../constants';

/**
 * Module with a default export
 */
export interface DefaultExportModule<T> {
  default: T;
}

/**
 * Dynamic import function type
 */
export type LazyImporter<T> = () => Promise<DefaultExportModule<T>>;

/**
 * A renderable function type (component factory)
 */
export type RenderableComponent = (props?: Record<string, unknown>) => Node;

/**
 * A component class, as the default export of a lazy module
 */
export type LazyComponentClass = ComponentClass;

/**
 * What a lazy module can export: a function component or a component class
 */
export type LazyTarget = RenderableComponent | LazyComponentClass;

/**
 * Props of a lazy target: the function's parameter or the class's props
 */
type LazyProps<T> = T extends LazyComponentClass
  ? ConstructorParameters<T>[0]
  : T extends RenderableComponent
    ? Parameters<T>[0]
    : never;

/**
 * Lazy component with metadata and preload capability
 */
export interface LazyComponent<T extends LazyTarget = RenderableComponent> {
  /** Renders the component, or a placeholder it swaps in once loaded. Throws a load error once */
  (props?: LazyProps<T>): Node;

  /** Current loading state */
  readonly state: Signal<LazyState>;

  /** Whether the component is currently loading */
  readonly loading: () => boolean;

  /** Error if the import failed */
  readonly error: Signal<Error | undefined>;

  /** Preload the component (returns promise) */
  preload(): Promise<T>;

  /** The resolved component (undefined until loaded) */
  readonly component: Signal<T | undefined>;

  /** Symbol to identify lazy components */
  readonly $$lazy: true;
}

/**
 * Options for lazy loading
 */
export interface LazyOptions {
  /**
   * Custom name for debugging
   */
  name?: string;

  /**
   * Minimum loading time in ms (prevents flash of loading state)
   */
  minLoadTime?: number;
}

//=============================================
// Suspense Context
//=============================================

/**
 * Boundaries pushed by hand. Suspense itself is found by ownership, see
 * getCurrentSuspenseBoundary().
 */
const suspenseBoundaries: SuspenseBoundary[] = [];

/**
 * Registers a Suspense boundary.
 * @internal
 */
export function pushSuspenseBoundary(boundary: SuspenseBoundary): void {
  suspenseBoundaries.push(boundary);
}

/**
 * Unregisters a Suspense boundary.
 * @internal
 */
export function popSuspenseBoundary(): void {
  suspenseBoundaries.pop();
}

/**
 * Gets the current Suspense boundary: the last one pushed, else the nearest
 * Suspense above the current owner.
 * @internal
 */
export function getCurrentSuspenseBoundary(): SuspenseBoundary | undefined {
  return (
    suspenseBoundaries[suspenseBoundaries.length - 1] ?? getSuspenseBoundary()
  );
}

//=============================================
// lazy Implementation
//=============================================

/**
 * Creates a lazy-loaded component with automatic loading state tracking.
 *
 * The component will be loaded when first rendered (or when `preload()` is called).
 * During loading, the nearest Suspense boundary will show its fallback.
 *
 * @param importer - Dynamic import function returning the component module
 * @param options - Optional configuration
 * @returns A lazy component that can be used in templates
 *
 * @example
 * ```typescript
 * // Basic usage
 * const LazyDashboard = lazy(() => import('./Dashboard'));
 *
 * // With options
 * const LazyChart = lazy(() => import('./Chart'), {
 *   name: 'Chart',
 *   minLoadTime: 200 // Prevent flash of loading state
 * });
 *
 * // Access loading state
 * if (LazyChart.loading()) {
 *   console.log('Loading...');
 * }
 *
 * // Preload on hover
 * button.onmouseenter = () => LazyChart.preload();
 * ```
 */
export function lazy<T extends LazyTarget>(
  importer: LazyImporter<T>,
  options: LazyOptions = {}
): LazyComponent<T> {
  // State signals
  const state = new Signal<LazyState>(LazyStates.IDLE);
  const error = new Signal<Error | undefined>(undefined);
  const component = new Signal<T | undefined>(undefined);

  // Loading derived state
  const loading = (): boolean => state.value === LazyStates.LOADING;

  // Load promise (for deduplication)
  let loadPromise: Promise<T> | null = null;

  // Whether a render threw the current error. The render after that retries
  let errorThrown = false;

  /**
   * Loads the component if not already loaded
   */
  const load = async (): Promise<T> => {
    // Already loaded
    const currentComponent = component.value;
    if (currentComponent) {
      return currentComponent;
    }

    // Already loading - return existing promise
    if (loadPromise) {
      return loadPromise;
    }

    state.value = LazyStates.LOADING;
    error.value = undefined;
    errorThrown = false;

    const startTime = Date.now();

    loadPromise = (async () => {
      try {
        // Perform the dynamic import
        const module = await importer();

        // Ensure default export exists
        if (!module || !module.default) {
          panic(
            ViewLogMessages.LAZY_NO_DEFAULT_EXPORT,
            `Lazy module ${options.name ?? 'unknown'} has no default export`
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

        const loadedComponent = module.default;
        component.value = loadedComponent;
        state.value = LazyStates.READY;
        return loadedComponent;
      } catch (err) {
        const loadError = err instanceof Error ? err : new Error(String(err));
        error.value = loadError;
        state.value = LazyStates.ERROR;
        loadPromise = null; // Allow retry
        throw loadError;
      }
    })();

    return loadPromise;
  };

  /**
   * The lazy component function
   */
  const lazyComponent = ((props?: LazyProps<T>): Node => {
    const currentState = state.value;
    const currentComponent = component.value;

    // If already loaded, render immediately
    if (currentState === LazyStates.READY && currentComponent) {
      return renderLoaded(currentComponent, props);
    }

    // The first render after a failure throws, for an ErrorBoundary around
    // the Suspense. A later one, after its reset or a remount, retries
    if (currentState === LazyStates.ERROR && !errorThrown) {
      const currentError = error.value;
      if (currentError) {
        errorThrown = true;
        throw currentError;
      }
    }

    // Start loading, or join the load in flight. Every caller registers, so
    // a second boundary rendering it during the load waits too
    const settled = (loadPromise ?? load()).then(noop, noop);
    const boundary = getCurrentSuspenseBoundary();
    if (boundary) {
      boundary.register(settled);
      void settled.then(() => boundary.unregister(settled));
    } else if (__DEV__) {
      logger.warn(ViewLogMessages.LAZY_OUTSIDE_SUSPENSE, {
        name: options.name,
      });
    }

    // Suspense keeps this alive behind its fallback, so it swaps itself in.
    // A failed load throws to the nearest ErrorBoundary.
    return Show({
      when: () => {
        if (state.value === LazyStates.ERROR && !errorThrown) {
          errorThrown = true;
          throw error.peek();
        }
        return component.value;
      },
      fallback: document.createComment(
        `${Markers.LAZY_LOADING}:${options.name ?? 'component'}`
      ),
      children: (target) => renderLoaded(target, props),
    });
  }) as LazyComponent<T>;

  // Attach metadata
  Object.defineProperties(lazyComponent, {
    state: { value: state, enumerable: true },
    loading: { value: loading, enumerable: true },
    error: { value: error, enumerable: true },
    component: { value: component, enumerable: true },
    preload: { value: load, enumerable: true },
    $$lazy: { value: true, enumerable: true },
  });

  return lazyComponent;
}

function noop(): void {}

/**
 * Renders what a lazy module exported. A class goes through h(), like a
 * class used as a tag, and a function component is called.
 */
function renderLoaded(target: LazyTarget, props: unknown): Node {
  if (target.prototype && typeof target.prototype.render === 'function') {
    return h(
      target as LazyComponentClass,
      (props ?? null) as Record<string, unknown> | null
    );
  }
  return (target as RenderableComponent)(
    props as Record<string, unknown> | undefined
  );
}

/**
 * Checks if a value is a lazy component
 */
export function isLazyComponent(value: unknown): value is LazyComponent {
  return (
    typeof value === 'function' && (value as LazyComponent).$$lazy === true
  );
}

/**
 * Preloads multiple lazy components in parallel
 *
 * @param components - Array of lazy components to preload
 * @returns Promise that resolves when all components are loaded
 *
 * @example
 * ```typescript
 * // Preload components on route hover
 * const LazyDashboard = lazy(() => import('./Dashboard'));
 * const LazySettings = lazy(() => import('./Settings'));
 *
 * link.onmouseenter = () => {
 *   preloadAll([LazyDashboard, LazySettings]);
 * };
 * ```
 */
export async function preloadAll(components: LazyComponent[]): Promise<void> {
  await Promise.all(components.map((c) => c.preload().catch(() => {})));
}
