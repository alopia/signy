/**
 * Scroll Restoration Module
 *
 * Provides scroll position saving, restoration, and configurable scroll
 * behavior for router navigation. Uses a hybrid approach with history state
 * for immediate restoration and sessionStorage for persistence across page
 * refreshes.
 *
 * @module router/scroll
 *
 * @example
 * ```typescript
 * import { router } from 'signy';
 *
 * // Default behavior: restore on back/forward, scroll to top on new navigation
 * const appRouter = router({
 *   routes,
 *   scrollBehavior: (to, from, savedPosition) => {
 *     // Hash navigation - scroll to element
 *     if (to.hash) {
 *       return { el: `#${to.hash}`, behavior: 'smooth' };
 *     }
 *
 *     // Back/forward - restore position
 *     if (savedPosition) {
 *       return savedPosition;
 *     }
 *
 *     // New navigation - scroll to top
 *     return { top: 0 };
 *   }
 * });
 * ```
 *
 * ## Known limitations
 *
 * **sessionStorage limits**: Position cache has a max size (100 entries by default)
 * with LRU eviction. Very long browsing sessions may lose old positions.
 *
 * **Dynamic content**: If content loads after scroll restoration, the position
 * may shift. Consider using Suspense or awaiting data before restoring.
 */

import type { ResolvedRoute, ScrollBehavior, ScrollPosition } from './types';

//=============================================
// Types
//=============================================

/**
 * Internal scroll position with metadata
 */
interface StoredScrollPosition {
  left: number;
  top: number;
  timestamp: number;
}

/**
 * Scroll position storage interface
 */
interface ScrollPositionStorage {
  get(key: string): ScrollPosition | null;
  set(key: string, position: ScrollPosition): void;
  remove(key: string): void;
  clear(): void;
}

/**
 * Scroll restoration options
 */
export interface ScrollRestorationOptions {
  /**
   * Maximum number of positions to store in sessionStorage.
   * Older positions are evicted when limit is reached.
   * @default 100
   */
  maxPositions?: number;

  /**
   * Delay before scrolling after navigation (ms).
   * Useful when content loads asynchronously.
   * @default 0
   */
  scrollDelay?: number;

  /**
   * Whether to save positions in sessionStorage for page refresh persistence.
   * @default true
   */
  persistPositions?: boolean;

  /**
   * Custom scroll container (default: window)
   */
  scrollContainer?: Element | (() => Element | null);

  /**
   * Suffix of the sessionStorage key, so routers on one page keep their
   * positions apart.
   */
  storageKey?: string;
}

//=============================================
// Constants
//=============================================

const STORAGE_KEY = 'signy-scroll-positions';
const DEFAULT_MAX_POSITIONS = 100;

//=============================================
// Scroll Position Storage
//=============================================

/**
 * sessionStorage, or null where there is none or where reading it throws: a
 * sandboxed iframe, an opaque origin, some privacy modes.
 */
function sessionStorageOrNull(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Creates a scroll position storage backed by sessionStorage with LRU eviction.
 */
function createScrollStorage(
  maxPositions: number = DEFAULT_MAX_POSITIONS,
  storageKey: string = STORAGE_KEY
): ScrollPositionStorage {
  // In-memory cache for fast access
  let cache: Map<string, StoredScrollPosition>;

  // Initialize from sessionStorage
  const loadCache = (): Map<string, StoredScrollPosition> => {
    const storage = sessionStorageOrNull();
    if (!storage) return new Map();

    try {
      const stored = storage.getItem(storageKey);
      if (stored) {
        const entries = JSON.parse(stored) as Array<
          [string, StoredScrollPosition]
        >;
        return new Map(entries);
      }
    } catch {
      // Ignore parse errors
    }
    return new Map();
  };

  // Save to sessionStorage
  const saveCache = (): void => {
    const storage = sessionStorageOrNull();
    if (!storage) return;

    try {
      const entries = Array.from(cache.entries());
      storage.setItem(storageKey, JSON.stringify(entries));
    } catch {
      // Ignore storage errors (quota exceeded, etc.)
    }
  };

  // Evict oldest entries if over limit
  const evictOldest = (): void => {
    if (cache.size <= maxPositions) return;

    // Sort by timestamp, remove oldest
    const sorted = Array.from(cache.entries()).sort(
      (a, b) => a[1].timestamp - b[1].timestamp
    );

    const toRemove = sorted.slice(0, cache.size - maxPositions);
    for (const [key] of toRemove) {
      cache.delete(key);
    }
  };

  cache = loadCache();

  return {
    get(key: string): ScrollPosition | null {
      const stored = cache.get(key);
      if (stored) {
        // Update timestamp on access (LRU)
        stored.timestamp = Date.now();
        return { left: stored.left, top: stored.top };
      }
      return null;
    },

    set(key: string, position: ScrollPosition): void {
      cache.set(key, {
        left: position.left ?? 0,
        top: position.top ?? 0,
        timestamp: Date.now(),
      });
      evictOldest();
      saveCache();
    },

    remove(key: string): void {
      cache.delete(key);
      saveCache();
    },

    clear(): void {
      cache.clear();
      sessionStorageOrNull()?.removeItem(storageKey);
    },
  };
}

//=============================================
// Scroll Manager Class
//=============================================

/**
 * Manages scroll position saving and restoration for the router.
 *
 * The ScrollManager coordinates:
 * 1. Saving scroll position before navigation
 * 2. Determining target scroll position based on scrollBehavior
 * 3. Executing the scroll after navigation completes
 *
 * @internal
 */
export class ScrollManager {
  private _storage: ScrollPositionStorage;
  private _options: Required<ScrollRestorationOptions>;
  private _scrollBehavior: ScrollBehavior | undefined;
  private _historyKey: number = 0;
  /** The entry on screen. On back and forward the history has left it already */
  private _shownKey: string | null = null;

  /**
   * Whether the router owns the window history. A memory router does not, so
   * it leaves history.state and the page scroll alone.
   */
  private readonly _ownsWindow: boolean;
  /** The browser's setting before this manager set it to manual */
  private _previousRestoration: ScrollRestoration | null = null;

  constructor(
    scrollBehavior?: ScrollBehavior,
    options: ScrollRestorationOptions = {},
    ownsWindow = true
  ) {
    this._scrollBehavior = scrollBehavior;
    this._ownsWindow = ownsWindow && typeof history !== 'undefined';
    this._options = {
      maxPositions: options.maxPositions ?? DEFAULT_MAX_POSITIONS,
      scrollDelay: options.scrollDelay ?? 0,
      persistPositions: options.persistPositions ?? true,
      scrollContainer: options.scrollContainer ?? (() => null),
      storageKey: options.storageKey ?? '',
    };

    this._storage = this._options.persistPositions
      ? createScrollStorage(
          this._options.maxPositions,
          this._options.storageKey
            ? `${STORAGE_KEY}:${this._options.storageKey}`
            : STORAGE_KEY
        )
      : createMemoryStorage();

    // Disable browser's automatic scroll restoration
    if (this._ownsWindow && 'scrollRestoration' in history) {
      this._previousRestoration = history.scrollRestoration;
      history.scrollRestoration = 'manual';
    }
  }

  /**
   * Gets the current scroll position key for storage.
   */
  private _getPositionKey(): string {
    // Use history key if available (unique per history entry)
    if (this._ownsWindow && history.state?.key) {
      return String(history.state.key);
    }
    // Fallback to our own incrementing key
    return `scroll-${this._historyKey}`;
  }

  /**
   * Gets the scroll container element.
   */
  private _getScrollContainer(): Element | Window {
    const container = this._options.scrollContainer;
    if (typeof container === 'function') {
      return container() ?? window;
    }
    return container ?? window;
  }

  /**
   * Gets the current scroll position of the container.
   */
  private _getCurrentPosition(): ScrollPosition {
    const container = this._getScrollContainer();

    if (container === window || container === document.documentElement) {
      return {
        left: window.scrollX || window.pageXOffset || 0,
        top: window.scrollY || window.pageYOffset || 0,
      };
    }

    return {
      left: (container as Element).scrollLeft,
      top: (container as Element).scrollTop,
    };
  }

  /**
   * Saves the current scroll position for the entry on screen.
   */
  savePosition(): void {
    const current = this._getPositionKey();
    const key = this._shownKey ?? current;
    const position = this._getCurrentPosition();
    this._storage.set(key, position);

    // Also in the history entry, unless the history has left it already
    if (this._ownsWindow && key === current) {
      try {
        const currentState = history.state || {};
        history.replaceState({ ...currentState, scroll: position }, '');
      } catch {
        // Ignore state errors
      }
    }
  }

  /**
   * Gets the saved position for a history entry.
   *
   * @param fromHistory - Whether this is a back/forward navigation
   */
  getSavedPosition(fromHistory: boolean): ScrollPosition | null {
    // Storage first: an entry left with back or forward is saved only there
    const stored = this._storage.get(this._getPositionKey());
    if (stored) return stored;

    // history.state is left after a reload with persistPositions: false
    if (fromHistory && this._ownsWindow) {
      const statePosition = history.state?.scroll;
      if (statePosition && typeof statePosition.top === 'number') {
        return statePosition;
      }
    }
    return null;
  }

  /**
   * Increments the history key for new navigations.
   */
  incrementHistoryKey(): void {
    this._historyKey++;
  }

  /**
   * Handles scroll after navigation.
   *
   * @param to - Target route
   * @param from - Source route (null on initial navigation)
   * @param fromHistory - Whether this is a back/forward navigation
   */
  async handleScroll(
    to: ResolvedRoute,
    from: ResolvedRoute | null,
    fromHistory: boolean
  ): Promise<void> {
    this._shownKey = this._getPositionKey();

    // An embedded memory router scrolls only when told how
    if (!this._ownsWindow && !this._scrollBehavior) return;

    // Get saved position for back/forward
    const savedPosition = fromHistory ? this.getSavedPosition(true) : null;

    // Determine target position
    let targetPosition: ScrollPosition | void;

    if (this._scrollBehavior) {
      // Use custom scroll behavior
      targetPosition = await this._scrollBehavior(to, from, savedPosition);
    } else {
      // Default behavior
      targetPosition = this._defaultScrollBehavior(to, savedPosition);
    }

    // Execute scroll
    if (targetPosition) {
      await this._executeScroll(targetPosition);
    }
  }

  /**
   * Default scroll behavior when none is configured.
   */
  private _defaultScrollBehavior(
    to: ResolvedRoute,
    savedPosition: ScrollPosition | null
  ): ScrollPosition {
    // Hash navigation - scroll to element
    if (to.hash) {
      // Add # prefix for querySelector if not already present
      const selector = to.hash.startsWith('#') ? to.hash : `#${to.hash}`;
      return { el: selector };
    }

    // Back/forward - restore saved position
    if (savedPosition) {
      return savedPosition;
    }

    // New navigation - scroll to top
    return { top: 0, left: 0 };
  }

  /**
   * Executes the actual scroll operation.
   */
  private async _executeScroll(position: ScrollPosition): Promise<void> {
    // Apply delay if configured
    if (this._options.scrollDelay > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, this._options.scrollDelay)
      );
    }

    const container = this._getScrollContainer();
    const behavior = position.behavior ?? 'auto';

    // Scroll to element
    if (position.el) {
      const el =
        typeof position.el === 'string'
          ? findElement(position.el)
          : position.el;

      if (el) {
        el.scrollIntoView({ behavior, block: 'start' });
        return;
      }
      // Element not found, fall through to position scroll
    }

    // Scroll to position
    const left = position.left ?? 0;
    const top = position.top ?? 0;

    if (container === window) {
      window.scrollTo({ left, top, behavior });
    } else {
      (container as Element).scrollTo({ left, top, behavior });
    }
  }

  /**
   * Clears all saved positions.
   */
  clearPositions(): void {
    this._storage.clear();
  }

  /**
   * Gives the browser back the scroll restoration it had before.
   */
  destroy(): void {
    if (this._previousRestoration) {
      history.scrollRestoration = this._previousRestoration;
      this._previousRestoration = null;
    }
  }
}

/**
 * Finds the element of a `#id` or a selector. An id goes through
 * getElementById(), as `#1intro` is not a valid selector.
 */
function findElement(target: string): Element | null {
  if (target.startsWith('#')) {
    const id = target.slice(1);
    try {
      return document.getElementById(decodeURIComponent(id));
    } catch {
      return document.getElementById(id);
    }
  }
  try {
    return document.querySelector(target);
  } catch {
    return null;
  }
}

//=============================================
// Memory Storage (for non-persistent mode)
//=============================================

function createMemoryStorage(): ScrollPositionStorage {
  const cache = new Map<string, ScrollPosition>();

  return {
    get(key: string): ScrollPosition | null {
      return cache.get(key) ?? null;
    },
    set(key: string, position: ScrollPosition): void {
      cache.set(key, position);
    },
    remove(key: string): void {
      cache.delete(key);
    },
    clear(): void {
      cache.clear();
    },
  };
}

//=============================================
// Default Scroll Behaviors
//=============================================

/**
 * Creates a scroll behavior that always scrolls to top.
 */
export function scrollToTop(): ScrollBehavior {
  return () => ({ top: 0, left: 0 });
}

/**
 * Creates a scroll behavior that restores position or scrolls to top.
 */
export function scrollRestore(): ScrollBehavior {
  return (_to, _from, savedPosition) => {
    if (savedPosition) return savedPosition;
    return { top: 0, left: 0 };
  };
}

/**
 * Creates a scroll behavior with smooth scrolling.
 */
export function scrollSmooth(): ScrollBehavior {
  return (to, _from, savedPosition) => {
    if (to.hash) {
      // The parsed hash has no `#`, and a bare word would be a tag selector
      return { el: `#${to.hash}`, behavior: 'smooth' };
    }
    if (savedPosition) {
      return { ...savedPosition, behavior: 'smooth' };
    }
    return { top: 0, left: 0, behavior: 'smooth' };
  };
}

/**
 * Creates a scroll behavior that does nothing (keeps current position).
 */
export function scrollNone(): ScrollBehavior {
  return () => undefined;
}

/**
 * Combines multiple scroll behaviors with per-route overrides.
 *
 * @example
 * ```typescript
 * const appRouter = router({
 *   routes,
 *   scrollBehavior: createScrollBehavior({
 *     default: scrollRestore(),
 *     routes: {
 *       '/modal/*': scrollNone(),
 *       '/feed': scrollSmooth(),
 *     }
 *   })
 * });
 * ```
 */
export function createScrollBehavior(options: {
  default?: ScrollBehavior;
  routes?: Record<string, ScrollBehavior>;
}): ScrollBehavior {
  const defaultBehavior = options.default ?? scrollRestore();
  const routeBehaviors = options.routes ?? {};

  return (to, from, savedPosition) => {
    // Check route-specific behaviors
    for (const [pattern, behavior] of Object.entries(routeBehaviors)) {
      if (matchPath(to.path, pattern)) {
        return behavior(to, from, savedPosition);
      }
    }

    // Use default
    return defaultBehavior(to, from, savedPosition);
  };
}

/**
 * Simple path matching for scroll behaviors.
 */
function matchPath(path: string, pattern: string): boolean {
  // Exact match
  if (pattern === path) return true;

  // Wildcard match
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2);
    return path === prefix || path.startsWith(prefix + '/');
  }

  return false;
}
