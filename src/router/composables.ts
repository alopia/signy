/**
 * Router Composables
 *
 * Convenience functions for accessing the scoped router and its reactive state
 * within components. These composables automatically use the correct router
 * instance based on the component's application context.
 *
 * **Micro Frontend Support**: In multi-app scenarios, each composable returns
 * the router/state from the current component's app, not a global instance.
 *
 * @module router/composables
 *
 * @example
 * ```typescript
 * import { Component, html } from 'signy';
 * import { useRouter, useRoute, useParams } from 'signy/router';
 *
 * class UserProfile extends Component {
 *   protected setup() {
 *     const router = useRouter(this);
 *     const route = useRoute(this);
 *     const params = useParams(this);
 *
 *     // React to route changes
 *     effect(() => {
 *       console.log('Current path:', route.value.path);
 *       console.log('User ID:', params.value.id);
 *     });
 *
 *     // Navigate programmatically
 *     this.goToSettings = () => router.push('/settings');
 *   }
 *
 *   protected render() {
 *     return html`<button onClick=${this.goToSettings}>Settings</button>`;
 *   }
 * }
 * ```
 *
 * ## Known limitations
 *
 * None.
 */

import type { Component } from '../component/component';
import type { Router } from './router';
import type { ResolvedRoute, QueryParams, PathParams } from './types';
import {
  ROUTER_KEY,
  ROUTE_KEY,
  ROUTE_PARAMS_KEY,
  ROUTE_QUERY_KEY,
  ROUTE_DATA_KEY,
} from './types';
import type { Signal } from '../reactivity';
import { panic } from '../log';
import { RouterLogMessages } from './log-messages';
import { CONTEXT_INJECT, type ContextHost } from '../context/owner';

/** What the component, its ancestors or its app provide for a key */
function inject<T>(component: Component, key: symbol): T | undefined {
  return (component as unknown as ContextHost)[CONTEXT_INJECT](key) as
    T | undefined;
}

/**
 * The value provided for `key`, or the same value read from the router when
 * only the router was provided.
 */
function fromRouter<T>(
  component: Component,
  key: symbol,
  pick: (router: Router) => T
): T {
  const value = inject<T>(component, key);
  if (value !== undefined) return value;
  const router = inject<Router>(component, ROUTER_KEY);
  if (!router) panic(RouterLogMessages.NOT_INSTALLED);
  return pick(router);
}

//=============================================
// Router Composables
//=============================================

/**
 * Get the router instance for the component's application.
 *
 * Returns the router that was installed via `app.use(router)` for the
 * component's app. In micro frontend scenarios with multiple apps,
 * each component gets its own app's router.
 *
 * @param component - The component requesting the router
 * @returns The Router instance
 * @throws If no router is installed for the app
 *
 * @example
 * ```typescript
 * class Navigation extends Component {
 *   protected setup() {
 *     const router = useRouter(this);
 *
 *     this.navigate = (path: string) => {
 *       router.push(path);
 *     };
 *   }
 * }
 * ```
 */
export function useRouter(component: Component): Router {
  const router = inject<Router>(component, ROUTER_KEY);
  if (!router) panic(RouterLogMessages.NOT_INSTALLED);
  return router;
}

/**
 * Get the reactive route state for the component's application.
 *
 * Returns the signal of the current resolved route.
 * The route updates automatically on navigation.
 *
 * @param component - The component requesting the route
 * @returns Signal for the current route
 * @throws If no router is installed for the app
 *
 * @example
 * ```typescript
 * class Breadcrumbs extends Component {
 *   protected setup() {
 *     const route = useRoute(this);
 *
 *     effect(() => {
 *       console.log('Current path:', route.value.path);
 *       console.log('Meta:', route.value.meta);
 *     });
 *   }
 * }
 * ```
 */
export function useRoute(component: Component): Signal<ResolvedRoute> {
  return fromRouter(component, ROUTE_KEY, (router) => router.route);
}

/**
 * Get the reactive route params for the component's application.
 *
 * Returns the signal of the current route parameters.
 * Params update automatically on navigation.
 *
 * @param component - The component requesting the params
 * @returns Signal for the current route params
 * @throws If no router is installed for the app
 *
 * @example
 * ```typescript
 * class UserDetail extends Component {
 *   protected setup() {
 *     // The path in the type gives the names: id is a string
 *     const params = useParams<'/users/:id'>(this);
 *
 *     effect(() => {
 *       const userId = params.value.id;
 *       this.loadUser(userId);
 *     });
 *   }
 * }
 * ```
 */
export function useParams<Path extends string = string>(
  component: Component
): Signal<PathParams<Path>> {
  return fromRouter(
    component,
    ROUTE_PARAMS_KEY,
    (router) => router.params
  ) as unknown as Signal<PathParams<Path>>;
}

/**
 * Get the reactive query params for the component's application.
 *
 * Returns the signal of the current query parameters.
 * Query params update automatically on navigation.
 *
 * @param component - The component requesting the query
 * @returns Signal for the current query params
 * @throws If no router is installed for the app
 *
 * @example
 * ```typescript
 * class SearchResults extends Component {
 *   protected setup() {
 *     const query = useQuery(this);
 *
 *     effect(() => {
 *       const searchTerm = query.value.q;
 *       const page = query.value.page ?? '1';
 *       this.search(searchTerm, parseInt(page));
 *     });
 *   }
 * }
 * ```
 */
export function useQuery(component: Component): Signal<QueryParams> {
  return fromRouter(component, ROUTE_QUERY_KEY, (router) => router.query);
}

/**
 * Get the reactive route data for the component's application.
 *
 * Returns the signal of the data loaded by route loaders.
 * Data updates automatically when loaders complete.
 *
 * @param component - The component requesting the data
 * @returns Signal for the current route data
 * @throws If no router is installed for the app
 *
 * @example
 * ```typescript
 * class UserProfile extends Component {
 *   protected setup() {
 *     const data = useRouteData<User>(this);
 *
 *     effect(() => {
 *       const user = data.value;
 *       if (user) {
 *         console.log('User loaded:', user.name);
 *       }
 *     });
 *   }
 * }
 * ```
 */
export function useRouteData<T = unknown>(component: Component): Signal<T> {
  return fromRouter(
    component,
    ROUTE_DATA_KEY,
    (router) => router.data as Signal<T>
  );
}

/**
 * Get the navigation state for the component's application.
 *
 * Returns the signal that says whether navigation is in progress.
 * Useful for showing loading indicators during route transitions.
 *
 * @param component - The component requesting the state
 * @returns Signal for the navigation state
 * @throws If no router is installed for the app
 *
 * @example
 * ```typescript
 * class AppLayout extends Component {
 *   protected setup() {
 *     const isNavigating = useIsNavigating(this);
 *
 *     effect(() => {
 *       if (isNavigating.value) {
 *         this.showLoadingBar();
 *       } else {
 *         this.hideLoadingBar();
 *       }
 *     });
 *   }
 * }
 * ```
 */
export function useIsNavigating(component: Component): Signal<boolean> {
  const router = useRouter(component);
  return router.isNavigating;
}
