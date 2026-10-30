/**
 * Outlet rendering through a mounted app.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  Component,
  Outlet,
  html,
  onMount,
  onCleanup,
  type RenderResult,
} from '../../src';
import {
  useParams,
  useQuery,
  useRoute,
  useRouteData,
  useRouter,
} from '../../src/router/composables';
import type { RouteConfig } from '../../src/router/types';
import { lazyRoute } from '../../src/router/lazy-route';
import { mount } from '../support/mount';
import { createTestRouter } from '../support/router';
import { settle, settleAsync } from '../support/tick';

const page = (name: string) =>
  class extends Component {
    protected render(): RenderResult {
      return html`<p class="page">${name}</p>`;
    }
  };

class Layout extends Component {
  protected render(): RenderResult {
    return html`<main>
      <h1>layout</h1>
      <${Outlet} />
    </main>`;
  }
}

class Root extends Component {
  protected render(): RenderResult {
    return html`<div><${Outlet} /></div>`;
  }
}

async function setup(routes: RouteConfig[], initial = '/') {
  const router = createTestRouter(routes, { initialEntries: [initial] });
  const mounted = mount(Root, { plugins: [router] });
  await settleAsync();
  return { router, ...mounted };
}

const text = (root: HTMLElement) =>
  Array.from(root.querySelectorAll('.page')).map((n) => n.textContent);

describe('Outlet', () => {
  it('renders the matched route component', async () => {
    const { root } = await setup(
      [
        { path: '/', component: page('home') },
        { path: '/about', component: page('about') },
      ],
      '/about'
    );
    expect(text(root)).toEqual(['about']);
  });

  it('swaps the component on navigation', async () => {
    const { root, router } = await setup([
      { path: '/', component: page('home') },
      { path: '/about', component: page('about') },
    ]);
    expect(text(root)).toEqual(['home']);

    await router.push('/about');
    settle();
    expect(text(root)).toEqual(['about']);
  });

  it('renders nested routes into nested outlets', async () => {
    const { root, router } = await setup(
      [
        {
          path: '/users',
          component: Layout,
          children: [
            { path: '', component: page('list') },
            { path: ':id', component: page('detail') },
          ],
        },
      ],
      '/users'
    );
    expect(root.querySelector('h1')?.textContent).toBe('layout');
    expect(text(root)).toEqual(['list']);

    await router.push('/users/7');
    settle();
    expect(text(root)).toEqual(['detail']);
  });

  it('renders nothing when no route matches', async () => {
    const { root } = await setup(
      [{ path: '/', component: page('home') }],
      '/missing'
    );
    expect(text(root)).toEqual([]);
  });

  it('passes params, query and loader data as props', async () => {
    let props: Record<string, unknown> = {};
    class Detail extends Component<Record<string, unknown>> {
      protected render(): RenderResult {
        props = this.props;
        return html`<p class="page">detail</p>`;
      }
    }

    await setup(
      [
        {
          path: '/users/:id',
          component: Detail,
          loader: ({ params }) => ({ name: `user ${params['id']}` }),
        },
      ],
      '/users/3?tab=info'
    );

    expect(props['params']).toEqual({ id: '3' });
    expect(props['query']).toEqual({ tab: 'info' });
    expect(props['data']).toEqual({ name: 'user 3' });
  });

  it('runs setup and onMount of the routed component', async () => {
    const mounted = vi.fn();
    class WithMount extends Component {
      protected setup(): void {
        onMount(mounted);
      }
      protected render(): RenderResult {
        return html`<p class="page">x</p>`;
      }
    }

    await setup([{ path: '/', component: WithMount }]);
    settle();
    expect(mounted).toHaveBeenCalledTimes(1);
  });

  it('cleans up the previous route component on navigation', async () => {
    const cleanup = vi.fn();
    class First extends Component {
      protected setup(): void {
        onCleanup(cleanup);
      }
      protected render(): RenderResult {
        return html`<p class="page">first</p>`;
      }
    }

    const { router } = await setup([
      { path: '/', component: First },
      { path: '/next', component: page('next') },
    ]);
    await router.push('/next');
    settle();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});

describe('router composables inside a routed component', () => {
  it('give access to the router, params, query and data', async () => {
    const seen: Record<string, unknown> = {};
    class Probe extends Component {
      protected render(): RenderResult {
        seen['router'] = useRouter(this);
        seen['params'] = useParams(this).value;
        seen['query'] = useQuery(this).value;
        seen['data'] = useRouteData(this).value;
        seen['path'] = useRoute(this).value.path;
        return html`<p class="page">probe</p>`;
      }
    }

    const { router } = await setup(
      [{ path: '/items/:id', component: Probe, loader: () => 'loaded' }],
      '/items/9?sort=asc'
    );

    expect(seen['router']).toBe(router);
    expect(seen['params']).toEqual({ id: '9' });
    expect(seen['query']).toEqual({ sort: 'asc' });
    expect(seen['data']).toBe('loaded');
    expect(seen['path']).toBe('/items/9');
  });

  it('useRouter panics without a router', () => {
    class Lonely extends Component {
      protected render(): RenderResult {
        useRouter(this);
        return null;
      }
    }
    expect(() => mount(Lonely)).toThrow();
  });
});

describe('Outlet remounts', () => {
  function counted(name: string, mounts: string[]) {
    return class extends Component<{ query: Record<string, unknown> }> {
      protected setup(): void {
        this.onMount(() => {
          mounts.push(name);
        });
      }
      protected render(): RenderResult {
        return html`<p class="page">
          ${() => String(this.props.query['q'] ?? '')}
        </p>`;
      }
    };
  }

  it('keeps the component when only the query changes, with a live query prop', async () => {
    const mounts: string[] = [];
    const { root, router } = await setup(
      [{ path: '/search', component: counted('search', mounts) }],
      '/search?q=a'
    );
    expect(mounts).toEqual(['search']);

    await router.push('/search?q=b');
    settle();
    expect(mounts).toEqual(['search']);
    expect(text(root)).toEqual(['b']);
  });

  it('remounts when the params change', async () => {
    const mounts: string[] = [];
    const { router } = await setup(
      [{ path: '/users/:id', component: counted('user', mounts) }],
      '/users/1'
    );

    await router.push('/users/2');
    settle();
    expect(mounts).toEqual(['user', 'user']);
  });

  it('keeps the layout when a child route changes', async () => {
    const mounts: string[] = [];
    class Layout extends Component {
      protected setup(): void {
        this.onMount(() => {
          mounts.push('layout');
        });
      }
      protected render(): RenderResult {
        return html`<section><${Outlet} /></section>`;
      }
    }
    const { router } = await setup(
      [
        {
          path: '/dash',
          component: Layout,
          children: [
            { path: 'a', component: page('a') },
            { path: 'b', component: page('b') },
          ],
        },
      ],
      '/dash/a'
    );

    await router.push('/dash/b');
    settle();
    expect(mounts).toEqual(['layout']);
  });
});

describe('Outlet under a lazy layout', () => {
  it('renders the layout once and the child once', async () => {
    const LazyLayout = lazyRoute(() => Promise.resolve({ default: Layout }));
    const { root } = await setup(
      [
        {
          path: '/users',
          component: LazyLayout,
          children: [{ path: '', component: page('list') }],
        },
      ],
      '/users'
    );
    await settleAsync();
    expect(root.querySelectorAll('h1')).toHaveLength(1);
    expect(text(root)).toEqual(['list']);
  });
});
