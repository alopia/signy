/**
 * History Abstraction Layer
 *
 * Provides a unified interface for different history implementations:
 * - BrowserHistory: Uses HTML5 History API (pushState)
 * - HashHistory: Uses URL hash fragment (#/path)
 * - MemoryHistory: In-memory for testing/SSR
 *
 * @module router/history
 *
 * @example
 * ```typescript
 * import { createBrowserHistory, createHashHistory, createMemoryHistory } from 'signy/router';
 *
 * // Browser history (production)
 * const history = createBrowserHistory({ base: '/app' });
 *
 * // Hash history (legacy browser support)
 * const history = createHashHistory();
 *
 * // Memory history (testing/SSR)
 * const history = createMemoryHistory({
 *   initialEntries: ['/home'],
 *   initialIndex: 0,
 * });
 *
 * // Navigate
 * history.push('/users/123');
 * history.replace('/users/456');
 * history.back();
 *
 * // Listen to changes
 * const unsubscribe = history.listen((location, action) => {
 *   console.log('Navigated to:', location.path);
 * });
 * ```
 *
 * ## Known limitations
 *
 * None.
 */

import { Signal } from '../reactivity';
import { normalizeEncoding } from './route';

//=============================================
// Types
//=============================================

/**
 * Navigation action type
 */
export type NavigationAction = 'push' | 'replace' | 'pop';

/**
 * Location object representing current URL state
 */
export interface Location {
  /** Path without query or hash */
  path: string;
  /** Query string (without leading ?) */
  search: string;
  /** Hash fragment (without leading #) */
  hash: string;
  /** Full path including search and hash */
  fullPath: string;
  /** History state object */
  state: unknown;
  /** Unique key for this entry */
  key: string;
}

/**
 * History listener callback. `delta` is how many entries a pop moved
 * (-1 for one step back), or 0 for push, replace and an entry of unknown
 * position.
 */
export type HistoryListener = (
  location: Location,
  action: NavigationAction,
  delta: number
) => void;

/**
 * History interface implemented by all history types
 */
export interface History {
  /** Current location as reactive signal */
  readonly location: Signal<Location>;

  /** Navigate to a new URL (adds to history) */
  push(path: string, state?: unknown): void;

  /** Navigate to a new URL (replaces current entry) */
  replace(path: string, state?: unknown): void;

  /** Go back in history */
  back(): void;

  /** Go forward in history */
  forward(): void;

  /** Go to a specific point in history */
  go(delta: number): void;

  /** Add a listener for navigation events */
  listen(listener: HistoryListener): () => void;

  /** Create a full URL from a path */
  createHref(path: string): string;

  /** Block navigation (returns unblock function) */
  block(blocker: NavigationBlocker): () => void;

  /** Destroy the history instance and cleanup */
  destroy(): void;
}

/**
 * Navigation blocker function
 */
export type NavigationBlocker = (
  location: Location,
  action: NavigationAction,
  retry: () => void
) => void;

/**
 * Options for browser history
 */
export interface BrowserHistoryOptions {
  /** Base path for the app (default: '/') */
  base?: string;
  /** Window object (for SSR) */
  window?: Window;
}

/**
 * Options for hash history
 */
export interface HashHistoryOptions {
  /** Base path for the app (default: '/') */
  base?: string;
  /** Window object (for SSR) */
  window?: Window;
}

/**
 * Options for memory history
 */
export interface MemoryHistoryOptions {
  /** Initial history entries */
  initialEntries?: string[];
  /** Initial index in history */
  initialIndex?: number;
}

//=============================================
// Utilities
//=============================================

/**
 * Generate a unique key for history entries
 */
function createKey(): string {
  return Math.random().toString(36).substring(2, 10);
}

/**
 * Parse a path into location parts
 */
function parsePath(path: string): Pick<Location, 'path' | 'search' | 'hash'> {
  let pathname = path;
  let search = '';
  let hash = '';

  const hashIndex = pathname.indexOf('#');
  if (hashIndex >= 0) {
    hash = pathname.substring(hashIndex + 1);
    pathname = pathname.substring(0, hashIndex);
  }

  const searchIndex = pathname.indexOf('?');
  if (searchIndex >= 0) {
    search = pathname.substring(searchIndex + 1);
    pathname = pathname.substring(0, searchIndex);
  }

  return { path: pathname || '/', search, hash };
}

/**
 * Create full path from parts
 */
function createFullPath(path: string, search: string, hash: string): string {
  let fullPath = path;
  if (search) fullPath += '?' + search;
  if (hash) fullPath += '#' + hash;
  return fullPath;
}

/**
 * Create a Location object
 */
function createLocation(
  path: string,
  state: unknown = null,
  key: string = createKey()
): Location {
  // The browser hands the path back encoded, push() gets it as written
  const parsed = parsePath(path);
  parsed.path = normalizeEncoding(parsed.path);
  return {
    ...parsed,
    fullPath: createFullPath(parsed.path, parsed.search, parsed.hash),
    state,
    key,
  };
}

/**
 * Removes the base from a path. A path outside the base stays as it is.
 */
function stripBase(path: string, base: string): string {
  if (base === '/') return path;
  if (path === base) return '/';
  return path.startsWith(base + '/') ? path.slice(base.length) : path;
}

/**
 * What every history type shares: listeners, blockers and the location
 * signal. The type supplies how to move between entries.
 */
function createHistoryCore(initial: Location) {
  const listeners = new Set<HistoryListener>();
  const blockers = new Set<NavigationBlocker>();
  const location = new Signal<Location>(initial);

  return {
    location,

    /** Asks the blockers. Navigation goes on only when there are none */
    allow(
      next: Location,
      action: NavigationAction,
      retry: () => void
    ): boolean {
      if (blockers.size === 0) return true;
      for (const blocker of blockers) blocker(next, action, retry);
      return false;
    },

    /** Sets the new location and notifies the listeners */
    commit(next: Location, action: NavigationAction, delta = 0): void {
      location.value = next;
      for (const listener of listeners) listener(next, action, delta);
    },

    /** The public object, from the moves of one history type */
    build(moves: {
      push(path: string, state?: unknown): void;
      replace(path: string, state?: unknown): void;
      go(delta: number): void;
      createHref(path: string): string;
      destroy?(): void;
    }): History {
      return {
        get location() {
          return location;
        },
        push: moves.push,
        replace: moves.replace,
        go: moves.go,
        back: () => moves.go(-1),
        forward: () => moves.go(1),
        createHref: moves.createHref,
        listen(listener: HistoryListener): () => void {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        block(blocker: NavigationBlocker): () => void {
          blockers.add(blocker);
          return () => blockers.delete(blocker);
        },
        destroy(): void {
          moves.destroy?.();
          listeners.clear();
          blockers.clear();
        },
      };
    },
  };
}

/**
 * Repeats a back or forward a blocker stopped, when its distance is known.
 */
function retryPop(win: Window, delta: number): void {
  if (delta) win.history.go(delta);
}

/**
 * Normalize base path
 */
function normalizeBase(base: string = '/'): string {
  // Ensure base starts with / and doesn't end with /
  if (!base.startsWith('/')) base = '/' + base;
  if (base.endsWith('/') && base.length > 1) base = base.slice(0, -1);
  return base;
}

//=============================================
// Browser History
//=============================================

/**
 * Creates a browser history instance using HTML5 History API.
 *
 * This is the recommended history type for production apps.
 * Requires server configuration to handle client-side routes.
 *
 * @param options - Configuration options
 * @returns History instance
 *
 * @example
 * ```typescript
 * const history = createBrowserHistory({ base: '/app' });
 *
 * history.push('/users/123');
 * console.log(history.location.value.path); // '/users/123'
 * ```
 */
export function createBrowserHistory(
  options: BrowserHistoryOptions = {}
): History {
  const { window: win = globalThis.window } = options;
  const base = normalizeBase(options.base);

  // Get current location from browser
  function getLocation(): Location {
    const { pathname, search, hash } = win.location;
    return createLocation(
      stripBase(pathname, base) + search + hash,
      win.history.state?.usr,
      win.history.state?.key || createKey()
    );
  }

  const core = createHistoryCore(getLocation());

  // Position of the current entry, stored in history.state.idx, so a blocked
  // back or forward can be undone with go() instead of rewriting an entry
  let index: number = win.history.state?.idx ?? 0;
  if (win.history.state?.idx === undefined) {
    win.history.replaceState({ ...win.history.state, idx: index }, '');
  }
  let ignoreNextPop = false;

  const createHref = (path: string): string =>
    base === '/' ? path : base + path;

  function push(path: string, state?: unknown): void {
    const next = createLocation(path, state);
    if (!core.allow(next, 'push', () => push(path, state))) return;

    const historyState = { usr: state, key: next.key, idx: index + 1 };
    win.history.pushState(historyState, '', createHref(next.fullPath));
    index++;
    core.commit(next, 'push');
  }

  function replace(path: string, state?: unknown): void {
    const next = createLocation(path, state);
    if (!core.allow(next, 'replace', () => replace(path, state))) return;

    const historyState = { usr: state, key: next.key, idx: index };
    win.history.replaceState(historyState, '', createHref(next.fullPath));
    core.commit(next, 'replace');
  }

  // Handle popstate (browser back/forward)
  function handlePopState(): void {
    // The go() that undid a blocked pop fires its own popstate
    if (ignoreNextPop) {
      ignoreNextPop = false;
      return;
    }

    const next = getLocation();
    const nextIndex: number | undefined = win.history.state?.idx;
    const delta = nextIndex === undefined ? 0 : nextIndex - index;

    if (!core.allow(next, 'pop', () => retryPop(win, delta))) {
      undoPop(delta);
      return;
    }

    index = nextIndex ?? index;
    core.commit(next, 'pop', delta);
  }

  // Steps back to where we were, keeping every entry intact. An entry of
  // unknown position gets the current URL put back on it.
  function undoPop(delta: number): void {
    if (delta) {
      ignoreNextPop = true;
      win.history.go(-delta);
      return;
    }
    const current = core.location.value;
    win.history.replaceState(
      { usr: current.state, key: current.key, idx: index },
      '',
      createHref(current.fullPath)
    );
  }

  win.addEventListener('popstate', handlePopState);

  return core.build({
    push,
    replace,
    go: (delta) => win.history.go(delta),
    createHref,
    destroy: () => win.removeEventListener('popstate', handlePopState),
  });
}

//=============================================
// Hash History
//=============================================

/**
 * Creates a hash-based history instance using URL fragments.
 *
 * Useful for environments where server-side routing configuration
 * is not possible. URLs will include a # (e.g., /#/users/123).
 *
 * @param options - Configuration options
 * @returns History instance
 *
 * @example
 * ```typescript
 * const history = createHashHistory();
 *
 * history.push('/users/123');
 * // URL becomes: http://example.com/#/users/123
 * ```
 */
export function createHashHistory(options: HashHistoryOptions = {}): History {
  const { window: win = globalThis.window } = options;
  const base = normalizeBase(options.base);

  // Get current location from hash
  function getLocation(): Location {
    let hash = win.location.hash.slice(1); // Remove leading #
    if (!hash.startsWith('/')) hash = '/' + hash;
    return createLocation(
      stripBase(hash, base),
      win.history.state?.usr,
      win.history.state?.key || createKey()
    );
  }

  // A fragment navigation makes an entry without state. Stamped once, the
  // popstate and the hashchange it fires read the same key and position.
  function stampEntry(idx: number): void {
    const state = win.history.state;
    if (state?.key !== undefined && state.idx !== undefined) return;
    win.history.replaceState(
      { ...state, key: state?.key ?? createKey(), idx: state?.idx ?? idx },
      ''
    );
  }

  stampEntry(0);
  const core = createHistoryCore(getLocation());

  // Position of the current entry, as in browser history
  let index: number = win.history.state.idx;

  const createHref = (path: string): string =>
    '#' + (base === '/' ? path : base + path);

  function push(path: string, state?: unknown): void {
    const next = createLocation(path, state);
    if (!core.allow(next, 'push', () => push(path, state))) return;

    const historyState = { usr: state, key: next.key, idx: index + 1 };
    win.history.pushState(historyState, '', createHref(next.fullPath));
    index++;
    core.commit(next, 'push');
  }

  function replace(path: string, state?: unknown): void {
    const next = createLocation(path, state);
    if (!core.allow(next, 'replace', () => replace(path, state))) return;

    const historyState = { usr: state, key: next.key, idx: index };
    win.history.replaceState(historyState, '', createHref(next.fullPath));
    core.commit(next, 'replace');
  }

  function handleHashChange(): void {
    stampEntry(index + 1);
    const next = getLocation();

    // A back or forward fires both popstate and hashchange for one entry. The
    // go() that undoes a blocked pop lands on the current entry, so it is
    // skipped here too.
    const current = core.location.value;
    if (next.fullPath === current.fullPath && next.key === current.key) {
      return;
    }

    const nextIndex: number | undefined = win.history.state?.idx;
    const delta = nextIndex === undefined ? 0 : nextIndex - index;

    if (!core.allow(next, 'pop', () => retryPop(win, delta))) {
      if (delta) {
        win.history.go(-delta);
      } else {
        win.history.replaceState(
          { usr: current.state, key: current.key, idx: index },
          '',
          createHref(current.fullPath)
        );
      }
      return;
    }

    index = nextIndex ?? index;
    core.commit(next, 'pop', delta);
  }

  win.addEventListener('hashchange', handleHashChange);
  win.addEventListener('popstate', handleHashChange);

  return core.build({
    push,
    replace,
    go: (delta) => win.history.go(delta),
    createHref,
    destroy() {
      win.removeEventListener('hashchange', handleHashChange);
      win.removeEventListener('popstate', handleHashChange);
    },
  });
}

//=============================================
// Memory History
//=============================================

/**
 * Creates an in-memory history instance.
 *
 * Perfect for:
 * - Unit testing (no browser required)
 * - Server-side rendering (Node.js)
 * - React Native and other non-browser environments
 *
 * @param options - Configuration options
 * @returns History instance
 *
 * @example
 * ```typescript
 * const history = createMemoryHistory({
 *   initialEntries: ['/', '/users', '/users/123'],
 *   initialIndex: 2,
 * });
 *
 * console.log(history.location.value.path); // '/users/123'
 *
 * history.back();
 * console.log(history.location.value.path); // '/users'
 * ```
 */
export function createMemoryHistory(
  options: MemoryHistoryOptions = {}
): History {
  const { initialEntries = ['/'], initialIndex } = options;

  const entries: Location[] = initialEntries.map((entry) =>
    createLocation(entry)
  );

  let index = initialIndex ?? entries.length - 1;
  if (index < 0) index = 0;
  if (index >= entries.length) index = entries.length - 1;

  // entries[index] is valid, index was just clamped to the range
  const core = createHistoryCore(entries[index]!);

  function push(path: string, state?: unknown): void {
    const next = createLocation(path, state);
    if (!core.allow(next, 'push', () => push(path, state))) return;

    // Remove entries after current index
    entries.splice(index + 1);
    entries.push(next);
    index = entries.length - 1;
    core.commit(next, 'push');
  }

  function replace(path: string, state?: unknown): void {
    const next = createLocation(path, state);
    if (!core.allow(next, 'replace', () => replace(path, state))) return;

    entries[index] = next;
    core.commit(next, 'replace');
  }

  function go(delta: number): void {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= entries.length) return;

    const next = entries[nextIndex]!;
    if (!core.allow(next, 'pop', () => go(delta))) return;

    index = nextIndex;
    core.commit(next, 'pop', delta);
  }

  return core.build({ push, replace, go, createHref: (path) => path });
}

//=============================================
// Factory Function
//=============================================

/**
 * Creates a history instance based on mode.
 *
 * @param mode - History mode ('history' | 'hash' | 'memory')
 * @param options - Mode-specific options
 * @returns History instance
 *
 * @example
 * ```typescript
 * const history = createHistory('history', { base: '/app' });
 * ```
 */
export function createHistory(
  mode: 'history' | 'hash' | 'memory',
  options?: BrowserHistoryOptions | HashHistoryOptions | MemoryHistoryOptions
): History {
  switch (mode) {
    case 'history':
      return createBrowserHistory(options as BrowserHistoryOptions);
    case 'hash':
      return createHashHistory(options as HashHistoryOptions);
    case 'memory':
      return createMemoryHistory(options as MemoryHistoryOptions);
    default:
      return createBrowserHistory(options as BrowserHistoryOptions);
  }
}
