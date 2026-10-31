/**
 * Router composables: what they return inside a routed app, and that they
 * throw without a router.
 */

import { describe, it, expect } from 'vitest';
import { Component, html, type RenderResult } from '../../src';
import {
  useIsNavigating,
  useParams,
  useQuery,
  useRoute,
  useRouteData,
  useRouter,
} from '../../src/router/composables';
import type { Router } from '../../src/router/router';
import { mount } from '../support/mount';
import { createTestRouter } from '../support/router';
import { settleAsync } from '../support/tick';

const composables: Record<string, (component: Component) => unknown> = {
  useRouter,
  useRoute,
  useParams,
  useQuery,
  useRouteData,
  useIsNavigating,
};

/** Mounts a root that calls `use` in setup() and keeps what it returned */
async function inApp(use: (c: Component) => unknown, router?: Router) {
  let result: unknown;
  class Root extends Component {
    protected setup(): void {
      result = use(this);
    }
    protected render(): RenderResult {
      return html`<p></p>` as RenderResult;
    }
  }
  mount(Root, { plugins: router ? [router] : [] });
  await settleAsync();
  return result;
}

describe('router composables', () => {
  it('read the router and its live state', async () => {
    const router = createTestRouter(
      [
        {
          path: '/users/:id',
          component: class extends Component {
            protected render(): RenderResult {
              return null;
            }
          },
          loader: () => ({ name: 'Ada' }),
        },
      ],
      { initialEntries: ['/users/7?tab=posts'] }
    );
    const got = (await inApp(
      (c) => ({
        router: useRouter(c),
        route: useRoute(c),
        params: useParams(c),
        query: useQuery(c),
        data: useRouteData<{ name: string }>(c),
        navigating: useIsNavigating(c),
      }),
      router
    )) as Record<string, { value: unknown }>;

    expect(got['router']).toBe(router);
    expect((got['route']!.value as { path: string }).path).toBe('/users/7');
    expect(got['params']!.value).toEqual({ id: '7' });
    expect(got['query']!.value).toEqual({ tab: 'posts' });
    expect(got['data']!.value).toEqual({ name: 'Ada' });
    expect(got['navigating']!.value).toBe(false);

    await router.push('/users/8');
    expect(got['params']!.value).toEqual({ id: '8' });
  });

  it.each(Object.entries(composables))(
    '%s throws without a router',
    async (_name, use) => {
      await expect(inApp((c) => use(c))).rejects.toThrow(
        'router:not-installed'
      );
    }
  );
});
