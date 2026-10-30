/**
 * Tests for Suspense component
 *
 * @module test/views/suspense.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Suspense } from '../../src/views/suspense';
import { lazy } from '../../src/views/lazy';
import { html } from '../../src/views/html';
import { Show } from '../../src/views/control-flow';
import { Signal } from '../../src/reactivity/signal';
import { resource, type Resource } from '../../src/reactivity';
import { createRoot } from '../../src/reactivity/effect';
import { mount } from '../support/mount';
import { settleAsync } from '../support/tick';

describe('Suspense', () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.removeChild(container);
  });

  //=============================================
  // Basic Rendering
  //=============================================

  describe('basic rendering', () => {
    it('renders children when no async content', () => {
      const child = document.createElement('div');
      child.textContent = 'Hello';

      const fragment = Suspense({
        children: child,
      });

      container.appendChild(fragment);

      expect(container.textContent).toBe('Hello');
    });

    it('renders children from function', () => {
      const fragment = Suspense({
        children: () => {
          const div = document.createElement('div');
          div.textContent = 'From function';
          return div;
        },
      });

      container.appendChild(fragment);

      expect(container.textContent).toBe('From function');
    });

    it('renders children with several root elements', () => {
      const fragment = Suspense({
        children: () =>
          html`<h1>Title</h1>
            <p>Body</p>` as Node[],
      });

      container.appendChild(fragment);

      expect(container.querySelector('h1')?.textContent).toBe('Title');
      expect(container.querySelector('p')?.textContent).toBe('Body');
    });

    it('renders several root children given in a template', () => {
      container.appendChild(
        html`<${Suspense}><h1>Title</h1><p>Body</p></${Suspense}>` as Node
      );

      expect(container.textContent).toBe('TitleBody');
    });

    it('shows a static fallback in each boundary built by one function', () => {
      const pending = () =>
        lazy(() => new Promise<{ default: () => Node }>(() => {}));
      const box = (Pending: ReturnType<typeof pending>) =>
        Suspense({
          fallback: html`<i>wait</i>` as Node,
          children: () => html`<${Pending} />` as Node,
        });

      container.append(box(pending()), box(pending()));

      expect(container.querySelectorAll('i')).toHaveLength(2);
    });

    it('includes start and end markers', () => {
      const fragment = Suspense({
        children: document.createElement('div'),
      });

      container.appendChild(fragment);

      const comments = Array.from(container.childNodes).filter(
        (node) => node.nodeType === Node.COMMENT_NODE
      );

      expect(comments.length).toBe(2);
      expect((comments[0] as Comment).data).toBe('suspense:start');
      expect((comments[1] as Comment).data).toBe('suspense:end');
    });
  });

  //=============================================
  // Fallback Rendering
  //=============================================

  describe('fallback rendering', () => {
    it('shows fallback during loading', async () => {
      let resolveImport: (value: { default: () => Node }) => void;
      const importPromise = new Promise<{ default: () => Node }>((resolve) => {
        resolveImport = resolve;
      });

      const LazyComponent = lazy(() => importPromise);

      const fallbackDiv = document.createElement('div');
      fallbackDiv.textContent = 'Loading...';

      const fragment = Suspense({
        fallback: fallbackDiv,
        children: () => LazyComponent(),
      });

      container.appendChild(fragment);

      // Wait for the effect to run
      await vi.runAllTimersAsync();

      expect(container.textContent).toBe('Loading...');

      // Resolve the import
      resolveImport!({
        default: () => {
          const div = document.createElement('div');
          div.textContent = 'Loaded!';
          return div;
        },
      });

      await vi.runAllTimersAsync();

      expect(container.textContent).toBe('Loaded!');
    });

    it('swaps a fallback with several root elements for the children', async () => {
      let resolveImport: (value: { default: () => Node }) => void;
      const LazyComponent = lazy(
        () =>
          new Promise<{ default: () => Node }>((resolve) => {
            resolveImport = resolve;
          })
      );

      const fragment = Suspense({
        fallback: () => html`<i>Loading</i><b>...</b>` as Node[],
        children: () => [LazyComponent(), html`<p>Footer</p>` as Node],
      });

      container.appendChild(fragment);
      await vi.runAllTimersAsync();

      expect(container.textContent).toBe('Loading...');

      resolveImport!({ default: () => html`<h1>Loaded</h1>` as Node });
      await vi.runAllTimersAsync();

      expect(container.textContent).toBe('LoadedFooter');
      expect(container.querySelector('i, b')).toBeNull();
    });

    it('shows fallback from function', async () => {
      let resolveImport: (value: { default: () => Node }) => void;
      const importPromise = new Promise<{ default: () => Node }>((resolve) => {
        resolveImport = resolve;
      });

      const LazyComponent = lazy(() => importPromise);

      const fragment = Suspense({
        fallback: () => {
          const span = document.createElement('span');
          span.textContent = 'Loading spinner...';
          return span;
        },
        children: () => LazyComponent(),
      });

      container.appendChild(fragment);
      await vi.runAllTimersAsync();

      expect(container.textContent).toBe('Loading spinner...');

      // Cleanup
      resolveImport!({ default: () => document.createElement('div') });
      await vi.runAllTimersAsync();
    });

    it('handles empty fallback gracefully', async () => {
      let resolveImport: (value: { default: () => Node }) => void;
      const importPromise = new Promise<{ default: () => Node }>((resolve) => {
        resolveImport = resolve;
      });

      const LazyComponent = lazy(() => importPromise);

      // No fallback provided
      const fragment = Suspense({
        children: () => LazyComponent(),
      });

      container.appendChild(fragment);
      await vi.runAllTimersAsync();

      // Should only have comment markers
      expect(container.textContent).toBe('');

      // Cleanup
      resolveImport!({ default: () => document.createElement('div') });
      await vi.runAllTimersAsync();
    });
  });

  //=============================================
  // Multiple Lazy Components
  //=============================================

  describe('multiple lazy components', () => {
    it('waits for all lazy components to load', async () => {
      let resolveFirst: (value: { default: () => Node }) => void;
      let resolveSecond: (value: { default: () => Node }) => void;

      const firstPromise = new Promise<{ default: () => Node }>((resolve) => {
        resolveFirst = resolve;
      });
      const secondPromise = new Promise<{ default: () => Node }>((resolve) => {
        resolveSecond = resolve;
      });

      const LazyFirst = lazy(() => firstPromise);
      const LazySecond = lazy(() => secondPromise);

      const fallback = document.createElement('div');
      fallback.textContent = 'Loading all...';

      const fragment = Suspense({
        fallback,
        children: () => {
          const wrapper = document.createElement('div');
          wrapper.appendChild(LazyFirst());
          wrapper.appendChild(LazySecond());
          return wrapper;
        },
      });

      container.appendChild(fragment);
      await vi.runAllTimersAsync();

      expect(container.textContent).toBe('Loading all...');

      // Resolve first component
      resolveFirst!({
        default: () => {
          const span = document.createElement('span');
          span.textContent = 'First';
          return span;
        },
      });
      await vi.runAllTimersAsync();

      // Still loading (waiting for second)
      expect(container.textContent).toBe('Loading all...');

      // Resolve second component
      resolveSecond!({
        default: () => {
          const span = document.createElement('span');
          span.textContent = 'Second';
          return span;
        },
      });
      await vi.runAllTimersAsync();

      // Both loaded
      expect(container.textContent).toBe('FirstSecond');
    });
  });

  //=============================================
  // Nested Suspense
  //=============================================

  describe('nested Suspense', () => {
    it('handles nested Suspense boundaries', async () => {
      let resolveOuter: (value: { default: () => Node }) => void;
      let resolveInner: (value: { default: () => Node }) => void;

      const outerPromise = new Promise<{ default: () => Node }>((resolve) => {
        resolveOuter = resolve;
      });
      const innerPromise = new Promise<{ default: () => Node }>((resolve) => {
        resolveInner = resolve;
      });

      const LazyOuter = lazy(() => outerPromise);
      const LazyInner = lazy(() => innerPromise);

      const outerFallback = document.createElement('div');
      outerFallback.textContent = 'Loading outer...';

      const innerFallback = document.createElement('div');
      innerFallback.textContent = 'Loading inner...';

      const fragment = Suspense({
        fallback: outerFallback,
        children: () => {
          const wrapper = document.createElement('div');
          wrapper.appendChild(LazyOuter());

          const innerSuspense = Suspense({
            fallback: innerFallback,
            children: () => LazyInner(),
          });
          wrapper.appendChild(innerSuspense);

          return wrapper;
        },
      });

      container.appendChild(fragment);
      await vi.runAllTimersAsync();

      // Outer is loading
      expect(container.textContent).toBe('Loading outer...');

      // Resolve outer
      resolveOuter!({
        default: () => {
          const span = document.createElement('span');
          span.textContent = 'Outer';
          return span;
        },
      });
      await vi.runAllTimersAsync();

      // Resolve inner too for cleanup
      resolveInner!({
        default: () => {
          const span = document.createElement('span');
          span.textContent = 'Inner';
          return span;
        },
      });
      await vi.runAllTimersAsync();
    });
  });

  //=============================================
  // Preloaded Components
  //=============================================

  describe('preloaded components', () => {
    it('renders immediately when component is preloaded', async () => {
      const LazyComponent = lazy(() =>
        Promise.resolve({
          default: () => {
            const div = document.createElement('div');
            div.textContent = 'Already loaded';
            return div;
          },
        })
      );

      // Preload before rendering
      await LazyComponent.preload();

      const fallback = document.createElement('div');
      fallback.textContent = 'Should not see this';

      const fragment = Suspense({
        fallback,
        children: () => LazyComponent(),
      });

      container.appendChild(fragment);
      await vi.runAllTimersAsync();

      // Should show loaded content immediately
      expect(container.textContent).toBe('Already loaded');
    });
  });
});

describe('Suspense with resources', () => {
  /** A fetcher that resolves when the test says so */
  function deferredFetcher<T>() {
    const resolvers: Array<(value: T) => void> = [];
    const rejecters: Array<(error: Error) => void> = [];
    const fetcher = vi.fn(
      () =>
        new Promise<T>((resolve, reject) => {
          resolvers.push(resolve);
          rejecters.push(reject);
        })
    );
    return {
      fetcher,
      resolve: (value: T) => resolvers.shift()!(value),
      reject: (error: Error) => rejecters.shift()!(error),
    };
  }

  const text = (value: string) => document.createTextNode(value);

  it('shows the fallback until a resource read inside has its first value', async () => {
    const { fetcher, resolve } = deferredFetcher<string>();
    let user!: Resource<unknown, string>;
    const { root } = mount(() =>
      Suspense({
        fallback: text('loading'),
        children: () => {
          user = resource(fetcher);
          return html`<p>${() => user.value}</p>`;
        },
      })
    );
    expect(root.textContent).toBe('loading');

    resolve('Ada');
    await settleAsync();
    expect(root.textContent).toBe('Ada');
    // Shown again, not rendered again, so it did not fetch again
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('suspends on the first fetch of a resource with a source', async () => {
    const { fetcher, resolve } = deferredFetcher<string>();
    const id = new Signal(1);
    const { root } = mount(() =>
      Suspense({
        fallback: text('loading'),
        children: () => {
          const user = resource(() => id.value, fetcher);
          return html`<p>${() => user.value}</p>`;
        },
      })
    );
    expect(root.textContent).toBe('loading');

    resolve('Ada');
    await settleAsync();
    expect(root.textContent).toBe('Ada');
  });

  it('keeps the children during a refetch', async () => {
    const { fetcher, resolve } = deferredFetcher<string>();
    const id = new Signal(1);
    const { root } = mount(() =>
      Suspense({
        fallback: text('loading'),
        children: () => {
          const user = resource(() => id.value, fetcher);
          return html`<p>
            ${() => user.value}${() => (user.loading ? '...' : '')}
          </p>`;
        },
      })
    );
    resolve('Ada');
    await settleAsync();

    id.value = 2;
    await settleAsync();
    expect(root.textContent).toBe('Ada...');

    resolve('Grace');
    await settleAsync();
    expect(root.textContent).toBe('Grace');
  });

  it('shows the children when the first fetch fails', async () => {
    const { fetcher, reject } = deferredFetcher<string>();
    const { root } = mount(() =>
      Suspense({
        fallback: text('loading'),
        children: () => {
          const user = resource(fetcher);
          return html`<p>${() => user.value ?? user.error?.message}</p>`;
        },
      })
    );
    reject(new Error('offline'));
    await settleAsync();
    expect(root.textContent).toBe('offline');
  });

  it('does not suspend for loading or for reads outside the boundary', async () => {
    const { fetcher, resolve } = deferredFetcher<string>();
    const { user, dispose } = createRoot((dispose) => ({
      user: resource(fetcher),
      dispose,
    }));
    const { root } = mount(() =>
      Suspense({
        fallback: text('loading'),
        children: () => html`<p>${() => (user.loading ? 'busy' : 'done')}</p>`,
      })
    );
    expect(user.value).toBeUndefined();
    expect(root.textContent).toBe('busy');

    resolve('Ada');
    await settleAsync();
    expect(root.textContent).toBe('done');
    dispose();
  });

  it('suspends for a resource read in content rendered after mount', async () => {
    const { fetcher, resolve } = deferredFetcher<string>();
    const open = new Signal(false);
    const { root } = mount(() =>
      Suspense({
        fallback: text('loading'),
        children: () =>
          Show({
            when: () => open.value,
            fallback: text('closed'),
            children: () => {
              const user = resource(fetcher);
              return html`<p>${() => user.value}</p>` as Node;
            },
          }),
      })
    );
    expect(root.textContent).toBe('closed');

    open.value = true;
    await settleAsync();
    expect(root.textContent).toBe('loading');

    resolve('Ada');
    await settleAsync();
    expect(root.textContent).toBe('Ada');
  });

  it('keeps children state while the fallback shows', async () => {
    const { fetcher, resolve } = deferredFetcher<string>();
    const open = new Signal(false);
    let renders = 0;
    const { root } = mount(() =>
      Suspense({
        fallback: text('loading'),
        children: () => {
          renders++;
          const input = document.createElement('input');
          input.value = 'typed';
          return html`<div>
            ${input}${Show({
              when: () => open.value,
              children: () => {
                const user = resource(fetcher);
                return html`<p>${() => user.value}</p>` as Node;
              },
            })}
          </div>`;
        },
      })
    );
    open.value = true;
    await settleAsync();
    expect(root.textContent).toBe('loading');

    resolve('Ada');
    await settleAsync();
    expect(root.querySelector('input')?.value).toBe('typed');
    expect(root.textContent).toBe('Ada');
    expect(renders).toBe(1);
  });

  it('suspends only the nearest boundary', async () => {
    const { fetcher, resolve } = deferredFetcher<string>();
    const { root } = mount(() =>
      Suspense({
        fallback: text('outer loading'),
        children: () =>
          html`<div>
            header
            ${Suspense({
              fallback: text('inner loading'),
              children: () => {
                const user = resource(fetcher);
                return html`<p>${() => user.value}</p>`;
              },
            })}
          </div>`,
      })
    );
    expect(root.textContent).toBe('headerinner loading');

    resolve('Ada');
    await settleAsync();
    expect(root.textContent).toBe('headerAda');
  });

  it('disposes a pending resource with the boundary', () => {
    const { fetcher } = deferredFetcher<string>();
    let user!: Resource<unknown, string>;
    const { unmount } = mount(() =>
      Suspense({
        fallback: text('loading'),
        children: () => {
          user = resource(fetcher);
          return html`<p>${() => user.value}</p>`;
        },
      })
    );
    unmount();
    expect(user.disposed).toBe(true);
  });
});

describe('Suspense with lazy content rendered after mount', () => {
  it('finds the boundary through ownership', async () => {
    let resolve!: (value: { default: () => Node }) => void;
    const LazyPanel = lazy<() => Node>(() => new Promise((r) => (resolve = r)));
    const open = new Signal(false);
    const { root } = mount(() =>
      Suspense({
        fallback: document.createTextNode('loading'),
        children: () =>
          Show({
            when: () => open.value,
            fallback: document.createTextNode('closed'),
            children: () => LazyPanel(),
          }),
      })
    );
    open.value = true;
    await settleAsync();
    expect(root.textContent).toBe('loading');

    resolve({ default: () => document.createTextNode('panel') });
    await settleAsync();
    expect(root.textContent).toBe('panel');
  });
});

describe('Suspense content of several nodes', () => {
  it('renders a value at the top of an html template', () => {
    const label = new Signal('b');
    const { root } = mount(() =>
      Suspense({ children: () => html`<i>a</i>${() => label.value}` as Node })
    );
    expect(root.textContent).toBe('ab');
  });

  it('shows a static fragment fallback every time', async () => {
    const resolvers: Array<(value: { default: () => Node }) => void> = [];
    const loader = () =>
      new Promise<{ default: () => Node }>((r) => resolvers.push(r));
    const First = lazy<() => Node>(loader);
    const Second = lazy<() => Node>(loader);
    const step = new Signal(1);
    const fallback = document.createDocumentFragment();
    fallback.append('wait', document.createElement('hr'));

    const { root } = mount(() =>
      Suspense({
        fallback,
        children: () =>
          Show({
            when: () => step.value,
            children: (n) => (n === 1 ? First() : Second()),
          }),
      })
    );
    await settleAsync();
    expect(root.textContent).toBe('wait');
    resolvers[0]!({ default: () => document.createTextNode('one') });
    await settleAsync();
    expect(root.textContent).toBe('one');

    step.value = 2;
    await settleAsync();
    expect(root.textContent).toBe('wait');
    resolvers[1]!({ default: () => document.createTextNode('two') });
    await settleAsync();
    expect(root.textContent).toBe('two');
  });
});
