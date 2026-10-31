/**
 * Tests for lazy loading functionality
 *
 * @module test/views/lazy.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  lazy,
  isLazyComponent,
  preloadAll,
  pushSuspenseBoundary,
  popSuspenseBoundary,
} from '../../src/views/lazy';
import { logger } from '../../src/log';
import { Component } from '../../src/component/component';
import { html } from '../../src/views/html';
import type { RenderResult } from '../../src/types';
import { ErrorBoundary } from '../../src/views/control-flow';
import { Suspense } from '../../src/views/suspense';
import { catchError, createRoot } from '../../src/reactivity/effect';
import { flushAll } from '../../src/reactivity';
import { mount } from '../support/mount';
import { settleAsync } from '../support/tick';

describe('lazy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  //=============================================
  // Basic Loading
  //=============================================

  describe('component classes', () => {
    class Greeting extends Component<{ name: string }> {
      protected render(): RenderResult {
        return html`<p>Hello ${this.props.name}</p>` as RenderResult;
      }
    }

    it('passes children to a class default export', async () => {
      class Card extends Component<{ children?: unknown }> {
        protected render(): RenderResult {
          return html`<section>
            ${this.props.children}
          </section>` as RenderResult;
        }
      }
      const LazyCard = lazy(() => Promise.resolve({ default: Card }));
      await LazyCard.preload();

      const { root } = mount(() =>
        Suspense({ children: () => LazyCard({ children: 'body' }) })
      );
      expect(root.querySelector('section')!.textContent).toBe('body');
    });

    it('renders a class default export with its props', async () => {
      const LazyGreeting = lazy(() => Promise.resolve({ default: Greeting }));
      await LazyGreeting.preload();

      const host = document.createElement('div');
      host.append(LazyGreeting({ name: 'Ada' }));
      expect(host.textContent).toBe('Hello Ada');
    });

    it('renders a class default export as a tag in a template', async () => {
      const LazyGreeting = lazy(() => Promise.resolve({ default: Greeting }));
      await LazyGreeting.preload();

      const host = document.createElement('div');
      host.append(html`<${LazyGreeting} name="Grace" />` as Node);
      expect(host.textContent).toBe('Hello Grace');
    });
  });

  describe('basic loading', () => {
    it('starts in idle state', () => {
      const LazyComponent = lazy(() =>
        Promise.resolve({ default: () => document.createElement('div') })
      );

      expect(LazyComponent.state.value).toBe('idle');
      expect(LazyComponent.loading()).toBe(false);
      expect(LazyComponent.error.value).toBeUndefined();
      expect(LazyComponent.component.value).toBeUndefined();
    });

    it('transitions to loading state when called', async () => {
      let resolveImport: (value: { default: () => Node }) => void;
      const importPromise = new Promise<{ default: () => Node }>((resolve) => {
        resolveImport = resolve;
      });

      const LazyComponent = lazy(() => importPromise);

      // Register a mock Suspense boundary to avoid warning
      const boundary = {
        register: vi.fn(),
        unregister: vi.fn(),
      };
      pushSuspenseBoundary(boundary);

      try {
        LazyComponent();
        expect(LazyComponent.state.value).toBe('loading');
        expect(LazyComponent.loading()).toBe(true);
      } finally {
        popSuspenseBoundary();
      }

      // Resolve the import
      resolveImport!({ default: () => document.createElement('div') });
      await vi.runAllTimersAsync();

      expect(LazyComponent.state.value).toBe('ready');
      expect(LazyComponent.loading()).toBe(false);
    });

    it('transitions to ready state after loading', async () => {
      const mockComponent = () => document.createElement('span');
      const LazyComponent = lazy(() =>
        Promise.resolve({ default: mockComponent })
      );

      await LazyComponent.preload();

      expect(LazyComponent.state.value).toBe('ready');
      expect(LazyComponent.loading()).toBe(false);
      expect(LazyComponent.component.value).toBe(mockComponent);
    });

    it('transitions to error state on failure', async () => {
      const error = new Error('Import failed');
      const LazyComponent = lazy(() => Promise.reject(error));

      await expect(LazyComponent.preload()).rejects.toThrow('Import failed');

      expect(LazyComponent.state.value).toBe('error');
      expect(LazyComponent.error.value).toBe(error);
      expect(LazyComponent.component.value).toBeUndefined();
    });

    it('renders component when ready', async () => {
      const mockComponent = () => {
        const div = document.createElement('div');
        div.textContent = 'Loaded!';
        return div;
      };
      const LazyComponent = lazy(() =>
        Promise.resolve({ default: mockComponent })
      );

      await LazyComponent.preload();
      const node = LazyComponent();

      expect(node).toBeInstanceOf(HTMLDivElement);
      expect((node as HTMLElement).textContent).toBe('Loaded!');
    });
  });

  //=============================================
  // Preload
  //=============================================

  describe('preload', () => {
    it('loads component without rendering', async () => {
      const mockComponent = () => document.createElement('div');
      const LazyComponent = lazy(() =>
        Promise.resolve({ default: mockComponent })
      );

      expect(LazyComponent.state.value).toBe('idle');

      await LazyComponent.preload();

      expect(LazyComponent.state.value).toBe('ready');
      expect(LazyComponent.component.value).toBe(mockComponent);
    });

    it('deduplicates concurrent preload calls', async () => {
      let importCount = 0;
      const mockComponent = () => document.createElement('div');
      const LazyComponent = lazy(() => {
        importCount++;
        return Promise.resolve({ default: mockComponent });
      });

      // Call preload multiple times concurrently
      const [result1, result2, result3] = await Promise.all([
        LazyComponent.preload(),
        LazyComponent.preload(),
        LazyComponent.preload(),
      ]);

      expect(importCount).toBe(1);
      expect(result1).toBe(mockComponent);
      expect(result2).toBe(mockComponent);
      expect(result3).toBe(mockComponent);
    });

    it('returns cached component on subsequent preloads', async () => {
      let importCount = 0;
      const mockComponent = () => document.createElement('div');
      const LazyComponent = lazy(() => {
        importCount++;
        return Promise.resolve({ default: mockComponent });
      });

      await LazyComponent.preload();
      await LazyComponent.preload();
      await LazyComponent.preload();

      expect(importCount).toBe(1);
    });

    it('allows retry after error', async () => {
      let shouldFail = true;
      const mockComponent = () => document.createElement('div');
      const LazyComponent = lazy(() => {
        if (shouldFail) {
          return Promise.reject(new Error('Failed'));
        }
        return Promise.resolve({ default: mockComponent });
      });

      // First attempt fails
      await expect(LazyComponent.preload()).rejects.toThrow('Failed');
      expect(LazyComponent.state.value).toBe('error');

      // Retry succeeds
      shouldFail = false;
      await LazyComponent.preload();
      expect(LazyComponent.state.value).toBe('ready');
    });
  });

  //=============================================
  // Options
  //=============================================

  describe('options', () => {
    it('respects minLoadTime option', async () => {
      const mockComponent = () => document.createElement('div');
      const LazyComponent = lazy(
        () => Promise.resolve({ default: mockComponent }),
        { minLoadTime: 500 }
      );

      const preloadPromise = LazyComponent.preload();

      // Fast-forward 200ms - should still be loading
      await vi.advanceTimersByTimeAsync(200);
      expect(LazyComponent.state.value).toBe('loading');

      // Fast-forward remaining time
      await vi.advanceTimersByTimeAsync(300);
      await preloadPromise;

      expect(LazyComponent.state.value).toBe('ready');
    });

    it('uses name option in error messages', async () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      const LazyComponent = lazy(
        () => Promise.resolve({ default: () => document.createElement('div') }),
        { name: 'MyComponent' }
      );

      // Call without Suspense boundary to trigger warning
      LazyComponent();

      await vi.runAllTimersAsync();

      // Warning should be called with component name in context object
      expect(warnSpy).toHaveBeenCalled();
      const warnCall = warnSpy.mock.calls[0];
      expect(
        warnCall!.some(
          (arg: unknown) =>
            typeof arg === 'object' &&
            arg !== null &&
            (arg as Record<string, unknown>)['name'] === 'MyComponent'
        )
      ).toBe(true);

      warnSpy.mockRestore();
    });
  });

  //=============================================
  // Suspense Boundary Integration
  //=============================================

  describe('Suspense boundary integration', () => {
    it('registers with Suspense boundary when loading', async () => {
      const boundary = {
        register: vi.fn(),
        unregister: vi.fn(),
      };

      let resolveImport: (value: { default: () => Node }) => void;
      const importPromise = new Promise<{ default: () => Node }>((resolve) => {
        resolveImport = resolve;
      });

      const LazyComponent = lazy(() => importPromise);

      pushSuspenseBoundary(boundary);
      try {
        LazyComponent();
      } finally {
        popSuspenseBoundary();
      }

      expect(boundary.register).toHaveBeenCalledTimes(1);
      expect(boundary.register).toHaveBeenCalledWith(expect.any(Promise));

      // Resolve and check unregister
      resolveImport!({ default: () => document.createElement('div') });
      await vi.runAllTimersAsync();

      expect(boundary.unregister).toHaveBeenCalledTimes(1);
    });

    it('does not register when already loaded', async () => {
      const boundary = {
        register: vi.fn(),
        unregister: vi.fn(),
      };

      const LazyComponent = lazy(() =>
        Promise.resolve({ default: () => document.createElement('div') })
      );

      // Preload first
      await LazyComponent.preload();

      // Now render with boundary
      pushSuspenseBoundary(boundary);
      try {
        LazyComponent();
      } finally {
        popSuspenseBoundary();
      }

      expect(boundary.register).not.toHaveBeenCalled();
    });

    it('warns when rendered without Suspense boundary', async () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      const LazyComponent = lazy(() =>
        Promise.resolve({ default: () => document.createElement('div') })
      );

      // Render without Suspense boundary
      LazyComponent();

      await vi.runAllTimersAsync();

      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  //=============================================
  // Props Passing
  //=============================================

  describe('props passing', () => {
    it('passes props to loaded component', async () => {
      const mockComponent = vi.fn((props?: { name: string }) => {
        const div = document.createElement('div');
        div.textContent = props?.name ?? 'default';
        return div;
      });

      const LazyComponent = lazy(
        () =>
          Promise.resolve({ default: mockComponent }) as Promise<{
            default: (props?: Record<string, unknown>) => Node;
          }>
      );

      await LazyComponent.preload();
      const node = LazyComponent({ name: 'Test' });

      expect(mockComponent).toHaveBeenCalledWith({ name: 'Test' });
      expect((node as HTMLElement).textContent).toBe('Test');
    });
  });

  //=============================================
  // isLazyComponent
  //=============================================

  describe('isLazyComponent', () => {
    it('returns true for lazy components', () => {
      const LazyComponent = lazy(() =>
        Promise.resolve({ default: () => document.createElement('div') })
      );

      expect(isLazyComponent(LazyComponent)).toBe(true);
    });

    it('returns false for regular functions', () => {
      const regularFunction = () => document.createElement('div');

      expect(isLazyComponent(regularFunction)).toBe(false);
    });

    it('returns false for non-functions', () => {
      expect(isLazyComponent(null)).toBe(false);
      expect(isLazyComponent(undefined)).toBe(false);
      expect(isLazyComponent(42)).toBe(false);
      expect(isLazyComponent('string')).toBe(false);
      expect(isLazyComponent({})).toBe(false);
    });
  });

  //=============================================
  // preloadAll
  //=============================================

  describe('preloadAll', () => {
    it('preloads multiple components in parallel', async () => {
      const component1 = () => document.createElement('div');
      const component2 = () => document.createElement('span');

      const Lazy1 = lazy(() => Promise.resolve({ default: component1 }));
      const Lazy2 = lazy(() => Promise.resolve({ default: component2 }));

      await preloadAll([Lazy1, Lazy2] as never);

      expect(Lazy1.state.value).toBe('ready');
      expect(Lazy2.state.value).toBe('ready');
    });

    it('continues loading even if some fail', async () => {
      const component1 = () => document.createElement('div');

      const Lazy1 = lazy(() => Promise.resolve({ default: component1 }));
      const Lazy2 = lazy(() => Promise.reject(new Error('Failed')));

      // Should not throw

      await preloadAll([Lazy1, Lazy2] as never);

      expect(Lazy1.state.value).toBe('ready');
      expect(Lazy2.state.value).toBe('error');
    });
  });

  //=============================================
  // $$lazy Symbol
  //=============================================

  describe('$$lazy marker', () => {
    it('has $$lazy property set to true', () => {
      const LazyComponent = lazy(() =>
        Promise.resolve({ default: () => document.createElement('div') })
      );

      expect(LazyComponent.$$lazy).toBe(true);
    });
  });
});

describe('lazy loading failures and shared loads', () => {
  it('hands a failed import to the nearest error handler, without an unhandled rejection', async () => {
    const LazyComponent = lazy<() => Node>(() =>
      Promise.reject(new Error('offline'))
    );
    const boundary = { register: vi.fn(), unregister: vi.fn() };
    const caught: unknown[] = [];

    const dispose = createRoot((dispose) => {
      catchError(
        () => {
          pushSuspenseBoundary(boundary);
          try {
            LazyComponent();
          } finally {
            popSuspenseBoundary();
          }
        },
        (error) => caught.push(error)
      );
      return dispose;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushAll();

    expect(LazyComponent.error.value?.message).toBe('offline');
    expect(boundary.unregister).toHaveBeenCalledTimes(1);
    expect(caught).toEqual([LazyComponent.error.value]);
    dispose();
  });

  it('registers every caller during a load with its boundary', async () => {
    let resolve!: (value: { default: () => Node }) => void;
    const LazyComponent = lazy<() => Node>(
      () => new Promise((r) => (resolve = r))
    );
    const first = { register: vi.fn(), unregister: vi.fn() };
    const second = { register: vi.fn(), unregister: vi.fn() };

    for (const boundary of [first, second]) {
      pushSuspenseBoundary(boundary);
      try {
        LazyComponent();
      } finally {
        popSuspenseBoundary();
      }
    }
    expect(first.register).toHaveBeenCalledTimes(1);
    expect(second.register).toHaveBeenCalledTimes(1);

    resolve({ default: () => document.createElement('div') });
    await new Promise((r) => setTimeout(r, 0));
    expect(second.unregister).toHaveBeenCalledTimes(1);
  });
});

describe('lazy errors in an ErrorBoundary', () => {
  it('shows the error, then retries the import on reset', async () => {
    const loaded = () => {
      const p = document.createElement('p');
      p.textContent = 'loaded';
      return p;
    };
    const importer = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ default: loaded });
    const LazyComponent = lazy<() => Node>(importer);
    let reset!: () => void;

    const { root } = mount(() =>
      ErrorBoundary({
        fallback: (error, retry) => {
          reset = retry;
          return document.createTextNode(`failed: ${error.message}`);
        },
        children: () =>
          Suspense({
            fallback: document.createTextNode('loading'),
            children: () => LazyComponent(),
          }),
      })
    );
    await settleAsync();
    expect(root.textContent).toBe('failed: offline');

    reset();
    await settleAsync();
    expect(root.textContent).toBe('loaded');
    expect(importer).toHaveBeenCalledTimes(2);
  });
});
