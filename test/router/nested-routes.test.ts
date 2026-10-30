/**
 * Nested route matching and route loaders. Rendering through Outlet is
 * covered in outlet.test.ts.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { Component } from '../../src/component/component';
import {
  type Router,
  memoryRouter as createMemoryRouter,
} from '../../src/router/router';
import { Signal } from '../../src/reactivity';
import type { RouteConfig, RouteLoaderContext } from '../../src/router/types';

const page = (name: string) =>
  class extends Component {
    protected render() {
      const div = document.createElement('div');
      div.className = name;
      return div;
    }
  };

const HomeComponent = page('home');
const UsersLayoutComponent = page('users-layout');
const UsersListComponent = page('users-list');
const UserDetailComponent = page('user-detail');
const DashboardLayoutComponent = page('dashboard-layout');
const DashboardHomeComponent = page('dashboard-home');
const DashboardSettingsComponent = page('dashboard-settings');

describe('nested routes', () => {
  let router: Router;

  afterEach(() => {
    router?.destroy();
  });

  describe('matching', () => {
    it('should match parent and index child (path: "")', async () => {
      const routes: RouteConfig[] = [
        { path: '/', component: HomeComponent },
        {
          path: '/users',
          component: UsersLayoutComponent,
          children: [
            { path: '', component: UsersListComponent },
            { path: ':id', component: UserDetailComponent },
          ],
        },
      ];

      router = createMemoryRouter({ routes });

      // Navigate to /users - should render UsersLayout with UsersList as child
      await router.push('/users');

      // Verify route matched both parent and child
      expect(router.route.value.matched.length).toBe(2);
      expect(router.route.value.matched[0]?.route.config.component).toBe(
        UsersLayoutComponent
      );
      expect(router.route.value.matched[1]?.route.config.component).toBe(
        UsersListComponent
      );
    });

    it('should match parent and parameterized child', async () => {
      const routes: RouteConfig[] = [
        { path: '/', component: HomeComponent },
        {
          path: '/users',
          component: UsersLayoutComponent,
          children: [
            { path: '', component: UsersListComponent },
            { path: ':id', component: UserDetailComponent },
          ],
        },
      ];

      router = createMemoryRouter({ routes });

      // Navigate to /users/123 - should render UsersLayout with UserDetail as child
      await router.push('/users/123');

      expect(router.route.value.matched.length).toBe(2);
      expect(router.route.value.matched[0]?.route.config.component).toBe(
        UsersLayoutComponent
      );
      expect(router.route.value.matched[1]?.route.config.component).toBe(
        UserDetailComponent
      );
      expect(router.params.value['id']).toBe('123');
    });

    it('should switch between children of the same layout', async () => {
      const routes: RouteConfig[] = [
        {
          path: '/dashboard',
          component: DashboardLayoutComponent,
          children: [
            { path: '', component: DashboardHomeComponent },
            { path: 'settings', component: DashboardSettingsComponent },
          ],
        },
      ];

      router = createMemoryRouter({ routes });

      await router.push('/dashboard');
      expect(router.route.value.matched.length).toBe(2);
      expect(router.route.value.matched[1]?.route.config.component).toBe(
        DashboardHomeComponent
      );

      await router.push('/dashboard/settings');
      expect(router.route.value.matched.length).toBe(2);
      expect(router.route.value.matched[1]?.route.config.component).toBe(
        DashboardSettingsComponent
      );
    });
  });

  describe('route data loading', () => {
    it('should call loader and set data in router.data Signal', async () => {
      const mockUser = { id: 1, name: 'Alice', email: 'alice@example.com' };
      const loader = vi.fn(async (_ctx: RouteLoaderContext) => {
        return { user: mockUser };
      });

      const routes: RouteConfig[] = [
        {
          path: '/users/:id',
          component: UserDetailComponent,
          loader,
        },
      ];

      router = createMemoryRouter({ routes });

      await router.push('/users/1');

      // Loader should have been called
      expect(loader).toHaveBeenCalledTimes(1);
      expect(loader).toHaveBeenCalledWith(
        expect.objectContaining({
          params: { id: '1' },
        })
      );

      // Data should be in router.data Signal
      expect(router.data).toBeInstanceOf(Signal);
      expect(router.data.value).toEqual({ user: mockUser });
    });

    it('should update data when navigating between routes with loaders', async () => {
      const users: Record<string, { name: string }> = {
        '1': { name: 'Alice' },
        '2': { name: 'Bob' },
        '3': { name: 'Charlie' },
      };

      const loader = vi.fn(async (ctx: RouteLoaderContext) => {
        const id = ctx.params['id'] as string;
        return { user: users[id] };
      });

      const routes: RouteConfig[] = [
        { path: '/', component: HomeComponent },
        {
          path: '/users/:id',
          component: UserDetailComponent,
          loader,
        },
      ];

      router = createMemoryRouter({ routes });

      // Navigate to user 1
      await router.push('/users/1');
      expect(router.data.value).toEqual({ user: { name: 'Alice' } });

      // Navigate to user 2
      await router.push('/users/2');
      expect(router.data.value).toEqual({ user: { name: 'Bob' } });

      // Navigate to user 3
      await router.push('/users/3');
      expect(router.data.value).toEqual({ user: { name: 'Charlie' } });

      expect(loader).toHaveBeenCalledTimes(3);
    });

    it('should handle loader in nested child route', async () => {
      const loader = vi.fn(async (ctx: RouteLoaderContext) => {
        return { user: { id: ctx.params['id'], name: 'Test User' } };
      });

      const routes: RouteConfig[] = [
        {
          path: '/users',
          component: UsersLayoutComponent,
          children: [
            { path: '', component: UsersListComponent },
            {
              path: ':id',
              component: UserDetailComponent,
              loader,
            },
          ],
        },
      ];

      router = createMemoryRouter({ routes });

      await router.push('/users/42');

      expect(loader).toHaveBeenCalledWith(
        expect.objectContaining({
          params: { id: '42' },
        })
      );
      expect(router.data.value).toEqual({
        user: { id: '42', name: 'Test User' },
      });
    });
  });

  describe('router.data', () => {
    it('should be a Signal holding the loader result', async () => {
      const mockData = { user: { name: 'Test' } };
      const loader = vi.fn(async () => mockData);

      const routes: RouteConfig[] = [
        {
          path: '/users/:id',
          component: UserDetailComponent,
          loader,
        },
      ];

      router = createMemoryRouter({ routes });
      await router.push('/users/1');

      // The router.data should be a Signal with the loaded data
      expect(router.data).toBeInstanceOf(Signal);
      expect(router.data.value).toEqual(mockData);
    });

    it('should have data accessible after navigation completes', async () => {
      const loader = vi.fn(async (ctx: RouteLoaderContext) => {
        // Simulate async delay
        await new Promise((r) => setTimeout(r, 10));
        return { user: { id: ctx.params['id'], name: 'Loaded User' } };
      });

      const routes: RouteConfig[] = [
        {
          path: '/users/:id',
          component: UserDetailComponent,
          loader,
        },
      ];

      router = createMemoryRouter({ routes });

      // Navigate and wait for completion
      await router.push('/users/5');

      // Data should be available
      const data = router.data.value as { user: { id: string; name: string } };
      expect(data.user.id).toBe('5');
      expect(data.user.name).toBe('Loaded User');
    });
  });

  describe('navigation between nested and non-nested routes', () => {
    it('should clear child route when navigating to parent index', async () => {
      const routes: RouteConfig[] = [
        {
          path: '/users',
          component: UsersLayoutComponent,
          children: [
            { path: '', component: UsersListComponent },
            { path: ':id', component: UserDetailComponent },
          ],
        },
      ];

      router = createMemoryRouter({ routes });

      // Navigate to user detail
      await router.push('/users/1');
      expect(router.route.value.matched[1]?.route.config.component).toBe(
        UserDetailComponent
      );

      // Navigate back to users list
      await router.push('/users');
      expect(router.route.value.matched[1]?.route.config.component).toBe(
        UsersListComponent
      );
    });

    it('should handle navigation from nested to non-nested route', async () => {
      const routes: RouteConfig[] = [
        { path: '/', component: HomeComponent },
        {
          path: '/users',
          component: UsersLayoutComponent,
          children: [
            { path: '', component: UsersListComponent },
            { path: ':id', component: UserDetailComponent },
          ],
        },
      ];

      router = createMemoryRouter({ routes });

      // Start at nested route
      await router.push('/users/1');
      expect(router.route.value.matched.length).toBe(2);

      // Navigate to home (non-nested)
      await router.push('/');
      expect(router.route.value.matched.length).toBe(1);
      expect(router.route.value.matched[0]?.route.config.component).toBe(
        HomeComponent
      );
    });
  });

  describe('route matching edge cases', () => {
    it('should correctly match index route with empty path', async () => {
      const routes: RouteConfig[] = [
        {
          path: '/section',
          component: DashboardLayoutComponent,
          children: [
            {
              path: '',
              component: DashboardHomeComponent,
              name: 'section-index',
            },
            {
              path: 'sub',
              component: DashboardSettingsComponent,
              name: 'section-sub',
            },
          ],
        },
      ];

      router = createMemoryRouter({ routes });

      await router.push('/section');

      // Should match both parent and index child
      expect(router.route.value.matched.length).toBe(2);
      expect(router.route.value.name).toBe('section-index');
    });

    it('should correctly match sub-route after index', async () => {
      const routes: RouteConfig[] = [
        {
          path: '/section',
          component: DashboardLayoutComponent,
          children: [
            {
              path: '',
              component: DashboardHomeComponent,
              name: 'section-index',
            },
            {
              path: 'sub',
              component: DashboardSettingsComponent,
              name: 'section-sub',
            },
          ],
        },
      ];

      router = createMemoryRouter({ routes });

      await router.push('/section/sub');

      expect(router.route.value.matched.length).toBe(2);
      expect(router.route.value.name).toBe('section-sub');
    });
  });
});
