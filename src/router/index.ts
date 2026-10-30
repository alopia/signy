/**
 * Router Module
 *
 * Provides a complete routing solution for Signy applications with:
 * - Declarative route configuration
 * - Reactive route state (signals-based)
 * - Navigation guards (before/after hooks)
 * - Route data loading (loaders)
 * - Nested routes with `<Outlet>`
 * - Navigation components (`<Link>`, `<NavLink>`)
 * - Multiple history modes (browser, hash, memory)
 *
 * @module router
 *
 * @example
 * ```typescript
 * import {
 *   Router,
 *   router,
 *   Outlet,
 *   Link,
 * } from 'signy';
 *
 * // Define routes
 * const routes = [
 *   { path: '/', component: HomePage },
 *   {
 *     path: '/users',
 *     component: UsersLayout,
 *     children: [
 *       { path: '', component: UsersList },
 *       { path: ':id', component: UserDetail, loader: fetchUser },
 *     ],
 *   },
 *   { path: '*', component: NotFound },
 * ];
 *
 * // Create router
 * const appRouter = router({ routes });
 *
 * // Install in app
 * const app = application(AppComponent);
 * app.use(appRouter);
 * app.mount('#app');
 *
 * // In components
 * class AppComponent extends Component {
 *   protected render() {
 *     return html`
 *       <nav>
 *         <${Link} to="/">Home</${Link}>
 *         <${Link} to="/users">Users</${Link}>
 *       </nav>
 *       <${Outlet} />
 *     `;
 *   }
 * }
 * ```
 *
 * ## Known limitations
 *
 * **No named outlets**: Only a single Outlet per layout is supported.
 * Named outlets (multiple outlets per layout) will be added later.
 *
 * **No route transitions**: navigation does not run inside a transition.
 * Wrap your own slow writes in `startTransition()`.
 */

// Router class and factory
export { Router, router, memoryRouter, type RouterState } from './router';

// History
export {
  createHistory,
  createBrowserHistory,
  createHashHistory,
  createMemoryHistory,
  type History,
  type Location,
  type NavigationAction,
  type HistoryListener,
  type NavigationBlocker,
  type BrowserHistoryOptions,
  type HashHistoryOptions,
  type MemoryHistoryOptions,
} from './history';

// Route matching
export {
  compilePath,
  matchPath,
  compileRoutes,
  resolvePath,
  parseQuery,
  stringifyQuery,
  normalizePath,
  joinPaths,
  generatePath,
  defineRoute,
  type CompiledPath,
  type PathMatch,
} from './route';

// Components
export {
  Outlet,
  outlet,
  Link,
  RouterLink,
  NavLink,
  type OutletProps,
  type LinkProps,
} from './components';

// Composables
export {
  useRouter,
  useRoute,
  useParams,
  useQuery,
  useRouteData,
  useIsNavigating,
} from './composables';

// Types
export type {
  RouteConfig,
  TypedRouteConfig,
  PathParams,
  LoaderState,
  RouteParams,
  QueryParams,
  RouteMeta,
  RouteComponent,
  RouteLoader,
  RouteLoaderContext,
  NavigationGuard,
  NavigationGuardContext,
  NavigationGuardReturn,
  NavigationTarget,
  NavigateOptions,
  NavigationHook,
  NavigationFailure,
  RouterOptions,
  ScrollBehavior,
  ScrollPosition,
  CompiledRoute,
  MatchedRoute,
  ResolvedRoute,
  HistoryMode,
  IsolationMode,
} from './types';

// A value, so a hook can compare failure.type with it
export { NavigationFailureType } from './types';

// Injection keys
export {
  ROUTER_KEY,
  ROUTE_KEY,
  ROUTE_DATA_KEY,
  ROUTE_PARAMS_KEY,
  ROUTE_QUERY_KEY,
  OUTLET_DEPTH_KEY,
} from './types';

// Scroll restoration utilities
export {
  ScrollManager,
  scrollToTop,
  scrollRestore,
  scrollSmooth,
  scrollNone,
  createScrollBehavior,
  type ScrollRestorationOptions,
} from './scroll';

// Lazy route loading
export {
  lazyRoute,
  isLazyRouteComponent,
  preloadRoutes,
  type LazyRouteState,
  type LazyRouteComponent,
  type LazyRouteOptions,
  type ComponentModule,
  type RouteImporter,
} from './lazy-route';
export type { ComponentClass } from '../types';
