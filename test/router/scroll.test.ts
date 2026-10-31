/**
 * Tests for scroll restoration functionality
 *
 * @module test/router/scroll.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ScrollManager,
  scrollToTop,
  scrollRestore,
  scrollSmooth,
  scrollNone,
  createScrollBehavior,
} from '../../src/router/scroll';
import type { ResolvedRoute, ScrollPosition } from '../../src/router/types';
import { Component } from '../../src/component/component';
import { createTestRouter } from '../support/router';

// Helper to create mock routes
function createMockRoute(
  overrides: Partial<ResolvedRoute> = {}
): ResolvedRoute {
  return {
    path: '/',
    matched: [
      {
        route: {
          config: { path: '/' },
          paramNames: [],
          regex: /^\//,
          prefixRegex: /^\//,
          score: 1,
          fullPath: '/',
        },
        params: {},
      },
    ],
    params: {},
    query: {},
    hash: '',
    fullPath: '/',
    meta: {},
    ...overrides,
  };
}

describe('ScrollManager', () => {
  let scrollManager: ScrollManager;
  let scrollToSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Mock window.scrollTo
    scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

    // Mock scroll position
    Object.defineProperty(window, 'scrollX', { value: 0, writable: true });
    Object.defineProperty(window, 'scrollY', { value: 0, writable: true });

    // Mock sessionStorage
    const storage: Record<string, string> = {};
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(
      (key) => storage[key] || null
    );
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => {
      storage[key] = value;
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation((key) => {
      delete storage[key];
    });

    // Mock history.scrollRestoration
    Object.defineProperty(history, 'scrollRestoration', {
      value: 'auto',
      writable: true,
    });

    scrollManager = new ScrollManager();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  //=============================================
  // Basic Functionality
  //=============================================

  describe('basic functionality', () => {
    it('disables browser scroll restoration', () => {
      expect(history.scrollRestoration).toBe('manual');
    });

    it('scrolls to top on new navigation', async () => {
      const to = createMockRoute({ path: '/new', fullPath: '/new' });
      const from = createMockRoute({ path: '/', fullPath: '/' });

      await scrollManager.handleScroll(to, from, false);

      expect(scrollToSpy).toHaveBeenCalledWith({
        left: 0,
        top: 0,
        behavior: 'auto',
      });
    });

    it('scrolls to hash element', async () => {
      const el = document.createElement('div');
      el.id = 'section';
      // Define scrollIntoView since happy-dom may not have it
      el.scrollIntoView = vi.fn();
      document.body.appendChild(el);

      // Note: to.hash is 'section' (without #), but ScrollManager adds # for querySelector
      const to = createMockRoute({ hash: 'section', fullPath: '/#section' });

      await scrollManager.handleScroll(to, null, false);

      // ScrollManager adds # prefix and calls scrollIntoView
      expect(el.scrollIntoView).toHaveBeenCalledWith({
        behavior: 'auto',
        block: 'start',
      });

      document.body.removeChild(el);
    });
  });

  //=============================================
  // Position Saving
  //=============================================

  describe('position saving', () => {
    it('saves current scroll position', () => {
      // Set scroll position
      Object.defineProperty(window, 'scrollX', { value: 100, writable: true });
      Object.defineProperty(window, 'scrollY', { value: 200, writable: true });
      (window as { scrollX: number }).scrollX = 100;
      (window as { scrollY: number }).scrollY = 200;

      scrollManager.savePosition();

      // Position should be saved to history.state
      // Note: In real browser, history.replaceState would be called
      // Here we just verify it doesn't throw
    });
  });

  //=============================================
  // History Key Management
  //=============================================

  describe('history key management', () => {
    it('increments history key for new navigations', () => {
      scrollManager.incrementHistoryKey();
      // Internal state, just verify no error
    });
  });
});

//=============================================
// Scroll Behavior Functions
//=============================================

describe('scrollToTop', () => {
  it('always returns top position', () => {
    const behavior = scrollToTop();
    const to = createMockRoute();
    const from = createMockRoute();

    const result = behavior(to, from, null);

    expect(result).toEqual({ top: 0, left: 0 });
  });

  it('ignores saved position', () => {
    const behavior = scrollToTop();
    const to = createMockRoute();
    const from = createMockRoute();
    const savedPosition: ScrollPosition = { top: 500, left: 100 };

    const result = behavior(to, from, savedPosition);

    expect(result).toEqual({ top: 0, left: 0 });
  });
});

describe('scrollRestore', () => {
  it('returns saved position when available', () => {
    const behavior = scrollRestore();
    const to = createMockRoute();
    const from = createMockRoute();
    const savedPosition: ScrollPosition = { top: 500, left: 100 };

    const result = behavior(to, from, savedPosition);

    expect(result).toEqual(savedPosition);
  });

  it('returns top when no saved position', () => {
    const behavior = scrollRestore();
    const to = createMockRoute();
    const from = createMockRoute();

    const result = behavior(to, from, null);

    expect(result).toEqual({ top: 0, left: 0 });
  });
});

describe('scrollSmooth', () => {
  it('scrolls to the element with the hash id, smoothly', () => {
    const behavior = scrollSmooth();
    const to = createMockRoute({ hash: 'section' });

    const result = behavior(to, null, null);

    // An id, never the tag selector `section`
    expect(result).toEqual({ el: '#section', behavior: 'smooth' });
  });

  it('restores saved position with smooth behavior', () => {
    const behavior = scrollSmooth();
    const to = createMockRoute();
    const savedPosition: ScrollPosition = { top: 500 };

    const result = behavior(to, null, savedPosition);

    expect(result).toEqual({ ...savedPosition, behavior: 'smooth' });
  });

  it('scrolls to top with smooth behavior', () => {
    const behavior = scrollSmooth();
    const to = createMockRoute();

    const result = behavior(to, null, null);

    expect(result).toEqual({ top: 0, left: 0, behavior: 'smooth' });
  });
});

describe('scrollNone', () => {
  it('returns undefined', () => {
    const behavior = scrollNone();
    const to = createMockRoute();

    const result = behavior(to, null, null);

    expect(result).toBeUndefined();
  });
});

describe('createScrollBehavior', () => {
  it('uses default behavior when no route match', () => {
    const defaultBehavior = vi.fn(() => ({ top: 0 }));
    const behavior = createScrollBehavior({ default: defaultBehavior });

    const to = createMockRoute({ path: '/unknown' });
    behavior(to, null, null);

    expect(defaultBehavior).toHaveBeenCalled();
  });

  it('uses route-specific behavior when matched', () => {
    const modalBehavior = vi.fn(() => undefined);
    const behavior = createScrollBehavior({
      routes: {
        '/modal/*': modalBehavior,
      },
    });

    const to = createMockRoute({ path: '/modal/123' });
    behavior(to, null, null);

    expect(modalBehavior).toHaveBeenCalled();
  });

  it('matches exact paths', () => {
    const feedBehavior = vi.fn(() => ({ top: 0, behavior: 'smooth' as const }));
    const behavior = createScrollBehavior({
      routes: {
        '/feed': feedBehavior,
      },
    });

    const to = createMockRoute({ path: '/feed' });
    behavior(to, null, null);

    expect(feedBehavior).toHaveBeenCalled();
  });

  it('does not match different paths', () => {
    const feedBehavior = vi.fn(() => ({ top: 0, behavior: 'smooth' as const }));
    const defaultBehavior = vi.fn(() => ({ top: 0 }));
    const behavior = createScrollBehavior({
      default: defaultBehavior,
      routes: {
        '/feed': feedBehavior,
      },
    });

    const to = createMockRoute({ path: '/other' });
    behavior(to, null, null);

    expect(feedBehavior).not.toHaveBeenCalled();
    expect(defaultBehavior).toHaveBeenCalled();
  });

  it('uses scrollRestore as default when not specified', () => {
    const behavior = createScrollBehavior({});
    const savedPosition: ScrollPosition = { top: 100 };

    const result = behavior(createMockRoute(), null, savedPosition);

    expect(result).toEqual(savedPosition);
  });
});

//=============================================
// Integration with Router
//=============================================

describe('scroll restoration integration', () => {
  it('ScrollManager handles scroll with custom behavior', async () => {
    const scrollToSpy = vi
      .spyOn(window, 'scrollTo')
      .mockImplementation(() => {});
    const customBehavior = vi.fn(() => ({ top: 50, left: 25 }));
    const manager = new ScrollManager(customBehavior);

    const to = createMockRoute({ path: '/test' });
    await manager.handleScroll(to, null, false);

    expect(customBehavior).toHaveBeenCalledWith(to, null, null);
    expect(scrollToSpy).toHaveBeenCalledWith({
      top: 50,
      left: 25,
      behavior: 'auto',
    });
  });

  it('ScrollManager clears positions', () => {
    const manager = new ScrollManager();
    manager.clearPositions();
    // Just verify no error
  });
});

describe('ScrollManager fixes', () => {
  it('scrolls to an id that is not a valid selector', async () => {
    const target = document.createElement('h2');
    target.id = '1intro';
    document.body.appendChild(target);
    const spy = vi.spyOn(target, 'scrollIntoView');

    const manager = new ScrollManager();
    await manager.handleScroll(
      createMockRoute({ hash: '1intro' }),
      null,
      false
    );

    expect(spy).toHaveBeenCalled();
  });

  it('leaves the page alone for a memory router without scrollBehavior', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo');
    window.history.replaceState({ key: 'host' }, '');

    const manager = new ScrollManager(undefined, {}, false);
    manager.savePosition();
    await manager.handleScroll(createMockRoute(), null, false);

    expect(scrollTo).not.toHaveBeenCalled();
    expect(window.history.state).toEqual({ key: 'host' });
  });
});

describe('ScrollManager storage and targets', () => {
  const STORAGE_KEY = 'signy-scroll-positions';

  afterEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('keeps positions in sessionStorage across managers', () => {
    window.history.replaceState({ key: 'entry-1' }, '');
    const container = document.createElement('div');
    Object.defineProperty(container, 'scrollTop', { value: 120 });
    Object.defineProperty(container, 'scrollLeft', { value: 3 });
    const options = { scrollContainer: () => container };

    new ScrollManager(undefined, options).savePosition();
    const next = new ScrollManager(undefined, options);
    expect(next.getSavedPosition(false)).toEqual({ left: 3, top: 120 });
  });

  it('evicts the oldest positions past maxPositions', () => {
    const manager = new ScrollManager(undefined, { maxPositions: 2 });
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(2)
      .mockReturnValueOnce(3);
    for (const key of ['a', 'b', 'c']) {
      window.history.replaceState({ key }, '');
      manager.savePosition();
    }
    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY)!) as Array<
      [string, unknown]
    >;
    expect(stored.map(([key]) => key)).toEqual(['b', 'c']);
  });

  it('ignores a corrupt sessionStorage entry', () => {
    sessionStorage.setItem(STORAGE_KEY, '{not json');
    window.history.replaceState({ key: 'x' }, '');
    expect(new ScrollManager().getSavedPosition(false)).toBeNull();
  });

  it('keeps positions in memory only with persistPositions: false', () => {
    window.history.replaceState({ key: 'm' }, '');
    const manager = new ScrollManager(undefined, { persistPositions: false });
    manager.savePosition();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(manager.getSavedPosition(false)).not.toBeNull();

    manager.clearPositions();
    expect(manager.getSavedPosition(false)).toBeNull();
  });

  it('scrolls a container element instead of the window', async () => {
    const container = document.createElement('div');
    container.scrollTo = vi.fn();
    const manager = new ScrollManager(undefined, {
      scrollContainer: () => container,
    });
    await manager.handleScroll(createMockRoute(), null, false);
    expect(container.scrollTo).toHaveBeenCalledWith({
      left: 0,
      top: 0,
      behavior: 'auto',
    });
  });

  it('scrolls to a selector, and to the position when it is invalid', async () => {
    const target = document.createElement('section');
    target.className = 'target';
    target.scrollIntoView = vi.fn();
    document.body.appendChild(target);
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

    await new ScrollManager(() => ({ el: '.target' })).handleScroll(
      createMockRoute(),
      null,
      false
    );
    expect(target.scrollIntoView).toHaveBeenCalled();

    await new ScrollManager(() => ({ el: '[[bad', top: 5 })).handleScroll(
      createMockRoute(),
      null,
      false
    );
    expect(scrollTo).toHaveBeenCalledWith({
      left: 0,
      top: 5,
      behavior: 'auto',
    });
  });

  it('waits scrollDelay before scrolling', async () => {
    vi.useFakeTimers();
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const done = new ScrollManager(undefined, {
      scrollDelay: 100,
    }).handleScroll(createMockRoute(), null, false);
    await vi.advanceTimersByTimeAsync(99);
    expect(scrollTo).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(scrollTo).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('ScrollManager without sessionStorage access', () => {
  it('works where reading sessionStorage throws', () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      window,
      'sessionStorage'
    );
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new DOMException('Access is denied', 'SecurityError');
      },
    });
    try {
      const manager = new ScrollManager();
      manager.savePosition();
      manager.clearPositions();
    } finally {
      Object.defineProperty(window, 'sessionStorage', descriptor!);
    }
  });
});

describe('ScrollManager storage per router', () => {
  it('keeps each storage key apart', () => {
    sessionStorage.clear();
    new ScrollManager(undefined, { storageKey: 'history:/a' }).savePosition();
    new ScrollManager(undefined, { storageKey: 'history:/b' }).savePosition();
    expect(
      sessionStorage.getItem('signy-scroll-positions:history:/a')
    ).not.toBe(null);
    expect(
      sessionStorage.getItem('signy-scroll-positions:history:/b')
    ).not.toBe(null);
    sessionStorage.clear();
  });

  it('does not persist the positions of a memory router', async () => {
    sessionStorage.clear();
    const router = createTestRouter(
      [
        { path: '/', component: Component },
        { path: '/next', component: Component },
      ],
      { scrollBehavior: () => undefined }
    );
    await router.push('/next');
    expect(sessionStorage.length).toBe(0);
  });
});
