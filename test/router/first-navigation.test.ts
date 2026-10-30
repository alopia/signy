/**
 * Guards and redirects on the first navigation and on history traversal.
 * Both used to skip every guard, so a guarded page opened without its checks.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { memoryRouter, router as createRouter } from '../../src/router/router';
import type { Router } from '../../src/router/router';
import { Component } from '../../src/component/component';

class Page extends Component {
  protected render() {
    return document.createElement('div');
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('first navigation', () => {
  let router: Router;

  afterEach(() => {
    router?.destroy();
  });

  it('runs a beforeEach() guard added right after router()', async () => {
    router = memoryRouter({
      routes: [
        { path: '/', component: Page },
        { path: '/private', component: Page, meta: { private: true } },
        { path: '/login', component: Page },
      ],
      initialEntries: ['/private'],
    });
    router.beforeEach(({ to }) => (to.meta['private'] ? '/login' : undefined));

    await tick();
    expect(router.route.value.path).toBe('/login');
    expect(router.history.location.value.path).toBe('/login');
  });

  it('runs a route guard', async () => {
    const guard = vi.fn(() => '/login');
    router = memoryRouter({
      routes: [
        { path: '/admin', component: Page, guards: [guard] },
        { path: '/login', component: Page },
      ],
      initialEntries: ['/admin'],
    });

    await tick();
    expect(guard).toHaveBeenCalledOnce();
    expect(router.route.value.path).toBe('/login');
  });

  it('follows a redirect on the first route', async () => {
    router = memoryRouter({
      routes: [
        { path: '/', redirect: '/users/1' },
        { path: '/users/:id', component: Page },
      ],
    });

    await tick();
    expect(router.route.value.path).toBe('/users/1');
    expect(router.params.value).toEqual({ id: '1' });
  });

  it('shows no route until a guarded first route is allowed', async () => {
    let allow!: (value: boolean) => void;
    router = memoryRouter({
      routes: [
        {
          path: '/slow',
          component: Page,
          guards: [() => new Promise<boolean>((resolve) => (allow = resolve))],
        },
      ],
      initialEntries: ['/slow'],
    });

    expect(router.route.value.matched).toHaveLength(0);
    await tick();
    expect(router.route.value.matched).toHaveLength(0);
    allow(true);
    await tick();
    expect(router.route.value.path).toBe('/slow');
  });

  it('shows no route until a beforeEach() guard has run', async () => {
    router = memoryRouter({
      routes: [{ path: '/', component: Page }],
    });
    router.beforeEach(() => undefined);

    expect(router.route.value.matched).toHaveLength(0);
    await tick();
    expect(router.route.value.path).toBe('/');
  });

  it('resolves an unguarded first route at once', () => {
    router = memoryRouter({
      routes: [{ path: '/about', component: Page }],
      initialEntries: ['/about'],
    });

    expect(router.route.value.path).toBe('/about');
  });

  it('runs the loader of the first route before showing it', async () => {
    router = memoryRouter({
      routes: [{ path: '/', component: Page, loader: async () => 'loaded' }],
    });

    expect(router.route.value.matched).toHaveLength(0);
    await tick();
    expect(router.route.value.path).toBe('/');
    expect(router.data.value).toBe('loaded');
  });

  it('runs a hash router guard on the first navigation', async () => {
    window.location.hash = '#/private';
    router = createRouter({
      mode: 'hash',
      routes: [
        { path: '/', component: Page },
        { path: '/private', component: Page, guards: [() => '/'] },
      ],
    });

    await tick();
    expect(router.route.value.path).toBe('/');
    expect(window.location.hash).toBe('#/');
    window.location.hash = '';
  });
});

describe('history traversal', () => {
  let router: Router;

  afterEach(() => {
    router?.destroy();
  });

  it('runs guards on back and forward', async () => {
    let signedIn = true;
    const guard = vi.fn(() => (signedIn ? undefined : false));
    router = memoryRouter({
      routes: [
        { path: '/', component: Page },
        { path: '/account', component: Page, guards: [guard] },
      ],
    });
    await router.push('/account');
    await router.push('/');
    guard.mockClear();

    signedIn = false;
    router.back();
    await tick();

    expect(guard).toHaveBeenCalledOnce();
    expect(router.route.value.path).toBe('/');
  });

  it('puts the address back when a guard cancels', async () => {
    let allowed = true;
    router = memoryRouter({
      routes: [
        { path: '/', component: Page },
        { path: '/account', component: Page, guards: [() => allowed] },
      ],
    });
    await router.push('/account');
    await router.push('/');

    allowed = false;
    router.back();
    await tick();

    expect(router.history.location.value.path).toBe('/');
  });

  it('follows a guard redirect on back', async () => {
    let signedIn = true;
    router = memoryRouter({
      routes: [
        { path: '/', component: Page },
        { path: '/login', component: Page },
        {
          path: '/account',
          component: Page,
          guards: [() => (signedIn ? undefined : '/login')],
        },
      ],
    });
    await router.push('/account');
    await router.push('/');

    signedIn = false;
    router.back();
    await tick();

    expect(router.route.value.path).toBe('/login');
    expect(router.history.location.value.path).toBe('/login');
  });

  it('puts the address back when a guard redirects to the route on screen', async () => {
    let signedIn = true;
    router = memoryRouter({
      routes: [
        { path: '/', component: Page },
        { path: '/account', component: Page, guards: [() => signedIn || '/'] },
      ],
    });
    await router.push('/account');
    await router.push('/');

    signedIn = false;
    router.back();
    await tick();

    expect(router.route.value.path).toBe('/');
    expect(router.history.location.value.path).toBe('/');
  });

  it('keeps the entry left when a guard cancels back', async () => {
    let allowed = true;
    router = memoryRouter({
      routes: [
        { path: '/', component: Page },
        { path: '/account', component: Page, guards: [() => allowed] },
      ],
    });
    await router.push('/account');
    await router.push('/');

    allowed = false;
    router.back();
    await tick();
    expect(router.route.value.path).toBe('/');

    allowed = true;
    router.back();
    await tick();
    expect(router.route.value.path).toBe('/account');
  });

  it('keeps the entry left when a guard cancels forward', async () => {
    let allowed = true;
    router = memoryRouter({
      routes: [
        { path: '/', component: Page },
        { path: '/account', component: Page, guards: [() => allowed] },
      ],
    });
    await router.push('/account');
    router.back();
    await tick();

    allowed = false;
    router.forward();
    await tick();
    expect(router.route.value.path).toBe('/');
    expect(router.history.location.value.path).toBe('/');

    allowed = true;
    router.forward();
    await tick();
    expect(router.route.value.path).toBe('/account');
  });

  it('does not step back for a guard that answers after a newer move', async () => {
    let answer!: (value: boolean) => void;
    router = memoryRouter({
      routes: [
        { path: '/', component: Page },
        { path: '/a', component: Page },
        {
          path: '/b',
          component: Page,
          guards: [() => new Promise<boolean>((resolve) => (answer = resolve))],
        },
        { path: '/c', component: Page },
      ],
      initialEntries: ['/', '/a', '/b', '/c'],
    });
    await tick();

    router.back();
    await tick();
    router.back();
    await tick();
    expect(router.route.value.path).toBe('/a');

    answer(false);
    await tick();
    expect(router.route.value.path).toBe('/a');
    expect(router.history.location.value.path).toBe('/a');
  });
});
