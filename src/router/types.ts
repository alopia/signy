/**
 * Router Type Definitions
 *
 * Type definitions for the Signy router module including route configuration,
 * navigation state, guards, and loaders.
 *
 * @module router/types
 */

import type { ComponentClass } from '../types';

//=============================================
// Route Configuration Types
//=============================================

/**
 * Route parameters extracted from path
 */
export type RouteParams = Record<string, string>;

type Simplify<T> = { [K in keyof T]: T[K] } & {};

type SegmentParams<Segment extends string> = Segment extends `:${infer Name}?`
  ? { [K in Name]?: string }
  : Segment extends `:${infer Name}`
    ? { [K in Name]: string }
    : Segment extends `*${infer Name}`
      ? { [K in Name extends '' ? '*' : Name]?: string }
      : unknown;

type PathSegmentsParams<Path extends string> =
  Path extends `${infer Head}/${infer Tail}`
    ? SegmentParams<Head> & PathSegmentsParams<Tail>
    : SegmentParams<Path>;

/**
 * The params of a path pattern, read from the string: `:id` is required,
 * `:id?` and a wildcard are optional. A path that is not a literal gives
 * `RouteParams`.
 *
 * @example
 * ```typescript
 * type P = PathParams<'/users/:id/posts/:postId?'>;
 * // { id: string; postId?: string }
 * ```
 */
export type PathParams<Path extends string> = string extends Path
  ? RouteParams
  : Simplify<PathSegmentsParams<Path>>;

/**
 * Query string parameters
 */
export type QueryParams = Record<string, string | string[] | undefined>;

/**
 * Route meta information (user-defined)
 */
export type RouteMeta = Record<string, unknown>;
import type { LazyRouteComponent } from './lazy-route';

/**
 * Component definition - class or lazy route component
 */
export type RouteComponent = ComponentClass | LazyRouteComponent;

/**
 * Route loader context passed to loader functions
 */
export interface RouteLoaderContext<P = RouteParams> {
  /** Route parameters */
  params: P;
  /** Query parameters */
  query: QueryParams;
  /** Current URL */
  url: URL;
  /** AbortSignal for cancellation */
  signal: AbortSignal;
}

/**
 * Route loader function - fetches data before rendering
 */
export type RouteLoader<T = unknown, P = RouteParams> = (
  context: RouteLoaderContext<P>
) => Promise<T> | T;

/**
 * What the loader of the current route is doing. `loading` only for a route
 * with a `pending` component, `error` only for one with an `error` component.
 */
export type LoaderState = 'ready' | 'loading' | 'error';

/**
 * Navigation guard return type
 */
export type NavigationGuardReturn = boolean | string | NavigationTarget | void;

/**
 * Navigation guard context
 */
export interface NavigationGuardContext {
  /** Route being navigated to */
  to: ResolvedRoute;
  /** Route being navigated from (null on initial navigation) */
  from: ResolvedRoute | null;
  /** Current route params */
  params: RouteParams;
  /** Current query params */
  query: QueryParams;
}

/**
 * Navigation guard function
 */
export type NavigationGuard = (
  context: NavigationGuardContext
) => NavigationGuardReturn | Promise<NavigationGuardReturn>;

/**
 * Route configuration object
 */
export interface RouteConfig {
  /** Route path pattern (e.g., '/users/:id') */
  path: string;

  /** Component to render for this route */
  component?: RouteComponent;

  /** Child routes (for nested routing) */
  children?: RouteConfig[];

  /** Redirect target (string path or function) */
  redirect?: string | ((to: ResolvedRoute) => string);

  /**
   * Other paths that render this route. The address bar keeps the alias, and
   * `name` and `Link` still build the main path. Relative to the parent, like
   * `path`.
   */
  alias?: string | string[];

  /** Route name for programmatic navigation */
  name?: string;

  /** Route metadata (available in guards and components) */
  meta?: RouteMeta;

  /** Data loader function */
  loader?: RouteLoader;

  /**
   * Shown in place of the component while the loader runs. A route with one
   * is committed before its data arrives: the address changes and the layouts
   * stay, and the old page does not wait for the loader. Gets `params` and
   * `query`.
   */
  pending?: ComponentClass;

  /**
   * Shown in place of the component when the loader throws. Gets `params`,
   * `query`, the `error` and `retry()`, which runs the loader again.
   */
  error?: ComponentClass;

  /** Navigation guards for this route */
  guards?: NavigationGuard[];
}

/**
 * Route configuration with the path as a literal, so the loader gets typed
 * params. See `defineRoute()`.
 */
export interface TypedRouteConfig<
  Path extends string,
  Data = unknown,
> extends Omit<RouteConfig, 'path' | 'loader'> {
  path: Path;
  loader?: RouteLoader<Data, PathParams<Path>>;
}

/**
 * Compiled route with matcher
 */
export interface CompiledRoute {
  /** Original route config */
  config: RouteConfig;
  /** Parameter names in path */
  paramNames: string[];
  /** Regex for matching */
  regex: RegExp;
  /** Regex matching the start of a path, for parent routes of nested ones */
  prefixRegex: RegExp;
  /** Score for sorting (more specific = higher) */
  score: number;
  /** Parent route (for nested routes) */
  parent?: CompiledRoute;
  /** Full path (including parent paths) */
  fullPath: string;
  /** Matches an alias path, not the main one */
  isAlias?: boolean;
}

/**
 * Matched route segment
 */
export interface MatchedRoute {
  /** The route config */
  route: CompiledRoute;
  /** Extracted parameters */
  params: RouteParams;
  /** Loaded data (if loader exists) */
  data?: unknown;
}

/**
 * Fully resolved route (after matching)
 */
export interface ResolvedRoute {
  /** Full path */
  path: string;
  /** Matched route segments (for nested routes) */
  matched: MatchedRoute[];
  /** Combined parameters from all matched routes */
  params: RouteParams;
  /** Query parameters */
  query: QueryParams;
  /** Hash fragment (without #) */
  hash: string;
  /** Full URL */
  fullPath: string;
  /** Route name (if defined) */
  name?: string;
  /** Combined meta from all matched routes */
  meta: RouteMeta;
  /** Redirect target (if this route redirects) */
  redirectedFrom?: ResolvedRoute;
}

//=============================================
// Navigation Types
//=============================================

/**
 * Navigation target (for programmatic navigation)
 */
export interface NavigationTarget {
  /** Path to navigate to */
  path?: string;
  /** Route name to navigate to */
  name?: string;
  /** Route parameters */
  params?: RouteParams;
  /** Query parameters */
  query?: QueryParams;
  /** Hash fragment */
  hash?: string;
  /** Replace current entry instead of pushing */
  replace?: boolean;
  /** State to store in history */
  state?: unknown;
}

/**
 * Navigation options
 */
export interface NavigateOptions {
  /** Replace current entry instead of pushing */
  replace?: boolean;
  /** State to store in history */
  state?: unknown;
  /** Force navigation even if path is same */
  force?: boolean;
  /** Internal: navigation originated from history listener (don't push to history again) */
  _fromHistory?: boolean;
  /** Internal: how many entries a back or forward moved, 0 when unknown */
  _delta?: number;
  /** Internal: redirects followed to get here */
  _redirects?: number;
}

/**
 * Navigation failure reasons
 */
export enum NavigationFailureType {
  /** Navigation was cancelled by a guard */
  CANCELLED = 'cancelled',
  /** Navigation was aborted (new navigation started) */
  ABORTED = 'aborted',
  /** Navigation target was not found */
  NOT_FOUND = 'not_found',
  /** Navigation was redirected */
  REDIRECTED = 'redirected',
}

/**
 * Navigation failure error
 */
export interface NavigationFailure {
  /** Failure type */
  type: NavigationFailureType;
  /** Target route */
  to: ResolvedRoute;
  /** Source route */
  from: ResolvedRoute | null;
  /** Error message */
  message: string;
}

//=============================================
// Router Types
//=============================================

/**
 * History mode
 */
export type HistoryMode = 'history' | 'hash' | 'memory';

/**
 * Router isolation mode for micro frontend support.
 *
 * - `'shared'`: (Default) Uses browser history, coordinates via base path.
 *   Multiple routers can coexist, each responding to their own base path.
 *   URL changes are visible in the browser address bar.
 *
 * - `'isolated'`: Uses memory history, completely isolated from browser URL.
 *   Perfect for widgets or embedded micro frontends that shouldn't affect
 *   the main app's URL. No URL changes visible in browser.
 *
 * - `'shadow'`: Uses hash-based routing scoped to this router.
 *   URL changes are visible as hash fragments (e.g., #/widget/path).
 *   Useful when you need visible URLs but can't configure server routing.
 */
export type IsolationMode = 'shared' | 'isolated' | 'shadow';

/**
 * Router configuration options
 */
export interface RouterOptions {
  /** Route definitions */
  routes: RouteConfig[];
  /** History mode (default: 'history'). Overridden by isolation mode if set. */
  mode?: HistoryMode;
  /** Base URL for the app (default: '/') */
  base?: string;
  /**
   * Isolation mode for micro frontend support.
   *
   * - `'shared'`: (Default) Uses browser history with base path filtering
   * - `'isolated'`: Uses memory history, no URL changes (for widgets)
   * - `'shadow'`: Uses hash-based routing (for visible but isolated URLs)
   *
   * When set, this overrides the `mode` option.
   */
  isolation?: IsolationMode;
  /** Scroll behavior on navigation */
  scrollBehavior?: ScrollBehavior;
  /** Whether to parse query strings (default: true) */
  parseQuery?: boolean;
  /** Initial entries for memory mode */
  initialEntries?: string[];
  /** Initial index for memory mode */
  initialIndex?: number;
}

/**
 * Scroll behavior configuration
 */
export type ScrollBehavior = (
  to: ResolvedRoute,
  from: ResolvedRoute | null,
  savedPosition: ScrollPosition | null
) => ScrollPosition | Promise<ScrollPosition> | void;

/**
 * Scroll position
 */
export interface ScrollPosition {
  left?: number;
  top?: number;
  el?: string | Element;
  behavior?: 'auto' | 'smooth';
}

//=============================================
// Hook Types
//=============================================

/**
 * Navigation hook (called after navigation)
 */
export type NavigationHook = (
  to: ResolvedRoute,
  from: ResolvedRoute | null,
  failure?: NavigationFailure
) => void;

//=============================================
// Injection Keys
//=============================================

/**
 * Injection key for Router instance
 */
export const ROUTER_KEY = Symbol('signy-router');

/**
 * Injection key for current route
 */
export const ROUTE_KEY = Symbol('signy-route');

/**
 * Injection key for route data (loader result)
 */
export const ROUTE_DATA_KEY = Symbol('signy-route-data');

/**
 * Injection key for route params
 */
export const ROUTE_PARAMS_KEY = Symbol('signy-route-params');

/**
 * Injection key for route query
 */
export const ROUTE_QUERY_KEY = Symbol('signy-route-query');

/**
 * Injection key for outlet depth level
 */
export const OUTLET_DEPTH_KEY = Symbol('signy-outlet-depth');
