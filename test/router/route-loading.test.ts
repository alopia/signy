/**
 * Route level pending and error components, revalidate() and prefetch(),
 * through the router and a mounted Outlet.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Component, Outlet, html, type RenderResult } from '../../src';
import type { RouteConfig } from '../../src/router/types';
import { lazyRoute } from '../../src/router/lazy-route';
import { mount } from '../support/mount';
import { createTestRouter } from '../support/router';
import { expectLogged } from '../support/console';
import { settleAsync } from '../support/tick';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T = unknown>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type PageProps = {
  data?: unknown;
  params?: Record<string, string>;
  error?: unknown;
  retry?: () => void;
};

const page = (name: string) =>
  class extends Component<PageProps> {
    protected render(): RenderResult {
      return html`<p class="page">
        ${name}:${() => String(this.props.data ?? '')}
      </p>`;
    }
  };

class FailedPage extends Component<PageProps> {
  protected render(): RenderResult {
    return html`<p class="page">failed:${() => String(this.props.error)}</p>
      <button onClick=${() => this.props.retry?.()}>retry</button>`;
  }
}

class ParamsPage extends Component<PageProps> {
  protected render(): RenderResult {
    return html`<p class="page">
      params:${() => JSON.stringify(this.props.params)}
    </p>`;
  }
}

class Root extends Component {
  protected render(): RenderResult {
    return html`<div><${Outlet} /></div>`;
  }
}

const Home = page('home');
const Loading = page('loading');
const Report = page('report');

async function setup(routes: RouteConfig[]) {
  const router = createTestRouter(routes, { initialEntries: ['/'] });
  const mounted = mount(Root, { plugins: [router] });
  await settleAsync();
  return { router, ...mounted };
}

const shown = (root: HTMLElement): string[] =>
  Array.from(root.querySelectorAll('.page')).map((n) => n.textContent!);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pending component', () => {
  it('commits the route and shows pending while the loader runs', async () => {
    const load = deferred<string>();
    const { router, root } = await setup([
      { path: '/', component: Home },
      {
        path: '/report',
        component: Report,
        pending: Loading,
        loader: () => load.promise,
      },
    ]);
    const navigation = router.push('/report');
    await settleAsync();

    expect(router.route.value.path).toBe('/report');
    expect(router.loaderState.value).toBe('loading');
    expect(router.isNavigating.value).toBe(true);
    expect(shown(root)).toEqual(['loading:']);

    load.resolve('42');
    await navigation;
    await settleAsync();
    expect(router.loaderState.value).toBe('ready');
    expect(router.isNavigating.value).toBe(false);
    expect(shown(root)).toEqual(['report:42']);
  });

  it('runs afterEach hooks when the route is committed, not when the data arrives', async () => {
    const load = deferred<string>();
    const { router } = await setup([
      { path: '/', component: Home },
      {
        path: '/report',
        component: Report,
        pending: Loading,
        loader: () => load.promise,
      },
    ]);
    const after = vi.fn();
    router.afterEach(after);
    const navigation = router.push('/report');
    await settleAsync();
    expect(after).toHaveBeenCalledOnce();
    load.resolve('x');
    await navigation;
    expect(after).toHaveBeenCalledOnce();
  });

  it('still waits for the loader on a route without a pending component', async () => {
    const load = deferred<string>();
    const { router, root } = await setup([
      { path: '/', component: Home },
      { path: '/report', component: Report, loader: () => load.promise },
    ]);
    const navigation = router.push('/report');
    await settleAsync();
    expect(router.route.value.path).toBe('/');
    expect(router.loaderState.value).toBe('ready');
    expect(shown(root)).toEqual(['home:']);
    load.resolve('1');
    await navigation;
    await settleAsync();
    expect(shown(root)).toEqual(['report:1']);
  });

  it('drops the result of a loader that a newer navigation outran', async () => {
    const slow = deferred<string>();
    const { router, root } = await setup([
      { path: '/', component: Home },
      {
        path: '/report',
        component: Report,
        pending: Loading,
        loader: () => slow.promise,
      },
      { path: '/other', component: page('other') },
    ]);
    const first = router.push('/report');
    await settleAsync();
    await router.push('/other');
    slow.resolve('late');
    await first;
    await settleAsync();
    expect(router.route.value.path).toBe('/other');
    expect(router.loaderState.value).toBe('ready');
    expect(router.data.value).toBeUndefined();
    expect(shown(root)).toEqual(['other:']);
  });

  it('shows pending on the first navigation to a loader route', async () => {
    const load = deferred<string>();
    const router = createTestRouter(
      [
        {
          path: '/',
          component: Report,
          pending: Loading,
          loader: () => load.promise,
        },
      ],
      { initialEntries: ['/'] }
    );
    const { root } = mount(Root, { plugins: [router] });
    await settleAsync();
    expect(shown(root)).toEqual(['loading:']);
    load.resolve('first');
    await settleAsync();
    expect(shown(root)).toEqual(['report:first']);
  });

  it('shows pending only for the leaf of nested routes', async () => {
    const load = deferred<string>();
    class Layout extends Component {
      protected render(): RenderResult {
        return html`<section>
          <h1 class="page">layout</h1>
          <${Outlet} />
        </section>`;
      }
    }
    const { router, root } = await setup([
      { path: '/', component: Home },
      {
        path: '/app',
        component: Layout,
        children: [
          {
            path: 'report',
            component: Report,
            pending: Loading,
            loader: () => load.promise,
          },
        ],
      },
    ]);
    const navigation = router.push('/app/report');
    await settleAsync();
    expect(shown(root)).toEqual(['layout', 'loading:']);
    load.resolve('x');
    await navigation;
    await settleAsync();
    expect(shown(root)).toEqual(['layout', 'report:x']);
  });
});

describe('error component', () => {
  it('shows the error component with the error when the loader fails', async () => {
    const { router, root } = await setup([
      { path: '/', component: Home },
      {
        path: '/report',
        component: Report,
        error: FailedPage,
        loader: () => Promise.reject(new Error('boom')),
      },
    ]);
    await router.push('/report');
    await settleAsync();
    expectLogged('error', 'router:loader-failed');
    expect(router.loaderState.value).toBe('error');
    expect(shown(root)).toEqual(['failed:Error: boom']);
  });

  it('gives the error component the route params', async () => {
    const { router, root } = await setup([
      { path: '/', component: Home },
      {
        path: '/report/:id',
        component: Report,
        error: ParamsPage,
        loader: () => Promise.reject(new Error('nope')),
      },
    ]);
    await router.push('/report/7');
    await settleAsync();
    expectLogged('error', 'router:loader-failed');
    expect(shown(root)).toEqual(['params:{"id":"7"}']);
  });

  it("keeps today's behavior without an error component: logs and renders with no data", async () => {
    const { router, root } = await setup([
      { path: '/', component: Home },
      {
        path: '/report',
        component: Report,
        loader: () => Promise.reject(new Error('x')),
      },
    ]);
    await router.push('/report');
    await settleAsync();
    expectLogged('error', 'router:loader-failed');
    expect(router.loaderState.value).toBe('ready');
    expect(shown(root)).toEqual(['report:']);
  });

  it('retry runs the loader again and shows the component when it works', async () => {
    const loader = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('first'))
      .mockResolvedValueOnce('second');
    const { router, root } = await setup([
      { path: '/', component: Home },
      { path: '/report', component: Report, error: FailedPage, loader },
    ]);
    await router.push('/report');
    await settleAsync();
    expectLogged('error', 'router:loader-failed');
    expect(shown(root)).toEqual(['failed:Error: first']);

    root.querySelector('button')!.click();
    await settleAsync();
    expect(loader).toHaveBeenCalledTimes(2);
    expect(router.loaderState.value).toBe('ready');
    expect(shown(root)).toEqual(['report:second']);
  });

  it('shows the new error when a retry fails again', async () => {
    const loader = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('first'))
      .mockRejectedValueOnce(new Error('second'));
    const { router, root } = await setup([
      { path: '/', component: Home },
      { path: '/report', component: Report, error: FailedPage, loader },
    ]);
    await router.push('/report');
    await settleAsync();
    root.querySelector('button')!.click();
    await settleAsync();
    expectLogged('error', 'router:loader-failed');
    expect(shown(root)).toEqual(['failed:Error: second']);
  });

  it('shows the pending component while a retry runs', async () => {
    const retry = deferred<string>();
    const loader = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('first'))
      .mockReturnValueOnce(retry.promise);
    const { router, root } = await setup([
      { path: '/', component: Home },
      {
        path: '/report',
        component: Report,
        pending: Loading,
        error: FailedPage,
        loader,
      },
    ]);
    await router.push('/report');
    await settleAsync();
    expectLogged('error', 'router:loader-failed');
    expect(shown(root)).toEqual(['failed:Error: first']);

    root.querySelector('button')!.click();
    await settleAsync();
    expect(shown(root)).toEqual(['loading:']);
    retry.resolve('ok');
    await settleAsync();
    expect(shown(root)).toEqual(['report:ok']);
  });

  it('leaves the error state when the user navigates away', async () => {
    const { router, root } = await setup([
      { path: '/', component: Home },
      {
        path: '/report',
        component: Report,
        error: FailedPage,
        loader: () => Promise.reject(new Error('x')),
      },
    ]);
    await router.push('/report');
    await settleAsync();
    expectLogged('error', 'router:loader-failed');
    await router.push('/');
    await settleAsync();
    expect(router.loaderState.value).toBe('ready');
    expect(router.loaderError.value).toBeUndefined();
    expect(shown(root)).toEqual(['home:']);
  });
});

describe('revalidate', () => {
  it('runs the loader again and replaces the data without navigating', async () => {
    let n = 0;
    const loader = vi.fn(async () => ++n);
    const { router, root } = await setup([
      { path: '/', component: Home },
      { path: '/report', component: Report, loader },
    ]);
    await router.push('/report');
    await settleAsync();
    expect(shown(root)).toEqual(['report:1']);

    const push = vi.spyOn(router.history, 'push');
    const replace = vi.spyOn(router.history, 'replace');
    await router.revalidate();
    await settleAsync();
    expect(shown(root)).toEqual(['report:2']);
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(router.route.value.path).toBe('/report');
  });

  it('keeps the old data when the loader fails and there is no error component', async () => {
    const loader = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('old')
      .mockRejectedValueOnce(new Error('later'));
    const { router, root } = await setup([
      { path: '/', component: Home },
      { path: '/report', component: Report, loader },
    ]);
    await router.push('/report');
    await settleAsync();
    await router.revalidate();
    await settleAsync();
    expectLogged('error', 'router:loader-failed');
    expect(router.data.value).toBe('old');
    expect(router.loaderState.value).toBe('ready');
    expect(shown(root)).toEqual(['report:old']);
  });

  it('shows the error component when it fails and the route has one', async () => {
    const loader = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('old')
      .mockRejectedValueOnce(new Error('later'));
    const { router, root } = await setup([
      { path: '/', component: Home },
      { path: '/report', component: Report, error: FailedPage, loader },
    ]);
    await router.push('/report');
    await settleAsync();
    await router.revalidate();
    await settleAsync();
    expectLogged('error', 'router:loader-failed');
    expect(shown(root)).toEqual(['failed:Error: later']);
  });

  it('does nothing for a route without a loader', async () => {
    const { router } = await setup([{ path: '/', component: Home }]);
    await expect(router.revalidate()).resolves.toBeUndefined();
    expect(router.loaderState.value).toBe('ready');
  });

  it('ignores a result that arrives after a navigation', async () => {
    const slow = deferred<string>();
    const { router } = await setup([
      { path: '/', component: Home },
      {
        path: '/report',
        component: Report,
        loader: vi
          .fn()
          .mockResolvedValueOnce('first')
          .mockReturnValueOnce(slow.promise),
      },
      { path: '/other', component: page('other') },
    ]);
    await router.push('/report');
    await settleAsync();
    const revalidation = router.revalidate();
    await router.push('/other');
    slow.resolve('stale');
    await revalidation;
    expect(router.data.value).toBeUndefined();
  });

  it('is cancelled by a newer revalidate()', async () => {
    const slow = deferred<string>();
    const { router } = await setup([
      { path: '/', component: Home },
      {
        path: '/report',
        component: Report,
        loader: vi
          .fn()
          .mockResolvedValueOnce('first')
          .mockReturnValueOnce(slow.promise)
          .mockResolvedValueOnce('newest'),
      },
    ]);
    await router.push('/report');
    await settleAsync();
    const older = router.revalidate();
    await router.revalidate();
    slow.resolve('stale');
    await older;
    expect(router.data.value).toBe('newest');
  });
});

describe('prefetch', () => {
  const routesWith = (loader: RouteConfig['loader']): RouteConfig[] => [
    { path: '/', component: Home },
    { path: '/report', component: Report, loader },
    { path: '/report/:id', component: Report, loader },
  ];

  it('runs the loader once and lets the next navigation take the result', async () => {
    const loader = vi.fn(async () => 'warm');
    const { router, root } = await setup(routesWith(loader));
    await router.prefetch('/report');
    expect(loader).toHaveBeenCalledOnce();
    await router.push('/report');
    await settleAsync();
    expect(loader).toHaveBeenCalledOnce();
    expect(shown(root)).toEqual(['report:warm']);
  });

  it('uses a result once', async () => {
    const loader = vi.fn(async () => 'x');
    const { router } = await setup(routesWith(loader));
    await router.prefetch('/report');
    await router.push('/report');
    await router.push('/');
    await router.push('/report');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('does not start the loader again for a fresh result', async () => {
    const loader = vi.fn(async () => 'x');
    const { router } = await setup(routesWith(loader));
    await router.prefetch('/report');
    await router.prefetch('/report');
    expect(loader).toHaveBeenCalledOnce();
  });

  it('drops a result nobody took within 30 seconds', async () => {
    const loader = vi.fn(async () => 'x');
    const { router } = await setup(routesWith(loader));
    const now = Date.now();
    await router.prefetch('/report');
    vi.spyOn(Date, 'now').mockReturnValue(now + 31_000);
    await router.push('/report');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('keys results by the full path, query included', async () => {
    const loader = vi.fn(
      async ({ query }: { query: Record<string, unknown> }) => query['x']
    );
    const { router } = await setup(routesWith(loader as RouteConfig['loader']));
    await router.prefetch('/report?x=1');
    await router.push('/report?x=2');
    expect(loader).toHaveBeenCalledTimes(2);
    expect(router.data.value).toBe('2');
  });

  it('does not keep a failure, the navigation loads again', async () => {
    const loader = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('cold'))
      .mockResolvedValueOnce('fine');
    const { router } = await setup(routesWith(loader));
    await expect(router.prefetch('/report')).resolves.toBeUndefined();
    await router.push('/report');
    expect(loader).toHaveBeenCalledTimes(2);
    expect(router.data.value).toBe('fine');
  });

  it('does not reject when the loader throws at once', async () => {
    const { router } = await setup(
      routesWith(() => {
        throw new Error('sync');
      })
    );
    await expect(router.prefetch('/report')).resolves.toBeUndefined();
  });

  it('loads the lazy components of the route', async () => {
    const importer = vi.fn(async () => ({ default: Report }));
    const { router } = await setup([
      { path: '/', component: Home },
      { path: '/lazy', component: lazyRoute(importer) },
    ]);
    await router.prefetch('/lazy');
    expect(importer).toHaveBeenCalledOnce();
  });

  it('ignores an unknown or external path', async () => {
    const loader = vi.fn(async () => 'x');
    const { router } = await setup([
      { path: '/', component: Home },
      { path: '/report', component: Report, loader },
    ]);
    await router.prefetch('/nowhere');
    await router.prefetch('https://example.com/report');
    expect(loader).not.toHaveBeenCalled();
  });

  it('takes a named target', async () => {
    const loader = vi.fn(async () => 'x');
    const { router } = await setup([
      { path: '/', component: Home },
      { path: '/report/:id', name: 'report', component: Report, loader },
    ]);
    await router.prefetch({ name: 'report', params: { id: '5' } });
    await router.push('/report/5');
    expect(loader).toHaveBeenCalledOnce();
  });
});

describe('hash changes', () => {
  it('keep the page and its data, and still run guards', async () => {
    const loader = vi.fn(() => ({ n: 1 }));
    const guard = vi.fn(() => undefined);
    const { router, root } = await setup([
      { path: '/', component: Home },
      { path: '/doc', component: Report, loader, guards: [guard] },
    ]);
    await router.push('/doc');
    await settleAsync();
    const page = root.querySelector('.page');
    const data = router.data.value;

    await router.push('/doc#part');
    await settleAsync();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(guard).toHaveBeenCalledTimes(2);
    expect(router.data.value).toBe(data);
    expect(router.route.value.hash).toBe('part');
    expect(root.querySelector('.page')).toBe(page);
  });

  it('with another query load again', async () => {
    const loader = vi.fn(() => ({}));
    const { router } = await setup([
      { path: '/', component: Home },
      { path: '/doc', component: Report, loader },
    ]);
    await router.push('/doc#a');
    await router.push('/doc?x=1#a');
    await settleAsync();
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
