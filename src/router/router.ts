/**
 * Router Class
 *
 * The main Router class that manages navigation, route matching, guards,
 * and data loading. Integrates with Signy's reactivity system for
 * automatic UI updates on navigation.
 *
 * **Micro Frontend Support**: Each router can be configured with a `base` path.
 * The router will only respond to URLs that start with its base path, enabling
 * multiple independent routers on the same page.
 *
 * @module router/router
 *
 * @example
 * ```typescript
 * import { Router, application } from 'signy';
 *
 * const routes = [
 *   { path: '/', component: HomePage },
 *   { path: '/users/:id', component: UserDetail, loader: fetchUser },
 *   { path: '*', component: NotFound },
 * ];
 *
 * const router = new Router({ routes });
 *
 * const app = application(AppComponent);
 * app.use(router);
 * app.mount('#app');
 *
 * // Programmatic navigation
 * router.push('/users/123');
 * router.replace('/users/456');
 * router.back();
 *
 * // Access reactive state
 * console.log(router.route.value.path);
 * console.log(router.params.value.id);
 * ```
 *
 * @example
 * ```typescript
 * // Micro frontend setup - multiple routers with different bases
 * const mainRouter = router({ routes: mainRoutes, base: '/' });
 * const widgetRouter = router({ routes: widgetRoutes, base: '/widget' });
 *
 * const mainApp = application(MainComponent);
 * mainApp.use(mainRouter);
 * mainApp.mount('#main');
 *
 * const widgetApp = application(WidgetComponent);
 * widgetApp.use(widgetRouter);
 * widgetApp.mount('#widget');
 *
 * // Each router only responds to its own paths
 * mainRouter.push('/about');     // mainRouter handles this
 * widgetRouter.push('/settings'); // Navigates to /widget/settings
 * ```
 *
 * ## Known limitations
 *
 * None.
 */

import type {
  RouteConfig,
  CompiledRoute,
  ResolvedRoute,
  RouteParams,
  QueryParams,
  NavigationTarget,
  NavigateOptions,
  NavigationGuard,
  NavigationGuardContext,
  NavigationHook,
  NavigationFailure,
  RouterOptions,
  RouteLoaderContext,
  IsolationMode,
  LoaderState,
} from './types';
import {
  NavigationFailureType,
  ROUTER_KEY,
  ROUTE_KEY,
  ROUTE_DATA_KEY,
  ROUTE_PARAMS_KEY,
  ROUTE_QUERY_KEY,
} from './types';
import { createHistory, type History, type Location } from './history';
import {
  compileRoutes,
  resolvePath,
  generatePath,
  targetToPath,
  isExternalHref,
} from './route';
import { isLazyRouteComponent } from './lazy-route';
import { ScrollManager } from './scroll';
import { Signal, batch } from '../reactivity';
import { logger, SignyError } from '../log';
import { RouterLogMessages } from './log-messages';
import { setBounded } from '../utils/bounded-cache';
import type { Unsubscribe } from '../types/common';
import type { Application } from '../app/application';

//=============================================
// Types
//=============================================

/**
 * Router ready state
 */
export type RouterState = 'created' | 'ready' | 'navigating' | 'error';

/** Redirects one navigation may follow before it gives up */
const MAX_REDIRECTS = 10;

/** How long a prefetched result waits for a navigation to take it */
const PREFETCH_TTL_MS = 30_000;

/** Prefetched results kept at once, the oldest goes first */
const PREFETCH_LIMIT = 20;

/** A loader started by prefetch(), taken by the next navigation to its path */
interface PrefetchEntry {
  result: Promise<unknown>;
  time: number;
}

/** Thrown past MAX_REDIRECTS, so push() and replace() reject with it */
class RedirectLoopError extends SignyError {}

/**
 * Create empty resolved route for initial state
 */
function createEmptyRoute(): ResolvedRoute {
  return {
    path: '/',
    matched: [],
    params: {},
    query: {},
    hash: '',
    fullPath: '/',
    meta: {},
  };
}

//=============================================
// Router Class
//=============================================

/**
 * Main router class for managing navigation and route matching.
 *
 * The router is reactive - route state changes automatically trigger
 * UI updates in components that access `router.route.value` or inject
 * route-related values.
 *
 * @example
 * ```typescript
 * const appRouter = new Router({
 *   routes: [
 *     { path: '/', component: Home },
 *     { path: '/about', component: About },
 *   ],
 *   mode: 'history',
 *   base: '/app',
 * });
 *
 * // Navigation
 * await appRouter.push('/about');
 *
 * // Access state reactively
 * effect(() => {
 *   console.log('Current path:', appRouter.route.value.path);
 * });
 * ```
 */
export class Router {
  //=============================================
  // Private Fields
  //=============================================

  /** Compiled route definitions */
  private _compiledRoutes: CompiledRoute[];

  /** History instance */
  private _history: History;

  /** Router options */
  private readonly _options: RouterOptions;

  /** Current resolved route */
  private _route: Signal<ResolvedRoute>;

  /** Current route params (convenience accessor) */
  private _params: Signal<RouteParams>;

  /** Current query params (convenience accessor) */
  private _query: Signal<QueryParams>;

  /** Navigation state */
  private _isNavigating: Signal<boolean>;

  /** Router ready state */
  private _state: RouterState = 'created';

  /** Navigation guards */
  private _beforeGuards: Set<NavigationGuard> = new Set();
  private _afterHooks: Set<NavigationHook> = new Set();

  /** Pending navigation (for cancellation) */
  private _pendingNavigation: AbortController | null = null;

  /** Current route data (from loaders) */
  private _routeData: Signal<unknown>;

  /** What the loader of the current route is doing */
  private _loaderState: Signal<LoaderState>;

  /** Why the loader of the current route failed, while its state is 'error' */
  private _loaderError: Signal<unknown>;

  /** A running revalidate(), aborted by the next navigation or revalidate() */
  private _revalidation: AbortController | null = null;

  /** Results of prefetch(), by full path */
  private _prefetched = new Map<string, PrefetchEntry>();

  /** Flag to ignore history listener during programmatic navigation */
  private _skipHistoryCallback: boolean = false;

  /** Path of the pop caused by stepping back after a cancelled back or forward */
  private _ignorePop: string | undefined;

  /**
   * The first navigation runs guards, redirects and loaders on the next
   * microtask, so guards added right after router() apply to it. 'open'
   * until then, 'queued' once it is scheduled, 'done' after.
   */
  private _firstNavigation: 'open' | 'queued' | 'done' = 'open';

  /** Scroll position manager */
  private _scrollManager: ScrollManager;

  //=============================================
  // Constructor
  //=============================================

  /**
   * Creates a new Router instance.
   *
   * @param options - Router configuration
   */
  constructor(options: RouterOptions) {
    // Determine effective history mode based on isolation setting
    const isolation = options.isolation ?? 'shared';
    let effectiveMode = options.mode ?? 'history';

    // Isolation mode overrides explicit mode setting
    if (isolation === 'isolated') {
      effectiveMode = 'memory';
    } else if (isolation === 'shadow') {
      effectiveMode = 'hash';
    }

    this._options = {
      base: '/',
      parseQuery: true,
      ...options,
      // Ensure mode and isolation are set to effective values
      mode: effectiveMode,
      isolation,
    };

    // Compile routes
    this._compiledRoutes = compileRoutes(options.routes);

    // Create history
    const historyOptions = {
      base: this._options.base,
      initialEntries: this._options.initialEntries,
      initialIndex: this._options.initialIndex,
    };

    this._history = createHistory(
      this._options.mode || 'history',
      historyOptions
    );

    // An unguarded first route resolves synchronously, so it is available as
    // soon as components render. One with guards, a redirect or a loader shows
    // nothing until its first navigation has run them.
    const initialLocation = this._history.location.value;
    const initialRoute = this._isOwnPath()
      ? resolvePath(initialLocation.fullPath, this._compiledRoutes) ||
        createEmptyRoute()
      : createEmptyRoute();
    const firstNavigationNeeded = initialRoute.matched.some(
      (m) =>
        m.route.config.guards?.length ||
        m.route.config.loader ||
        m.route.config.redirect
    );

    // Initialize reactive state with the resolved initial route
    this._route = new Signal<ResolvedRoute>(initialRoute);
    this._params = new Signal<RouteParams>(initialRoute.params);
    this._query = new Signal<QueryParams>(initialRoute.query);
    this._isNavigating = new Signal<boolean>(false);
    this._routeData = new Signal<unknown>(undefined);
    this._loaderState = new Signal<LoaderState>('ready');
    this._loaderError = new Signal<unknown>(undefined);

    // Initialize scroll manager
    const ownsWindow = this._options.mode !== 'memory';
    this._scrollManager = new ScrollManager(
      this._options.scrollBehavior,
      {
        storageKey: `${this._options.mode}:${this._options.base}`,
        // A memory router's position keys are counters, stale after a reload
        persistPositions: ownsWindow,
      },
      ownsWindow
    );

    // Listen to history changes (for browser back/forward)
    this._history.listen((location, _action, delta) => {
      // Skip if this is a callback from our own programmatic navigation
      if (this._skipHistoryCallback) {
        return;
      }

      // A different pop first means the user moved on, so handle it
      const ignore = this._ignorePop;
      this._ignorePop = undefined;
      if (location.fullPath === ignore) return;

      // For micro frontends: only handle paths under our base
      // This prevents multiple routers from all responding to the same navigation
      if (!this._isOwnPath()) {
        return;
      }

      this._handleLocationChange(location, delta);
    });

    if (firstNavigationNeeded) {
      this._queueFirstNavigation();
    }
    // Guards added after this microtask apply from the next navigation on
    queueMicrotask(() => {
      if (this._firstNavigation === 'open') this._firstNavigation = 'done';
    });
    this._state = 'ready';
  }

  /**
   * Check if the current browser URL belongs to this router's base path.
   * Used for micro frontend isolation - routers only respond to their own paths.
   *
   * @returns True if the current URL starts with this router's base path
   */
  private _isOwnPath(): boolean {
    const isolation = this._options.isolation ?? 'shared';

    // Isolated mode (memory history) always owns its paths - no URL sharing
    if (isolation === 'isolated' || this._options.mode === 'memory') {
      return true;
    }

    // Shadow mode (hash history) - check hash fragment instead of pathname
    if (isolation === 'shadow') {
      // In shadow mode, we own all hash-based navigation
      return true;
    }

    // Shared mode - check base path filtering
    const base = this._options.base || '/';

    // Root base always owns all paths
    if (base === '/') {
      return true;
    }

    // Check if browser pathname starts with our base
    const pathname =
      typeof window !== 'undefined' ? window.location.pathname : '/';
    return pathname === base || pathname.startsWith(base + '/');
  }

  //=============================================
  // Getters
  //=============================================

  /**
   * Current resolved route (reactive).
   */
  get route(): Signal<ResolvedRoute> {
    return this._route;
  }

  /**
   * Current route params (reactive convenience accessor).
   */
  get params(): Signal<RouteParams> {
    return this._params;
  }

  /**
   * Current query params (reactive convenience accessor).
   */
  get query(): Signal<QueryParams> {
    return this._query;
  }

  /**
   * Whether navigation is in progress (reactive).
   */
  get isNavigating(): Signal<boolean> {
    return this._isNavigating;
  }

  /**
   * Current route data from loaders (reactive).
   */
  get data(): Signal<unknown> {
    return this._routeData;
  }

  /**
   * What the loader of the current route is doing (reactive): `loading` while
   * a route with a `pending` component loads, `error` after a route with an
   * `error` component failed, `ready` otherwise.
   */
  get loaderState(): Signal<LoaderState> {
    return this._loaderState;
  }

  /**
   * The error of the failed loader, while `loaderState` is `error` (reactive).
   */
  get loaderError(): Signal<unknown> {
    return this._loaderError;
  }

  /**
   * Router state.
   */
  get state(): RouterState {
    return this._state;
  }

  /**
   * History instance.
   */
  get history(): History {
    return this._history;
  }

  /**
   * Router options.
   */
  get options(): Readonly<RouterOptions> {
    return this._options;
  }

  /**
   * Current isolation mode.
   * Useful for debugging or conditional logic based on router isolation.
   */
  get isolation(): IsolationMode {
    return this._options.isolation ?? 'shared';
  }

  //=============================================
  // Navigation Methods
  //=============================================

  /**
   * Navigate to a new URL (adds to history).
   *
   * @param to - Path string or navigation target
   * @param options - Navigation options
   * @returns Promise that resolves when navigation completes
   *
   * @example
   * ```typescript
   * // Simple path
   * await router.push('/users/123');
   *
   * // With query
   * await router.push('/search?q=hello');
   *
   * // Navigation target object
   * await router.push({
   *   path: '/users',
   *   query: { filter: 'active' },
   * });
   *
   * // By route name
   * await router.push({
   *   name: 'user-detail',
   *   params: { id: '123' },
   * });
   * ```
   */
  async push(
    to: string | NavigationTarget,
    options?: NavigateOptions
  ): Promise<void> {
    const path = this.toPath(to);
    await this._navigate(path, { ...options, replace: false });
  }

  /**
   * Navigate to a new URL (replaces current entry).
   *
   * @param to - Path string or navigation target
   * @param options - Navigation options
   * @returns Promise that resolves when navigation completes
   */
  async replace(
    to: string | NavigationTarget,
    options?: NavigateOptions
  ): Promise<void> {
    const path = this.toPath(to);
    await this._navigate(path, { ...options, replace: true });
  }

  /**
   * Go back in history.
   */
  back(): void {
    this._history.back();
  }

  /**
   * Go forward in history.
   */
  forward(): void {
    this._history.forward();
  }

  /**
   * Go to a specific point in history.
   *
   * @param delta - Number of steps (negative = back, positive = forward)
   */
  go(delta: number): void {
    this._history.go(delta);
  }

  //=============================================
  // Guards and Hooks
  //=============================================

  /**
   * Register a navigation guard (called before navigation).
   *
   * Guards can:
   * - Return `true` to allow navigation
   * - Return `false` to cancel navigation
   * - Return a path string to redirect
   * - Return a NavigationTarget to redirect with params
   *
   * @param guard - Guard function
   * @returns Unsubscribe function
   *
   * @example
   * ```typescript
   * // Auth guard
   * router.beforeEach(({ to }) => {
   *   if (to.meta.requiresAuth && !isAuthenticated()) {
   *     return '/login';
   *   }
   *   return true;
   * });
   * ```
   */
  beforeEach(guard: NavigationGuard): Unsubscribe {
    this._beforeGuards.add(guard);
    // A guard added right after router() also checks the first route
    this._queueFirstNavigation();
    return () => this._beforeGuards.delete(guard);
  }

  /**
   * Register a navigation hook (called after navigation).
   *
   * @param hook - Hook function
   * @returns Unsubscribe function
   *
   * @example
   * ```typescript
   * router.afterEach((to, from) => {
   *   document.title = to.meta.title || 'My App';
   * });
   * ```
   */
  afterEach(hook: NavigationHook): Unsubscribe {
    this._afterHooks.add(hook);
    return () => this._afterHooks.delete(hook);
  }

  //=============================================
  // Resolution Methods
  //=============================================

  /**
   * Resolve a path or navigation target to a ResolvedRoute.
   *
   * @param to - Path or navigation target
   * @returns Resolved route or null
   *
   * @example
   * ```typescript
   * const resolved = router.resolve('/users/123');
   * console.log(resolved?.params.id); // '123'
   * ```
   */
  resolve(to: string | NavigationTarget): ResolvedRoute | null {
    const path = this.toPath(to);
    return resolvePath(path, this._compiledRoutes);
  }

  /**
   * Check if a path matches a route.
   *
   * @param path - Path to check
   * @returns Whether the path matches any route
   */
  hasRoute(path: string): boolean {
    return this.resolve(path) !== null;
  }

  /**
   * Get all registered routes.
   *
   * @returns Array of route configs
   */
  getRoutes(): RouteConfig[] {
    return this._options.routes;
  }

  /**
   * Turns a path or navigation target into a path, named routes included.
   * The base is not added, see createHref().
   *
   * @param to - Path or navigation target
   * @returns The path, with query and hash
   */
  toPath(to: string | NavigationTarget): string {
    if (typeof to !== 'string' && to.name) {
      const route = this._compiledRoutes.find(
        (r) => r.config.name === to.name && !r.isAlias
      );
      if (route) {
        return targetToPath({
          ...to,
          path: generatePath(route.fullPath, to.params || {}),
        });
      }
      logger.warn(RouterLogMessages.ROUTE_NOT_FOUND, { name: to.name });
    }
    return targetToPath(to);
  }

  /**
   * Create a URL href from a path (includes base).
   *
   * @param path - Path to create href for
   * @returns Full href
   */
  createHref(path: string): string {
    return this._history.createHref(path);
  }

  //=============================================
  // Plugin Interface
  //=============================================

  /**
   * Install the router into an application.
   * Called by `app.use(router)`.
   *
   * Registers the router and its reactive state as app-level providers,
   * making them available to all components in the app via inject().
   *
   * For micro-frontends: Each app can have its own router installed,
   * and components will automatically use their app's router.
   *
   * @param app - Application instance to install router into
   *
   * @example
   * ```typescript
   * const r = router({ routes });
   * const app = application(AppComponent);
   * app.use(r); // Router now available to all components
   * app.mount('#app');
   *
   * // In any component:
   * const router = this.inject(ROUTER_KEY);
   * const route = this.inject(ROUTE_KEY);
   * ```
   */
  install(app: Application): () => void {
    // Provide router instance
    app.provide(ROUTER_KEY, this);

    // Provide reactive route state
    app.provide(ROUTE_KEY, this._route);
    app.provide(ROUTE_PARAMS_KEY, this._params);
    app.provide(ROUTE_QUERY_KEY, this._query);
    app.provide(ROUTE_DATA_KEY, this._routeData);

    // Unmounting the app stops the router listening to the history
    return () => this.destroy();
  }

  /**
   * Runs the loader of the current route again and replaces its data, without
   * navigating. The page keeps showing the old data until the new data is
   * there, and keeps it when the loader fails, unless the route has an `error`
   * component. A navigation that starts meanwhile cancels it.
   *
   * @example
   * ```typescript
   * await api.deleteUser(id);
   * await router.revalidate();
   * ```
   */
  async revalidate(): Promise<void> {
    const route = this._route.value;
    const config = route.matched[route.matched.length - 1]?.route.config;
    if (!config?.loader) return;

    this._revalidation?.abort();
    const controller = new AbortController();
    this._revalidation = controller;
    // Retrying after a failure shows the pending component, if there is one
    if (this._loaderState.value === 'error' && config.pending) {
      this._loaderState.value = 'loading';
    }

    // A navigation or a newer revalidate() took over
    const current = (): boolean =>
      !controller.signal.aborted && this._route.value === route;

    try {
      const data = await config.loader(
        this._loaderContext(route, controller.signal)
      );
      if (!current()) return;
      batch(() => {
        this._routeData.value = data;
        this._loaderError.value = undefined;
        this._loaderState.value = 'ready';
      });
    } catch (error) {
      if (!current()) return;
      logger.error(RouterLogMessages.LOADER_FAILED, { error });
      batch(() => {
        this._loaderError.value = config.error ? error : undefined;
        this._loaderState.value = config.error ? 'error' : 'ready';
      });
    } finally {
      if (this._revalidation === controller) this._revalidation = null;
    }
  }

  /**
   * Gets a route ready before the user goes there: loads its lazy components
   * and starts its loader. The next navigation to the same path takes the
   * result instead of loading again, and an untaken result is dropped after
   * 30 seconds. A failure is not kept, the navigation loads again and shows
   * the error. Guards do not run for a prefetch.
   *
   * @param to - Path or navigation target
   *
   * @example
   * ```typescript
   * link.addEventListener('mouseenter', () => router.prefetch('/reports'));
   * ```
   */
  async prefetch(to: string | NavigationTarget): Promise<void> {
    const path = this.toPath(to);
    if (isExternalHref(path)) return;
    const resolved = resolvePath(path, this._compiledRoutes);
    if (!resolved) return;

    const loads: Promise<unknown>[] = [];
    for (const { route } of resolved.matched) {
      const component = route.config.component;
      if (isLazyRouteComponent(component)) loads.push(component.preload());
    }

    const loader =
      resolved.matched[resolved.matched.length - 1]?.route.config.loader;
    const fresh = this._prefetched.get(resolved.fullPath);
    if (loader && (!fresh || Date.now() - fresh.time > PREFETCH_TTL_MS)) {
      const context = this._loaderContext(
        resolved,
        new AbortController().signal
      );
      const result = new Promise<unknown>((resolve) =>
        resolve(loader(context))
      );
      setBounded(
        this._prefetched,
        resolved.fullPath,
        { result, time: Date.now() },
        PREFETCH_LIMIT
      );
      // The navigation reports a failure, here it only drops the entry
      result.catch(() => {
        if (this._prefetched.get(resolved.fullPath)?.result === result) {
          this._prefetched.delete(resolved.fullPath);
        }
      });
      loads.push(result);
    }

    await Promise.allSettled(loads);
  }

  //=============================================
  // Private Methods
  //=============================================

  private _loaderContext(
    to: ResolvedRoute,
    signal: AbortSignal
  ): RouteLoaderContext {
    return {
      params: to.params,
      query: to.query,
      url: new URL(to.fullPath, 'http://localhost'),
      signal,
    };
  }

  /**
   * The result of a fresh prefetch for the path, taken out so it is used
   * once, or what `load` returns.
   */
  private _takePrefetched(
    fullPath: string,
    load: () => Promise<unknown> | unknown
  ): Promise<unknown> | unknown {
    const entry = this._prefetched.get(fullPath);
    this._prefetched.delete(fullPath);
    if (!entry || Date.now() - entry.time > PREFETCH_TTL_MS) return load();
    // A failed prefetch falls back to a real load, which reports the error
    return entry.result.catch(load);
  }

  /**
   * Schedules the first navigation, with guards, redirects and loaders, and
   * shows no route until it is done. Does nothing once it ran or was
   * replaced by an explicit navigation.
   */
  private _queueFirstNavigation(): void {
    if (this._firstNavigation !== 'open' || !this._isOwnPath()) return;
    const location = this._history.location.value;
    if (!resolvePath(location.fullPath, this._compiledRoutes)) return;
    this._firstNavigation = 'queued';
    const empty = createEmptyRoute();
    batch(() => {
      this._route.value = empty;
      this._params.value = empty.params;
      this._query.value = empty.query;
    });
    queueMicrotask(() => {
      // An explicit push() or replace() before now takes its place
      if (this._firstNavigation !== 'queued') return;
      this._firstNavigation = 'done';
      void this._navigate(this._history.location.value.fullPath, {
        replace: true,
        force: true,
      });
    });
  }

  /**
   * Puts the address back to the route on screen, after a guard cancelled a
   * back or forward move. Steps back when the distance is known, so the
   * entry that was left stays.
   */
  private _restoreLocation(route: ResolvedRoute, delta = 0): void {
    if (route.matched.length === 0) return;
    if (delta) {
      this._ignorePop = route.fullPath;
      this._history.go(-delta);
      return;
    }
    this._skipHistoryCallback = true;
    try {
      this._history.replace(route.fullPath);
    } finally {
      this._skipHistoryCallback = false;
    }
  }

  /**
   * Follows a guard redirect. After back or forward, a redirect to the route
   * already on screen only puts the address back.
   */
  private async _redirect(
    path: string,
    from: ResolvedRoute,
    options: NavigateOptions
  ): Promise<void> {
    const target = resolvePath(path, this._compiledRoutes);
    if (
      options._fromHistory &&
      from.matched.length > 0 &&
      target?.fullPath === from.fullPath
    ) {
      this._restoreLocation(from, options._delta);
      this._state = 'ready';
      return;
    }
    await this._navigate(path, {
      // Keeps push or replace. After back or forward the address already
      // moved, so a push keeps the entry the user went to.
      replace: !options._fromHistory && options.replace === true,
      _redirects: (options._redirects ?? 0) + 1,
    });
  }

  private _runAfterHooks(
    to: ResolvedRoute,
    from: ResolvedRoute | null,
    failure?: NavigationFailure
  ): void {
    for (const hook of this._afterHooks) {
      if (failure) hook(to, from, failure);
      else hook(to, from);
    }
  }

  /**
   * Handle location changes from history.
   * This is called when the browser back/forward buttons are used,
   * not when we programmatically navigate.
   */
  private async _handleLocationChange(
    location: Location,
    delta: number
  ): Promise<void> {
    await this._navigate(location.fullPath, {
      replace: true,
      _fromHistory: true,
      _delta: delta,
    });
  }

  /**
   * Perform navigation with guards and data loading.
   */
  private async _navigate(
    path: string,
    options: NavigateOptions = {}
  ): Promise<void> {
    // pushState() throws on another origin, and a javascript: URL must never
    // reach the address bar
    if (isExternalHref(path)) {
      logger.warn(RouterLogMessages.EXTERNAL_PATH, { path });
      return;
    }
    const redirects = options._redirects ?? 0;
    if (redirects > MAX_REDIRECTS) {
      throw new RedirectLoopError(RouterLogMessages.REDIRECT_LOOP, {
        path,
        redirects,
      });
    }

    // Cancel pending navigation
    if (this._pendingNavigation) {
      this._pendingNavigation.abort();
    }
    this._revalidation?.abort();
    // An explicit navigation before the queued first one takes its place
    if (this._firstNavigation === 'queued') {
      this._firstNavigation = 'done';
    }

    const abortController = new AbortController();
    this._pendingNavigation = abortController;

    try {
      this._isNavigating.value = true;
      this._state = 'navigating';

      // Resolve the new route
      const to = resolvePath(path, this._compiledRoutes);
      const from = this._route.value;

      if (!to) {
        // No matching route
        this._state = 'error';
        logger.warn(RouterLogMessages.NO_MATCH, { path });
        return;
      }

      // Check if path is the same
      // The empty route shown before the first navigation is never the same
      if (
        !options.force &&
        !options._fromHistory &&
        from.matched.length > 0 &&
        to.fullPath === from.fullPath
      ) {
        this._state = 'ready';
        return;
      }

      const fromRoute = from.matched.length > 0 ? from : null;
      // afterEach hooks learn about a navigation that did not happen too
      const fail = (type: NavigationFailureType, message: string): void =>
        this._runAfterHooks(to, fromRoute, {
          type,
          to,
          from: fromRoute,
          message,
        });
      const aborted = (): void =>
        fail(NavigationFailureType.ABORTED, 'A newer navigation started');

      // Save current scroll position before navigating away
      if (from.matched.length > 0) {
        this._scrollManager.savePosition();
      }

      // Guards run for every navigation, the first one and back and forward included
      const guardContext: NavigationGuardContext = {
        to,
        from: fromRoute,
        params: to.params,
        query: to.query,
      };
      const guards = [
        ...this._beforeGuards,
        ...to.matched.flatMap((matched) => matched.route.config.guards ?? []),
      ];

      for (const guard of guards) {
        if (abortController.signal.aborted) return aborted();

        const result = await guard(guardContext);
        // A newer navigation took over while the guard ran
        if (abortController.signal.aborted) return aborted();

        if (result === false) {
          // Navigation cancelled. Back and forward already moved the address.
          if (options._fromHistory) this._restoreLocation(from, options._delta);
          this._state = 'ready';
          fail(
            NavigationFailureType.CANCELLED,
            'A guard cancelled the navigation'
          );
          return;
        }

        if (typeof result === 'string') {
          await this._redirect(result, from, options);
          return;
        }

        if (
          result &&
          typeof result === 'object' &&
          ('path' in result || 'name' in result)
        ) {
          await this._redirect(
            this.toPath(result as NavigationTarget),
            from,
            options
          );
          return;
        }
      }

      // Handle redirects
      const lastMatch = to.matched[to.matched.length - 1];
      if (lastMatch?.route.config.redirect) {
        const redirect = lastMatch.route.config.redirect;
        const redirectPath =
          typeof redirect === 'function' ? redirect(to) : redirect;
        await this._redirect(redirectPath, from, options);
        return;
      }

      // Load route data. A route with a pending component commits first and
      // loads after, any other waits for its loader.
      const config = lastMatch?.route.config;
      // Only the hash moved: the page and its data stay, a section link
      // does not load again
      const hashOnly =
        from.matched.length > 0 &&
        withoutHash(to.fullPath) === withoutHash(from.fullPath);
      const loader = hashOnly ? undefined : config?.loader;
      const early = !!(loader && config?.pending);
      let data: unknown = undefined;
      let failure = null as { error: unknown } | null;

      const load = async (): Promise<void> => {
        try {
          data = await this._takePrefetched(to.fullPath, () =>
            loader!(this._loaderContext(to, abortController.signal))
          );
        } catch (error) {
          if (abortController.signal.aborted) return;
          failure = { error };
          logger.error(RouterLogMessages.LOADER_FAILED, { error });
        }
      };

      if (loader && !early) {
        if (abortController.signal.aborted) return aborted();
        await load();
      }

      if (abortController.signal.aborted) return aborted();

      // Update history (if not from history listener - avoids double push)
      if (!options._fromHistory) {
        // Increment history key for new navigation
        this._scrollManager.incrementHistoryKey();

        // Set flag to ignore the listener callback for our own navigation
        this._skipHistoryCallback = true;
        try {
          if (options.replace) {
            this._history.replace(path);
          } else {
            this._history.push(path);
          }
        } finally {
          this._skipHistoryCallback = false;
        }
      }

      // Update state
      batch(() => {
        this._route.value = to;
        this._params.value = to.params;
        this._query.value = to.query;
        if (!hashOnly) {
          this._routeData.value = data;
          this._loaderError.value = failure?.error;
          this._loaderState.value = early
            ? 'loading'
            : failure && config?.error
              ? 'error'
              : 'ready';
        }
        if (!early) this._isNavigating.value = false;
      });

      this._state = 'ready';

      // Handle scroll restoration
      await this._scrollManager.handleScroll(
        to,
        from.matched.length > 0 ? from : null,
        options._fromHistory ?? false
      );

      this._runAfterHooks(to, fromRoute);

      if (early) {
        await load();
        // A newer navigation owns the state now
        if (abortController.signal.aborted) return;
        batch(() => {
          this._routeData.value = data;
          this._loaderError.value = failure?.error;
          this._loaderState.value =
            failure && config?.error ? 'error' : 'ready';
          this._isNavigating.value = false;
        });
      }
    } catch (error) {
      if (error instanceof RedirectLoopError) {
        this._state = 'error';
        throw error;
      }
      if (!abortController.signal.aborted) {
        this._state = 'error';
        logger.error(RouterLogMessages.NAVIGATION_ERROR, { error });
      }
    } finally {
      // A newer navigation owns the flag until it ends
      if (this._pendingNavigation === abortController) {
        this._pendingNavigation = null;
        this._isNavigating.value = false;
      }
    }
  }

  /**
   * Destroy the router and cleanup.
   */
  destroy(): void {
    this._history.destroy();
    this._beforeGuards.clear();
    this._afterHooks.clear();
    this._pendingNavigation?.abort();
    this._pendingNavigation = null;
    this._revalidation?.abort();
    this._revalidation = null;
    this._prefetched.clear();
    this._scrollManager.destroy();
  }
}

/** A full path without its hash */
function withoutHash(fullPath: string): string {
  const index = fullPath.indexOf('#');
  return index === -1 ? fullPath : fullPath.slice(0, index);
}

//=============================================
// Factory Function
//=============================================

/**
 * Creates a new Router instance.
 *
 * Factory function shorthand for `new Router(options)`.
 *
 * @param options - Router configuration
 * @returns Router instance
 *
 * @example
 * ```typescript
 * const r = router({
 *   routes: [
 *     { path: '/', component: Home },
 *     { path: '/about', component: About },
 *   ],
 * });
 *
 * app.use(r);
 * ```
 */
export function router(options: RouterOptions): Router {
  return new Router(options);
}

/**
 * Creates a memory-based router for testing.
 *
 * Factory function shorthand for `new Router({ ...options, mode: 'memory' })`.
 *
 * @param options - Router configuration
 * @returns Router instance
 *
 * @example
 * ```typescript
 * const r = memoryRouter({
 *   routes,
 *   initialEntries: ['/users/123'],
 * });
 *
 * expect(r.route.value.params.id).toBe('123');
 * ```
 */
export function memoryRouter(
  options: Omit<RouterOptions, 'mode'> & {
    initialEntries?: string[];
    initialIndex?: number;
  }
): Router {
  return new Router({
    ...options,
    mode: 'memory',
  });
}
