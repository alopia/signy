/**
 * A routed app with layouts, loaders, guards, lazy routes and a 404 page.
 */

import { describe, it, expect, vi } from 'vitest';
import { within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { Component, Link, Outlet, html, type RenderResult } from '../../src';
import { lazyRoute } from '../../src/router/lazy-route';
import { useRouteData } from '../../src/router/composables';
import type { RouteConfig } from '../../src/router/types';
import { mount } from '../support/mount';
import { createTestRouter } from '../support/router';
import { settle, settleAsync } from '../support/tick';

const page = (title: string) =>
  class extends Component {
    protected render(): RenderResult {
      return html`<h2>${title}</h2>`;
    }
  };

class Shell extends Component {
  protected render(): RenderResult {
    return html`<div>
      <nav>
        <${Link} to="/">Home</${Link}>
        <${Link} to="/users">Users</${Link}>
        <${Link} to="/admin">Admin</${Link}>
        <${Link} to="/reports">Reports</${Link}>
      </nav>
      <main><${Outlet} /></main>
    </div>`;
  }
}

class UsersLayout extends Component {
  protected render(): RenderResult {
    return html`<section>
      <h1>Users</h1>
      <${Outlet} />
    </section>`;
  }
}

class UserDetail extends Component {
  protected render(): RenderResult {
    const data = useRouteData<{ name: string }>(this);
    return html`<h2>${() => data.value?.name ?? 'loading'}</h2>`;
  }
}

function createApp(options: { admin?: boolean } = {}) {
  const loader = vi.fn(
    async ({ params }: { params: Record<string, string> }) => ({
      name: `User ${params['id']}`,
    })
  );
  const reportsImport = vi.fn(() =>
    Promise.resolve({ default: page('Reports') })
  );

  const routes: RouteConfig[] = [
    { path: '/', component: page('Home') },
    {
      path: '/users',
      component: UsersLayout,
      children: [
        { path: '', component: page('All users') },
        { path: ':id', component: UserDetail, loader },
      ],
    },
    {
      path: '/admin',
      component: page('Admin'),
      guards: [() => (options.admin ? true : '/')],
    },
    { path: '/old-users', redirect: '/users' },
    { path: '/reports', component: lazyRoute(reportsImport) },
    { path: '*', component: page('Not found') },
  ];

  const router = createTestRouter(routes);
  const { root } = mount(Shell, { plugins: [router] });
  return { root, router, loader, reportsImport };
}

const heading = (root: HTMLElement) =>
  Array.from(root.querySelectorAll('main h1, main h2')).map(
    (h) => h.textContent
  );

async function go(
  router: ReturnType<typeof createApp>['router'],
  path: string
) {
  await router.push(path);
  await settleAsync();
}

describe('routed app', () => {
  it('navigates with links', async () => {
    const { root } = createApp();
    expect(heading(root)).toEqual(['Home']);

    await userEvent.click(within(root).getByRole('link', { name: 'Users' }));
    await settleAsync();
    expect(heading(root)).toEqual(['Users', 'All users']);
  });

  it('loads route data for nested routes', async () => {
    const { root, router, loader } = createApp();
    await go(router, '/users/7');
    settle();

    expect(loader).toHaveBeenCalledTimes(1);
    expect(heading(root)).toEqual(['Users', 'User 7']);
  });

  it('redirects from a guard', async () => {
    const { root, router } = createApp();
    await go(router, '/admin');
    expect(router.route.value.path).toBe('/');
    expect(heading(root)).toEqual(['Home']);
  });

  it('lets an allowed guard through', async () => {
    const { root, router } = createApp({ admin: true });
    await go(router, '/admin');
    expect(heading(root)).toEqual(['Admin']);
  });

  it('follows route redirects', async () => {
    const { router } = createApp();
    await go(router, '/old-users');
    expect(router.route.value.path).toBe('/users');
  });

  it('loads lazy routes once', async () => {
    const { root, router, reportsImport } = createApp();
    await go(router, '/reports');
    await settleAsync();
    expect(heading(root)).toEqual(['Reports']);

    await go(router, '/');
    await go(router, '/reports');
    expect(reportsImport).toHaveBeenCalledTimes(1);
  });

  it('shows the catch all route for unknown paths', async () => {
    const { root, router } = createApp();
    await go(router, '/nope/deep');
    expect(heading(root)).toEqual(['Not found']);
  });

  it('goes back and forward', async () => {
    const { root, router } = createApp();
    await go(router, '/users');
    await go(router, '/users/1');

    router.back();
    await settleAsync();
    expect(heading(root)).toEqual(['Users', 'All users']);

    router.forward();
    await settleAsync();
    expect(router.route.value.path).toBe('/users/1');
  });
});

describe('two routed apps on one page', () => {
  class Frame extends Component {
    protected render(): RenderResult {
      return html`<div><${Outlet} /></div>`;
    }
  }

  const routes = (name: string): RouteConfig[] => [
    { path: '/', redirect: '/a' },
    { path: '/a', component: page(`${name} A`) },
    { path: '/b', component: page(`${name} B`) },
  ];

  const titles = (root: HTMLElement) =>
    Array.from(root.querySelectorAll('h2')).map((h) => h.textContent);

  // Each first route redirects, which used to stop a second router showing anything
  it('render and navigate on their own with memory routers', async () => {
    const first = createTestRouter(routes('First'));
    const second = createTestRouter(routes('Second'));
    const one = mount(Frame, { plugins: [first] });
    const two = mount(Frame, { plugins: [second] });
    await settleAsync();

    expect(titles(one.root)).toEqual(['First A']);
    expect(titles(two.root)).toEqual(['Second A']);

    await go(second, '/b');
    expect(titles(one.root)).toEqual(['First A']);
    expect(titles(two.root)).toEqual(['Second B']);
  });
});
