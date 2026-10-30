/**
 * Outlet Component
 *
 * Renders the matched route component at the current nesting level.
 * Works with nested routes to render child components.
 *
 * Supports both regular components and lazy-loaded route components
 * created with `lazyRoute()`.
 *
 * @module router/components/outlet
 *
 * @example
 * ```typescript
 * import { Component, html, Outlet, lazyRoute } from 'signy';
 *
 * // With lazy-loaded routes
 * const routes = [
 *   { path: '/', component: HomePage },
 *   { path: '/dashboard', component: lazyRoute(() => import('./Dashboard')) },
 *   { path: '/settings', component: lazyRoute(() => import('./Settings'), {
 *     loading: LoadingSpinner,
 *   })},
 * ];
 *
 * class AppLayout extends Component {
 *   protected render() {
 *     return html`
 *       <div class="app">
 *         <nav>
 *           <${Link} to="/">Home</${Link}>
 *           <${Link} to="/about">About</${Link}>
 *         </nav>
 *         <main>
 *           <${Outlet} />
 *         </main>
 *       </div>
 *     `;
 *   }
 * }
 * ```
 *
 * ## Known limitations
 *
 * **Single outlet only**: Named outlets (multiple outlets per layout) are
 * not yet supported. This will be added in a future release.
 */

import { Component, construct } from '../../component/component';
import type { Router } from '../router';
import type { LoaderState, ResolvedRoute } from '../types';
import type { ComponentClass } from '../../types';
import {
  ROUTER_KEY,
  ROUTE_KEY,
  ROUTE_DATA_KEY,
  OUTLET_DEPTH_KEY,
} from '../types';
import { createRenderEffect } from '../../reactivity/render';
import {
  createRoot,
  getOwner,
  runWithOwner,
  type Owner,
} from '../../reactivity/effect';
import { untrack } from '../../reactivity/signal/subtle';

//=============================================
// Types
//=============================================

/**
 * Props for the Outlet component
 */
export interface OutletProps {
  /** Depth level for nested routes (internal use) */
  depth?: number;
}

//=============================================
// Outlet Component
//=============================================

/**
 * Renders the matched route component at the current nesting level.
 *
 * The Outlet component is the placeholder where matched route components
 * are rendered. For nested routes, each level uses its own Outlet.
 *
 * @example
 * ```typescript
 * // In a layout component
 * class DashboardLayout extends Component {
 *   protected render() {
 *     return html`
 *       <div class="dashboard">
 *         <aside class="sidebar">...</aside>
 *         <main>
 *           <${Outlet} />
 *         </main>
 *       </div>
 *     `;
 *   }
 * }
 *
 * // Route config
 * const routes = [
 *   {
 *     path: '/dashboard',
 *     component: DashboardLayout,
 *     children: [
 *       { path: '', component: DashboardHome },
 *       { path: 'settings', component: DashboardSettings },
 *     ],
 *   },
 * ];
 * ```
 */
export class Outlet extends Component {
  //=============================================
  // Private Fields
  //=============================================

  /** Current depth level */
  private _depth: number;

  /** Container for rendered content */
  private _container: HTMLDivElement | null = null;

  /** Current rendered component */
  private _currentComponent: Component | null = null;

  /** Disposes the root the current component renders in */
  private _disposeComponent: (() => void) | null = null;

  /** What the current component was mounted for, to skip same-route renders */
  private _mountedFor: {
    route: unknown;
    params: string;
    data: unknown;
    /** Which component of the route: its own, pending or error */
    shown: unknown;
    /** The error the error component shows */
    error: unknown;
  } | null = null;

  //=============================================
  // Constructor
  //=============================================

  constructor(props: OutletProps = {}) {
    super();
    // If depth is explicitly provided, use it
    // Otherwise, get from the current outlet depth stack
    if (props.depth !== undefined) {
      this._depth = props.depth;
    } else {
      // Through the component tree, so an outlet created after an await, in
      // a lazy layout, still finds its parent outlet
      this._depth = (this.inject<number>(OUTLET_DEPTH_KEY) ?? -1) + 1;
    }
  }

  //=============================================
  // Lifecycle
  //=============================================

  protected render(): Element | DocumentFragment | void {
    // Create a container element for the outlet
    this._container = document.createElement('div');
    this._container.setAttribute('data-outlet', String(this._depth));
    this._container.style.display = 'contents'; // Don't affect layout

    // Get router from parent context
    const router = this.inject<Router>(ROUTER_KEY);

    if (!router) {
      // No router - render nothing
      return this._container;
    }

    this.provide(OUTLET_DEPTH_KEY, this._depth);

    // Provide router context to child components
    // Child components will inherit these when created inside this outlet
    this.provide(ROUTER_KEY, router);

    // Provide the route and data Signals directly so useRoute and
    // useRouteData get a Signal, as the router itself provides them
    this.provide(ROUTE_KEY, router.route);
    this.provide(ROUTE_DATA_KEY, router.data);

    // Components render in roots under this owner, not under the effect, so
    // a re-run that keeps the component does not dispose it
    const owner = getOwner();
    createRenderEffect(() => {
      const route = router.route.value;
      const data = router.data.value;
      const state = router.loaderState.value;
      const error = router.loaderError.value;
      untrack(() =>
        this._renderRoute(router, route, data, state, error, owner)
      );
    });

    return this._container;
  }

  //=============================================
  // Private Methods
  //=============================================

  /**
   * Render the matched route at the current depth.
   */
  private _renderRoute(
    router: Router,
    route: ResolvedRoute,
    data: unknown,
    state: LoaderState,
    error: unknown,
    owner: Owner | null
  ): void {
    if (!this._container) return;

    // Get matched route at our depth
    const matched = route.matched[this._depth];

    if (!matched || !matched.route.config.component) {
      // No match at this depth - clear content
      this._clearContent();
      return;
    }

    // Loader data belongs to the leaf route, so only the leaf remounts for it,
    // and only the leaf shows its pending or error component
    const config = matched.route.config;
    const isLeaf = this._depth === route.matched.length - 1;
    const shown =
      isLeaf && state === 'loading' && config.pending
        ? config.pending
        : isLeaf && state === 'error' && config.error
          ? config.error
          : config.component;
    const mountedFor = {
      route: matched.route,
      params: JSON.stringify(matched.params),
      data: isLeaf ? data : undefined,
      shown,
      error: shown === config.error ? error : undefined,
    };
    const previous = this._mountedFor;
    if (
      previous &&
      previous.route === mountedFor.route &&
      previous.params === mountedFor.params &&
      previous.data === mountedFor.data &&
      previous.shown === mountedFor.shown &&
      previous.error === mountedFor.error
    ) {
      return;
    }

    this._clearContent();
    this._mountedFor = mountedFor;
    this._mountComponent(
      shown as ComponentClass,
      router,
      route,
      data,
      shown === config.error ? { error, retry: () => router.revalidate() } : {},
      owner
    );
  }

  /**
   * Mount a component to the outlet
   */
  private _mountComponent(
    ComponentClass: ComponentClass,
    router: Router,
    route: ResolvedRoute,
    data: unknown,
    extra: Record<string, unknown>,
    owner: Owner | null
  ): void {
    if (!this._container) return;

    runWithOwner(owner, () =>
      createRoot((dispose) => {
        this._disposeComponent = dispose;
        // The root finds the outlet as the parent through the owner chain
        const component = construct(ComponentClass, {
          params: route.params,
          // A query change keeps the component, so the query is read live
          get query() {
            return router.query.value;
          },
          data,
          ...extra,
        });
        this._currentComponent = component;

        // Same path as h(): runs setup(), onMount() and Shadow DOM
        const rendered = component._renderAsChild();
        if (rendered instanceof Node) {
          this._container!.appendChild(rendered);
        }
      })
    );
  }

  /**
   * Clear the outlet content
   */
  private _clearContent(): void {
    this._mountedFor = null;
    if (this._currentComponent) {
      this._currentComponent.unmount();
      this._currentComponent = null;
    }
    this._disposeComponent?.();
    this._disposeComponent = null;

    if (this._container) {
      this._container.innerHTML = '';
    }
  }
}

//=============================================
// Functional Outlet
//=============================================

/**
 * Creates a new Outlet instance.
 *
 * Factory function shorthand for `new Outlet(props)`.
 *
 * @example
 * ```typescript
 * html`<${outlet()} />`
 * ```
 */
export function outlet(props: OutletProps = {}): Outlet {
  return new Outlet(props);
}
