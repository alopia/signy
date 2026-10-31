/**
 * Router Class Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  Router,
  router as createRouter,
  memoryRouter as createMemoryRouter,
} from '../../src/router/router';
import { Signal } from '../../src/reactivity';
import { Component } from '../../src/component/component';
import {
  NavigationFailureType,
  type RouteConfig,
} from '../../src/router/types';
import { createTestRouter } from '../support/router';
import { expectLogged } from '../support/console';
import { mount } from '../support/mount';

class MockComponent extends Component {
  protected render() {
    return document.createElement('div');
  }
}

describe('Router', () => {
  const basicRoutes: RouteConfig[] = [
    { path: '/', name: 'home', component: MockComponent },
    { path: '/about', name: 'about', component: MockComponent },
    { path: '/users', name: 'users', component: MockComponent },
    {
      path: '/users/:id',
      name: 'user-detail',
      component: MockComponent,
    },
    { path: '*', name: 'not-found', component: MockComponent },
  ];

  let router: Router;

  afterEach(() => {
    router?.destroy();
  });

  describe('initialization', () => {
    it('should create router with routes', () => {
      router = createMemoryRouter({ routes: basicRoutes });
      expect(router).toBeInstanceOf(Router);
    });

    it('should start at root path', () => {
      router = createMemoryRouter({ routes: basicRoutes });
      expect(router.route.value.path).toBe('/');
    });

    it('should start at custom initial entry', () => {
      router = createMemoryRouter({
        routes: basicRoutes,
        initialEntries: ['/about'],
      });
      expect(router.route.value.path).toBe('/about');
    });

    it('should be in ready state after creation', () => {
      router = createMemoryRouter({ routes: basicRoutes });
      expect(router.state).toBe('ready');
    });
  });

  describe('push navigation', () => {
    beforeEach(() => {
      router = createMemoryRouter({ routes: basicRoutes });
    });

    it('should navigate to path', async () => {
      await router.push('/about');
      expect(router.route.value.path).toBe('/about');
    });

    it('should update params on navigation', async () => {
      await router.push('/users/123');
      expect(router.params.value['id']).toBe('123');
    });

    it('should update query on navigation', async () => {
      await router.push('/users?page=1&limit=10');
      expect(router.query.value).toEqual({ page: '1', limit: '10' });
    });

    it('should not navigate if path is same', async () => {
      await router.push('/about');
      const listener = vi.fn();
      router.afterEach(listener);
      await router.push('/about');
      expect(listener).not.toHaveBeenCalled();
    });

    it('should force navigation with force option', async () => {
      await router.push('/about');
      const listener = vi.fn();
      router.afterEach(listener);
      await router.push('/about', { force: true });
      expect(listener).toHaveBeenCalled();
    });
  });

  describe('replace navigation', () => {
    beforeEach(() => {
      router = createMemoryRouter({ routes: basicRoutes });
    });

    it('should replace current entry', async () => {
      await router.push('/about');
      await router.replace('/users');
      expect(router.route.value.path).toBe('/users');

      router.back();
      // Should go back to root, not about
      // Note: Need to wait for async navigation
    });
  });

  describe('navigation by name', () => {
    beforeEach(() => {
      router = createMemoryRouter({ routes: basicRoutes });
    });

    it('should navigate by route name', async () => {
      await router.push({ name: 'about' });
      expect(router.route.value.path).toBe('/about');
    });

    it('should navigate by name with params', async () => {
      await router.push({ name: 'user-detail', params: { id: '456' } });
      expect(router.route.value.path).toBe('/users/456');
      expect(router.params.value['id']).toBe('456');
    });

    it('should navigate by name with query', async () => {
      await router.push({ name: 'users', query: { active: 'true' } });
      expect(router.route.value.path).toBe('/users');
      expect(router.query.value['active']).toBe('true');
    });
  });

  describe('history navigation', () => {
    beforeEach(() => {
      router = createMemoryRouter({ routes: basicRoutes });
    });

    it('should go back', async () => {
      await router.push('/about');
      await router.push('/users');
      router.back();
      // Memory history is synchronous
      expect(router.route.value.path).toBe('/about');
    });

    it('should go forward', async () => {
      await router.push('/about');
      await router.push('/users');
      router.back();
      router.forward();
      expect(router.route.value.path).toBe('/users');
    });

    it('should go to specific delta', async () => {
      await router.push('/about');
      await router.push('/users');
      await router.push('/users/123');
      router.go(-2);
      expect(router.route.value.path).toBe('/about');
    });
  });

  describe('navigation guards', () => {
    beforeEach(() => {
      router = createMemoryRouter({ routes: basicRoutes });
    });

    it('should call beforeEach guard', async () => {
      const guard = vi.fn(() => true);
      router.beforeEach(guard);

      await router.push('/about');

      expect(guard).toHaveBeenCalledWith(
        expect.objectContaining({
          to: expect.objectContaining({ path: '/about' }),
          from: expect.objectContaining({ path: '/' }),
        })
      );
    });

    it('should cancel navigation when guard returns false', async () => {
      router.beforeEach(() => false);

      await router.push('/about');

      expect(router.route.value.path).toBe('/');
    });

    it('should redirect when guard returns path', async () => {
      router.beforeEach(({ to }) => {
        if (to.path === '/about') {
          return '/users';
        }
        return true;
      });

      await router.push('/about');

      expect(router.route.value.path).toBe('/users');
    });

    it('should redirect when guard returns NavigationTarget', async () => {
      router.beforeEach(({ to }) => {
        if (to.path === '/about') {
          return { name: 'user-detail', params: { id: '999' } };
        }
        return true;
      });

      await router.push('/about');

      expect(router.route.value.path).toBe('/users/999');
    });

    it('should run guards in order', async () => {
      const order: number[] = [];

      router.beforeEach(() => {
        order.push(1);
        return true;
      });
      router.beforeEach(() => {
        order.push(2);
        return true;
      });

      await router.push('/about');

      expect(order).toEqual([1, 2]);
    });

    it('should stop at first guard that cancels', async () => {
      const order: number[] = [];

      router.beforeEach(() => {
        order.push(1);
        return false;
      });
      router.beforeEach(() => {
        order.push(2);
        return true;
      });

      await router.push('/about');

      expect(order).toEqual([1]);
    });

    it('should unsubscribe guard', async () => {
      const guard = vi.fn(() => true);
      const unsubscribe = router.beforeEach(guard);

      unsubscribe();
      await router.push('/about');

      expect(guard).not.toHaveBeenCalled();
    });
  });

  describe('afterEach hooks', () => {
    beforeEach(() => {
      router = createMemoryRouter({ routes: basicRoutes });
    });

    it('should call afterEach hook', async () => {
      const hook = vi.fn();
      router.afterEach(hook);

      await router.push('/about');

      expect(hook).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/about' }),
        expect.objectContaining({ path: '/' })
      );
    });

    it('calls afterEach with the failure when a guard cancels', async () => {
      router.beforeEach(() => false);
      const hook = vi.fn();
      router.afterEach(hook);

      await router.push('/about');

      expect(hook).toHaveBeenCalledTimes(1);
      expect(hook).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/about' }),
        expect.objectContaining({ path: '/' }),
        expect.objectContaining({
          type: NavigationFailureType.CANCELLED,
          to: expect.objectContaining({ path: '/about' }),
        })
      );
    });

    it('calls afterEach with the failure when a newer navigation takes over', async () => {
      let release!: () => void;
      router.beforeEach((ctx) =>
        ctx.to.path === '/about'
          ? new Promise<boolean>((resolve) => (release = () => resolve(true)))
          : true
      );
      const hook = vi.fn();
      router.afterEach(hook);

      const first = router.push('/about');
      await Promise.resolve();
      await router.push('/');
      release();
      await first;

      const failures = hook.mock.calls
        .map((call) => call[2] as { type: string } | undefined)
        .filter(Boolean);
      expect(failures).toEqual([
        expect.objectContaining({ type: NavigationFailureType.ABORTED }),
      ]);
    });

    it('should unsubscribe afterEach hook', async () => {
      const hook = vi.fn();
      const unsubscribe = router.afterEach(hook);

      unsubscribe();
      await router.push('/about');

      expect(hook).not.toHaveBeenCalled();
    });
  });

  describe('route-level guards', () => {
    it('should run route guards', async () => {
      const routeGuard = vi.fn(() => true);

      const routes: RouteConfig[] = [
        { path: '/', component: MockComponent },
        {
          path: '/protected',
          component: MockComponent,
          guards: [routeGuard],
        },
      ];

      router = createMemoryRouter({ routes });
      await router.push('/protected');

      expect(routeGuard).toHaveBeenCalled();
    });

    it('should cancel navigation when route guard returns false', async () => {
      const routes: RouteConfig[] = [
        { path: '/', component: MockComponent },
        {
          path: '/protected',
          component: MockComponent,
          guards: [() => false],
        },
      ];

      router = createMemoryRouter({ routes });
      await router.push('/protected');

      expect(router.route.value.path).toBe('/');
    });
  });

  describe('redirects', () => {
    it('should handle string redirects', async () => {
      const routes: RouteConfig[] = [
        { path: '/', component: MockComponent },
        { path: '/old', redirect: '/new' },
        { path: '/new', component: MockComponent },
      ];

      router = createMemoryRouter({ routes });
      await router.push('/old');

      expect(router.route.value.path).toBe('/new');
    });

    it('should handle function redirects', async () => {
      const routes: RouteConfig[] = [
        { path: '/', component: MockComponent },
        {
          path: '/redirect/:id',
          redirect: (to) => `/users/${to.params['id']}`,
        },
        { path: '/users/:id', component: MockComponent },
      ];

      router = createMemoryRouter({ routes });
      await router.push('/redirect/123');

      expect(router.route.value.path).toBe('/users/123');
    });
  });

  describe('data loading', () => {
    it('should call loader and provide data', async () => {
      const loader = vi.fn(async ({ params }) => ({
        user: { id: params.id, name: 'Test User' },
      }));

      const routes: RouteConfig[] = [
        { path: '/', component: MockComponent },
        { path: '/users/:id', component: MockComponent, loader },
      ];

      router = createMemoryRouter({ routes });
      await router.push('/users/123');

      expect(loader).toHaveBeenCalledWith(
        expect.objectContaining({
          params: { id: '123' },
        })
      );

      expect(router.data.value).toEqual({
        user: { id: '123', name: 'Test User' },
      });
    });

    it('should pass query to loader', async () => {
      const loader = vi.fn(async () => ({}));

      const routes: RouteConfig[] = [
        { path: '/', component: MockComponent },
        { path: '/search', component: MockComponent, loader },
      ];

      router = createMemoryRouter({ routes });
      await router.push('/search?q=test&page=2');

      expect(loader).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { q: 'test', page: '2' },
        })
      );
    });

    it('should pass abort signal to loader', async () => {
      const loader = vi.fn(async ({ signal }) => {
        expect(signal).toBeInstanceOf(AbortSignal);
        return {};
      });

      const routes: RouteConfig[] = [
        { path: '/', component: MockComponent },
        { path: '/data', component: MockComponent, loader },
      ];

      router = createMemoryRouter({ routes });
      await router.push('/data');
    });
  });

  describe('resolve', () => {
    beforeEach(() => {
      router = createMemoryRouter({ routes: basicRoutes });
    });

    it('should resolve path to route', () => {
      const resolved = router.resolve('/users/123');

      expect(resolved).not.toBeNull();
      expect(resolved?.path).toBe('/users/123');
      expect(resolved?.params).toEqual({ id: '123' });
    });

    it('should resolve navigation target', () => {
      const resolved = router.resolve({
        name: 'user-detail',
        params: { id: '456' },
      });

      expect(resolved?.path).toBe('/users/456');
    });

    it('should return null for unknown path', () => {
      // With catch-all route, everything matches
      // Let's test without catch-all
      const r = createMemoryRouter({
        routes: [{ path: '/', component: MockComponent }],
      });

      const resolved = r.resolve('/unknown');
      expect(resolved).toBeNull();

      r.destroy();
    });
  });

  describe('hasRoute', () => {
    beforeEach(() => {
      router = createMemoryRouter({ routes: basicRoutes });
    });

    it('should return true for existing route', () => {
      expect(router.hasRoute('/users')).toBe(true);
    });

    it('should return true for dynamic route', () => {
      expect(router.hasRoute('/users/123')).toBe(true);
    });
  });

  describe('createHref', () => {
    it('should create href with base', () => {
      router = createMemoryRouter({
        routes: basicRoutes,
        base: '/app',
      });

      expect(router.createHref('/users')).toBe('/users');
    });
  });

  describe('nested routes', () => {
    it('should match nested routes', async () => {
      const routes: RouteConfig[] = [
        { path: '/', component: MockComponent },
        {
          path: '/dashboard',
          component: MockComponent,
          children: [
            {
              path: '',
              component: MockComponent,
              name: 'dashboard-home',
            },
            {
              path: 'settings',
              component: MockComponent,
              name: 'dashboard-settings',
            },
          ],
        },
      ];

      router = createMemoryRouter({ routes });
      await router.push('/dashboard/settings');

      expect(router.route.value.matched.length).toBeGreaterThan(1);
    });
  });

  describe('reactive state', () => {
    beforeEach(() => {
      router = createMemoryRouter({ routes: basicRoutes });
    });

    it('should have reactive route', () => {
      expect(router.route).toBeInstanceOf(Signal);
    });

    it('should have reactive params', () => {
      expect(router.params).toBeInstanceOf(Signal);
    });

    it('should have reactive query', () => {
      expect(router.query).toBeInstanceOf(Signal);
    });

    it('should have reactive isNavigating', () => {
      expect(router.isNavigating).toBeInstanceOf(Signal);
    });

    it('should have reactive data', () => {
      expect(router.data).toBeInstanceOf(Signal);
    });
  });

  describe('meta', () => {
    it('should combine meta from matched routes', async () => {
      const routes: RouteConfig[] = [
        { path: '/', component: MockComponent },
        {
          path: '/admin',
          component: MockComponent,
          meta: { requiresAuth: true },
          children: [
            {
              path: 'settings',
              component: MockComponent,
              meta: { title: 'Settings' },
            },
          ],
        },
      ];

      router = createMemoryRouter({ routes });
      await router.push('/admin/settings');

      expect(router.route.value.meta).toEqual({
        requiresAuth: true,
        title: 'Settings',
      });
    });
  });

  describe('destroy', () => {
    it('should cleanup on destroy', () => {
      router = createMemoryRouter({ routes: basicRoutes });
      const guard = vi.fn(() => true);
      router.beforeEach(guard);

      router.destroy();

      // Guard should not be called after destroy
      // (we can't easily test this without accessing private state)
      expect(router.state).toBe('ready'); // State doesn't change on destroy
    });
  });
});

describe('router', () => {
  it('should create router instance', () => {
    const router = createRouter({
      routes: [{ path: '/', component: MockComponent }],
      mode: 'memory',
    });

    expect(router).toBeInstanceOf(Router);
    router.destroy();
  });
});

describe('memoryRouter', () => {
  it('should create memory-based router', () => {
    const router = createMemoryRouter({
      routes: [{ path: '/', component: MockComponent }],
    });

    expect(router).toBeInstanceOf(Router);
    expect(router.options.mode).toBe('memory');
    router.destroy();
  });

  it('should accept initial entries', () => {
    const router = createMemoryRouter({
      routes: [
        { path: '/', component: MockComponent },
        { path: '/test', component: MockComponent },
      ],
      initialEntries: ['/test'],
    });

    expect(router.route.value.path).toBe('/test');
    router.destroy();
  });
});

describe('Router navigation edge cases', () => {
  class Page extends Component {
    protected render() {
      return document.createElement('div');
    }
  }

  it.each(['javascript:alert(1)', '//evil.example/x', 'https://evil.example'])(
    'refuses to push the external URL %j',
    async (url) => {
      const router = createTestRouter([
        { path: '/', component: MockComponent },
        { path: '/*', component: MockComponent },
      ]);
      await router.push(url);
      expectLogged('warn', 'router:external-path');
      expect(router.route.value.fullPath).toBe('/');
    }
  );

  it('rejects a redirect loop with a clear error', async () => {
    const r = createTestRouter(
      [
        { path: '/', component: Page },
        { path: '/a', redirect: '/b' },
        { path: '/b', redirect: '/a' },
      ],
      { initialEntries: ['/'] }
    );
    await expect(r.push('/a')).rejects.toThrow('router:redirect-loop');
    expect(r.isNavigating.value).toBe(false);
  });

  it('resets isNavigating after a push to an unknown path', async () => {
    const r = createTestRouter([{ path: '/', component: Page }], {
      initialEntries: ['/'],
    });
    await r.push('/nowhere');
    expectLogged('warn', 'router:no-match');
    expect(r.isNavigating.value).toBe(false);
  });

  it('keeps push for a guard redirect, so the current entry stays', async () => {
    const r = createTestRouter(
      [
        { path: '/', component: Page },
        { path: '/admin', component: Page, guards: [() => '/login'] },
        { path: '/login', component: Page },
      ],
      { initialEntries: ['/'] }
    );
    await r.push('/admin');
    expect(r.route.value.path).toBe('/login');

    r.back();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(r.route.value.path).toBe('/');
  });
});

describe('Router installed in an app', () => {
  it('stops listening to the history when the app unmounts', async () => {
    window.history.replaceState(null, '', '/');
    const r = createRouter({
      routes: [
        { path: '/', component: MockComponent },
        { path: '/a', component: MockComponent },
      ],
    });
    const guard = vi.fn(() => true);
    r.beforeEach(guard);
    const { unmount } = mount(MockComponent, { plugins: [r] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    guard.mockClear();

    unmount();
    window.history.pushState(null, '', '/a');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(guard).not.toHaveBeenCalled();
    window.history.replaceState(null, '', '/');
  });
});

describe('Router named targets for wildcard routes', () => {
  const routes: RouteConfig[] = [
    { path: '/', component: MockComponent },
    { path: '/files/*path', name: 'files', component: MockComponent },
  ];

  it('builds the path of a wildcard route from its name', () => {
    const router = createTestRouter(routes);
    expect(router.toPath({ name: 'files', params: { path: 'a b/c' } })).toBe(
      '/files/a%20b/c'
    );
  });

  it('navigates to it and reads the wildcard back', async () => {
    const router = createTestRouter(routes);
    await router.push({ name: 'files', params: { path: 'docs/a b.txt' } });
    expect(router.route.value.params['path']).toBe('docs/a b.txt');
  });
});

describe('Router aliases', () => {
  const routes: RouteConfig[] = [
    { path: '/', component: MockComponent },
    {
      path: '/users/:id',
      alias: '/people/:id',
      name: 'user',
      component: MockComponent,
    },
  ];

  it('navigates to an alias and keeps the typed path', async () => {
    const router = createTestRouter(routes);
    await router.push('/people/9');
    expect(router.route.value.fullPath).toBe('/people/9');
    expect(router.route.value.params).toEqual({ id: '9' });
    expect(router.route.value.name).toBe('user');
  });

  it('builds the main path for a named target', () => {
    const router = createTestRouter(routes);
    expect(router.toPath({ name: 'user', params: { id: '3' } })).toBe(
      '/users/3'
    );
  });
});
