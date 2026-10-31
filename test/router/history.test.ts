/**
 * History Abstraction Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createBrowserHistory,
  createHashHistory,
  createMemoryHistory,
  createHistory,
  type History,
} from '../../src/router/history';

describe('Memory History', () => {
  let history: History;

  beforeEach(() => {
    history = createMemoryHistory();
  });

  afterEach(() => {
    history.destroy();
  });

  describe('initialization', () => {
    it('should start at root by default', () => {
      expect(history.location.value.path).toBe('/');
    });

    it('should accept initial entries', () => {
      const h = createMemoryHistory({
        initialEntries: ['/home', '/about', '/contact'],
        initialIndex: 1,
      });
      expect(h.location.value.path).toBe('/about');
      h.destroy();
    });

    it('should default to last entry if no index provided', () => {
      const h = createMemoryHistory({
        initialEntries: ['/home', '/about', '/contact'],
      });
      expect(h.location.value.path).toBe('/contact');
      h.destroy();
    });

    it('should clamp index to valid range', () => {
      const h = createMemoryHistory({
        initialEntries: ['/home', '/about'],
        initialIndex: 100,
      });
      expect(h.location.value.path).toBe('/about');
      h.destroy();
    });
  });

  describe('push', () => {
    it('should navigate to new path', () => {
      history.push('/users');
      expect(history.location.value.path).toBe('/users');
    });

    it('should handle paths with query strings', () => {
      history.push('/search?q=hello');
      expect(history.location.value.path).toBe('/search');
      expect(history.location.value.search).toBe('q=hello');
    });

    it('should handle paths with hash', () => {
      history.push('/page#section');
      expect(history.location.value.path).toBe('/page');
      expect(history.location.value.hash).toBe('section');
    });

    it('should store state', () => {
      history.push('/page', { data: 'test' });
      expect(history.location.value.state).toEqual({ data: 'test' });
    });

    it('should generate unique keys', () => {
      const key1 = history.location.value.key;
      history.push('/page1');
      const key2 = history.location.value.key;
      history.push('/page2');
      const key3 = history.location.value.key;

      expect(key1).not.toBe(key2);
      expect(key2).not.toBe(key3);
    });
  });

  describe('replace', () => {
    it('should replace current entry', () => {
      history.push('/page1');
      history.push('/page2');
      history.replace('/page3');

      expect(history.location.value.path).toBe('/page3');
      history.back();
      expect(history.location.value.path).toBe('/page1');
    });

    it('should preserve state when replacing', () => {
      history.push('/page', { old: true });
      history.replace('/page', { new: true });
      expect(history.location.value.state).toEqual({ new: true });
    });
  });

  describe('navigation', () => {
    beforeEach(() => {
      history.push('/page1');
      history.push('/page2');
      history.push('/page3');
    });

    it('should go back', () => {
      history.back();
      expect(history.location.value.path).toBe('/page2');
    });

    it('should go forward', () => {
      history.back();
      history.forward();
      expect(history.location.value.path).toBe('/page3');
    });

    it('should go to specific delta', () => {
      history.go(-2);
      expect(history.location.value.path).toBe('/page1');
    });

    it('should ignore invalid go deltas', () => {
      history.go(-100);
      expect(history.location.value.path).toBe('/page3');

      history.go(100);
      expect(history.location.value.path).toBe('/page3');
    });

    it('should truncate forward history on push', () => {
      history.back();
      history.back();
      history.push('/new-page');

      history.forward();
      expect(history.location.value.path).toBe('/new-page');
    });
  });

  describe('listeners', () => {
    it('should notify listeners on push', () => {
      const listener = vi.fn();
      history.listen(listener);

      history.push('/page');

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/page' }),
        'push',
        0
      );
    });

    it('should notify listeners on replace', () => {
      const listener = vi.fn();
      history.listen(listener);

      history.replace('/page');

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/page' }),
        'replace',
        0
      );
    });

    it('should notify listeners on back/forward', () => {
      history.push('/page');
      const listener = vi.fn();
      history.listen(listener);

      history.back();

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/' }),
        'pop',
        -1
      );
    });

    it('passes how many entries a pop moved', () => {
      history.push('/one');
      history.push('/two');
      const listener = vi.fn();
      history.listen(listener);

      history.go(-2);
      history.forward();

      expect(listener.mock.calls.map((call) => call[2])).toEqual([-2, 1]);
    });

    it('should unsubscribe listeners', () => {
      const listener = vi.fn();
      const unsubscribe = history.listen(listener);

      unsubscribe();
      history.push('/page');

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('blockers', () => {
    it('should block navigation', () => {
      const blocker = vi.fn();
      history.block(blocker);

      history.push('/blocked');

      expect(blocker).toHaveBeenCalled();
      expect(history.location.value.path).toBe('/');
    });

    it('should unblock navigation', () => {
      const blocker = vi.fn();
      const unblock = history.block(blocker);

      unblock();
      history.push('/allowed');

      expect(history.location.value.path).toBe('/allowed');
    });

    it('should provide retry function', () => {
      let retryFn: (() => void) | undefined;
      const blocker = vi.fn((_location, _action, retry) => {
        retryFn = retry;
      });

      const unblock = history.block(blocker);
      history.push('/page');

      expect(history.location.value.path).toBe('/');

      unblock();
      retryFn?.();

      expect(history.location.value.path).toBe('/page');
    });
  });

  describe('createHref', () => {
    it('should return path as-is for memory history', () => {
      expect(history.createHref('/users/123')).toBe('/users/123');
    });
  });

  describe('fullPath', () => {
    it('should include path, search, and hash', () => {
      history.push('/page?foo=bar#section');
      expect(history.location.value.fullPath).toBe('/page?foo=bar#section');
    });
  });
});

describe('createHistory factory', () => {
  it('should create memory history', () => {
    const history = createHistory('memory');
    expect(history.location.value.path).toBe('/');
    history.destroy();
  });

  it('should pass options to history', () => {
    const history = createHistory('memory', { initialEntries: ['/test'] });
    expect(history.location.value.path).toBe('/test');
    history.destroy();
  });
});

const waitForPop = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('Browser History', () => {
  let history: History;

  afterEach(() => {
    history?.destroy();
  });

  it('reads the current URL', () => {
    window.history.replaceState(null, '', '/start?x=1#top');
    history = createBrowserHistory();
    expect(history.location.value.fullPath).toBe('/start?x=1#top');
  });

  it('reads a pushed path the same way after a reload', () => {
    history = createBrowserHistory();
    history.push('/café/a b');
    const pushed = history.location.value.path;
    history.destroy();

    history = createBrowserHistory();
    expect(window.location.pathname).toBe('/caf%C3%A9/a%20b');
    expect(history.location.value.path).toBe(pushed);
    expect(pushed).toBe('/café/a b');
  });

  it('pushes and replaces URLs with state', () => {
    history = createBrowserHistory();
    history.push('/a', { from: 'test' });
    expect(window.location.pathname).toBe('/a');
    expect(history.location.value.state).toEqual({ from: 'test' });

    history.replace('/b');
    expect(window.location.pathname).toBe('/b');
    expect(history.location.value.path).toBe('/b');
  });

  it('notifies listeners on push, replace and pop', async () => {
    history = createBrowserHistory();
    const actions: string[] = [];
    history.listen((loc, action) => actions.push(`${action}:${loc.path}`));

    history.push('/one');
    history.replace('/two');
    history.push('/three');
    history.back();
    await waitForPop();

    expect(actions).toEqual([
      'push:/one',
      'replace:/two',
      'push:/three',
      'pop:/two',
    ]);
    expect(history.location.value.path).toBe('/two');
  });

  it('keeps the state of an entry across back and forward', async () => {
    history = createBrowserHistory();
    history.push('/a', { n: 1 });
    history.push('/b', { n: 2 });
    history.back();
    await waitForPop();
    expect(history.location.value.state).toEqual({ n: 1 });

    history.forward();
    await waitForPop();
    expect(history.location.value.state).toEqual({ n: 2 });
  });

  it('strips and adds the base path', () => {
    window.history.replaceState(null, '', '/app/home');
    history = createBrowserHistory({ base: '/app' });
    expect(history.location.value.path).toBe('/home');
    expect(history.createHref('/x')).toBe('/app/x');

    history.push('/about');
    expect(window.location.pathname).toBe('/app/about');
    expect(history.location.value.path).toBe('/about');
  });

  it('blocks push and retries it', () => {
    history = createBrowserHistory();
    let retry: (() => void) | null = null;
    const unblock = history.block((_loc, _action, r) => {
      retry = r;
    });

    history.push('/blocked');
    expect(window.location.pathname).toBe('/');

    unblock();
    retry!();
    expect(window.location.pathname).toBe('/blocked');
  });

  it('stops listening to popstate after destroy', async () => {
    history = createBrowserHistory();
    const listener = vi.fn();
    history.listen(listener);
    history.push('/a');
    history.destroy();
    listener.mockClear();

    window.history.back();
    await waitForPop();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('Hash History', () => {
  let history: History;

  afterEach(() => {
    history?.destroy();
  });

  it('reads the path from the hash', () => {
    window.history.replaceState(null, '', '/#/users?tab=1');
    history = createHashHistory();
    expect(history.location.value.path).toBe('/users');
    expect(history.location.value.search).toBe('tab=1');
  });

  it('treats an empty hash as the root', () => {
    history = createHashHistory();
    expect(history.location.value.path).toBe('/');
  });

  it('writes pushes and replaces into the hash', () => {
    history = createHashHistory();
    history.push('/a');
    expect(window.location.hash).toBe('#/a');

    history.replace('/b');
    expect(window.location.hash).toBe('#/b');
    expect(history.createHref('/c')).toBe('#/c');
  });

  it('uses the base inside the hash', () => {
    history = createHashHistory({ base: '/app' });
    history.push('/x');
    expect(window.location.hash).toBe('#/app/x');
    expect(history.location.value.path).toBe('/x');
  });

  it('follows a manual hash change', async () => {
    history = createHashHistory();
    window.location.hash = '#/manual';
    await waitForPop();
    expect(history.location.value.path).toBe('/manual');
  });

  it('notifies once per back navigation', async () => {
    history = createHashHistory();
    history.push('/a');
    history.push('/b');
    const listener = vi.fn();
    history.listen(listener);

    history.back();
    await waitForPop();

    expect(history.location.value.path).toBe('/a');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('history fixes', () => {
  const wait = () => new Promise((resolve) => setTimeout(resolve, 20));

  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('does not strip a base from a longer path', () => {
    window.history.replaceState(null, '', '/application');
    const history = createBrowserHistory({ base: '/app' });
    expect(history.location.value.path).toBe('/application');
    history.destroy();

    window.history.replaceState(null, '', '/app/users');
    const inside = createBrowserHistory({ base: '/app' });
    expect(inside.location.value.path).toBe('/users');
    inside.destroy();
  });

  it('lets a hash history blocker retry a blocked back', async () => {
    window.history.replaceState(null, '', '/#/');
    const history = createHashHistory();
    history.push('/a');
    history.push('/b');

    let retry: (() => void) | undefined;
    const unblock = history.block((_location, action, r) => {
      if (action === 'pop') retry = r;
    });

    history.back();
    await wait();
    await wait();
    expect(history.location.value.path).toBe('/b');
    expect(retry).toBeDefined();

    unblock();
    retry!();
    await wait();
    expect(history.location.value.path).toBe('/a');
    history.destroy();
  });
});

describe('Hash History fragment navigation', () => {
  it('commits one change for a new hash', async () => {
    window.history.replaceState(null, '', '#/');
    const history = createHashHistory();
    const listener = vi.fn();
    history.listen(listener);

    window.location.hash = '#/other';
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![0].path).toBe('/other');
    expect(listener.mock.calls[0]![2]).toBe(1);
    history.destroy();
  });
});
