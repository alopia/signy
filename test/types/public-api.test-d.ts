/**
 * Type tests for the public API. Run by `vitest --typecheck`, never executed.
 */

import { describe, it, expectTypeOf } from 'vitest';
import {
  Signal,
  Computed,
  signal,
  computed,
  batch,
  createRoot,
  Component,
  Show,
  For,
  type RenderResult,
} from '../../src';
import {
  mergeProps,
  splitProps,
  withDefaults,
} from '../../src/component/props';
import type {
  RouteConfig,
  RouteLoader,
  RouteParams,
  NavigationGuard,
  PathParams,
} from '../../src/router/types';
import { defineRoute, generatePath } from '../../src/router/route';
import { useParams } from '../../src/router/composables';
import type { Accessor, JSX } from '../../src/jsx';
import { ReactiveMap, ReactiveSet } from '../../src/reactivity';
import { Resource } from '../../src/reactivity/resource';
import { lazy } from '../../src/views/lazy';

describe('signals', () => {
  it('infers value types', () => {
    expectTypeOf(new Signal(1).value).toEqualTypeOf<number>();
    expectTypeOf(signal('a').value).toEqualTypeOf<string>();
    expectTypeOf(new Computed(() => [1, 2]).value).toEqualTypeOf<number[]>();
    expectTypeOf(computed(() => ({ ok: true })).value).toEqualTypeOf<{
      ok: boolean;
    }>();
  });

  it('keeps a declared union', () => {
    const s = new Signal<'idle' | 'busy'>('idle');
    expectTypeOf(s.value).toEqualTypeOf<'idle' | 'busy'>();
    // @ts-expect-error not part of the union
    s.value = 'done';
  });

  it('types set() with an updater', () => {
    const count = new Signal(0);
    count.set((prev) => {
      expectTypeOf(prev).toEqualTypeOf<number>();
      return prev + 1;
    });
    // @ts-expect-error wrong return type
    count.set(() => 'x');
  });

  it('passes return types through batch and createRoot', () => {
    expectTypeOf(batch(() => 42)).toEqualTypeOf<number>();
    expectTypeOf(createRoot(() => 'x')).toEqualTypeOf<string>();
    createRoot((dispose) => {
      expectTypeOf(dispose).toEqualTypeOf<() => void>();
    });
  });

  it('types resources', () => {
    const r = new Resource(async () => ({ id: 1 }));
    expectTypeOf(r.value).toEqualTypeOf<{ id: number } | undefined>();
    expectTypeOf(r.loading).toEqualTypeOf<boolean>();
    expectTypeOf(r.error).toEqualTypeOf<Error | undefined>();
    // value keeps the last data during a refetch, so there is no latest
    expectTypeOf(r).not.toHaveProperty('latest');
  });
});

describe('lazy', () => {
  it('takes a component class or a function component', () => {
    class Card extends Component<{ title: string }> {
      protected render(): RenderResult {
        return null;
      }
    }
    const LazyCard = lazy(() => Promise.resolve({ default: Card }));
    expectTypeOf(LazyCard)
      .parameter(0)
      .toEqualTypeOf<{ title: string } | undefined>();
    expectTypeOf(LazyCard({ title: 'x' })).toEqualTypeOf<Node>();

    const LazyFn = lazy(() =>
      Promise.resolve({
        default: (_props?: Record<string, unknown>) =>
          document.createElement('p') as Node,
      })
    );
    expectTypeOf(LazyFn()).toEqualTypeOf<Node>();
  });
});

describe('components', () => {
  it('types props', () => {
    class Greeting extends Component<{ name: string; count?: number }> {
      protected render(): RenderResult {
        expectTypeOf(this.props.name).toEqualTypeOf<string>();
        expectTypeOf(this.props.count).toEqualTypeOf<number | undefined>();
        return null;
      }
    }
    expectTypeOf(Greeting).toBeConstructibleWith({ name: 'a' });
  });

  it('types the props helpers', () => {
    type P = { a: number; b: string; c?: boolean };
    const props: P = { a: 1, b: 'x' };

    expectTypeOf(mergeProps<P>({ a: 1 }, { b: 'y' })).toEqualTypeOf<P>();
    expectTypeOf(withDefaults<P>({ c: true }, props)).toEqualTypeOf<P>();

    const [picked, rest] = splitProps(props, ['a']);
    expectTypeOf(picked).toEqualTypeOf<Pick<P, 'a'>>();
    expectTypeOf(rest).toEqualTypeOf<Omit<P, 'a'>>();
    // @ts-expect-error unknown key
    splitProps(props, ['nope']);
  });

  it('types control flow children', () => {
    Show({
      when: () => ({ name: 'Ada' }) as { name: string } | null,
      children: (user) => {
        expectTypeOf(user).toEqualTypeOf<{ name: string }>();
        return document.createElement('b');
      },
    });
    For({
      each: () => [1, 2, 3],
      children: (item, index) => {
        expectTypeOf(item).toEqualTypeOf<number>();
        expectTypeOf(index).toEqualTypeOf<Accessor<number>>();
        return document.createElement('li');
      },
    });
  });
});

describe('router', () => {
  it('types route config, loaders and guards', () => {
    const loader: RouteLoader<{ name: string }> = ({
      params,
      query,
      signal,
    }) => {
      expectTypeOf(params['id']).toEqualTypeOf<string | undefined>();
      expectTypeOf(query).not.toBeAny();
      expectTypeOf(signal).toEqualTypeOf<AbortSignal>();
      return { name: 'x' };
    };
    const guard: NavigationGuard = ({ to }) => to.path !== '/admin' || '/login';

    const routes: RouteConfig[] = [
      { path: '/users/:id', loader, guards: [guard] },
      { path: '/old', redirect: '/new' },
    ];
    expectTypeOf(routes).toEqualTypeOf<RouteConfig[]>();

    // @ts-expect-error path is required
    const bad: RouteConfig = { component: undefined };
    void bad;
  });
});

describe('typed route params', () => {
  it('reads the params from the path', () => {
    expectTypeOf<PathParams<'/users/:id'>>().toEqualTypeOf<{ id: string }>();
    expectTypeOf<PathParams<'/users/:id/posts/:postId'>>().toEqualTypeOf<{
      id: string;
      postId: string;
    }>();
    expectTypeOf<PathParams<'/users/:id/posts/:postId?'>>().toEqualTypeOf<{
      id: string;
      postId?: string;
    }>();
    expectTypeOf<PathParams<'/files/*'>>().toEqualTypeOf<{ '*'?: string }>();
    expectTypeOf<PathParams<'/files/*rest'>>().toEqualTypeOf<{
      rest?: string;
    }>();
    expectTypeOf<keyof PathParams<'/about'>>().toEqualTypeOf<never>();
  });

  it('gives RouteParams for a path that is not a literal', () => {
    expectTypeOf<PathParams<string>>().toEqualTypeOf<RouteParams>();
  });

  it('types the loader params of defineRoute', () => {
    const route = defineRoute({
      path: '/users/:id',
      loader: ({ params }) => {
        expectTypeOf(params).toEqualTypeOf<{ id: string }>();
        return params.id.length;
      },
    });
    expectTypeOf(route).toEqualTypeOf<RouteConfig>();

    defineRoute({
      path: '/users/:id',
      // @ts-expect-error the path has no name param
      loader: ({ params }) => params.name,
    });
  });

  it('types useParams from the path, and keeps RouteParams without one', () => {
    class Page extends Component {
      protected setup(): void {
        expectTypeOf(useParams<'/users/:id'>(this).value).toEqualTypeOf<{
          id: string;
        }>();
        expectTypeOf(useParams(this).value).toEqualTypeOf<RouteParams>();
      }
    }
    void Page;
  });

  it('checks the params of generatePath against the pattern', () => {
    generatePath('/users/:id', { id: '1' });
    generatePath('/users/:id/posts/:postId?', { id: '1' });
    // @ts-expect-error idd is not a param of the path
    generatePath('/users/:id', { idd: '1' });
    const pattern: string = '/users/:id';
    generatePath(pattern, { anything: 'goes' });
  });
});

describe('reactive collections', () => {
  it('types like Map and Set', () => {
    const map = new ReactiveMap<string, number>([['a', 1]]);
    expectTypeOf(map.get('a')).toEqualTypeOf<number | undefined>();
    expectTypeOf(map.size).toEqualTypeOf<number>();
    expectTypeOf(map).toExtend<Map<string, number>>();
    // @ts-expect-error the value is a number
    map.set('b', 'x');

    const set = new ReactiveSet<number>([1]);
    expectTypeOf(set.has(1)).toEqualTypeOf<boolean>();
    expectTypeOf(set).toExtend<Set<number>>();
    // @ts-expect-error the value is a number
    set.add('x');
  });
});

describe('JSX', () => {
  it('takes href and xlink:href on SVG elements', () => {
    // A literal, so excess properties are errors
    const props: JSX.IntrinsicElements['use'] = {
      href: '#icon',
      'xlink:href': '#icon',
    };
    expectTypeOf(props.href).toEqualTypeOf<string | undefined>();
  });
});
