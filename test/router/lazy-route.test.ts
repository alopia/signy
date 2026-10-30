/**
 * Tests for lazy route loading
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  lazyRoute,
  isLazyRouteComponent,
  preloadRoutes,
  clearPreloadRegistry,
} from '../../src/router/lazy-route';
import { Component } from '../../src/component/component';
import { settleAsync } from '../support/tick';

/** render() is protected, the lazy route tests call it directly */
const renderOf = (component: Component): HTMLElement =>
  (component as unknown as { render(): HTMLElement }).render();

//=============================================
// Test Components
//=============================================

const constructed: TestComponent[] = [];

class TestComponent extends Component {
  props: Record<string, unknown> = {};

  constructor(props: Record<string, unknown> = {}) {
    super();
    this.props = props;
    constructed.push(this);
  }

  protected render(): Element {
    const div = document.createElement('div');
    div.textContent = 'Test Component';
    return div;
  }
}

class LoadingComponent extends Component {
  protected render(): Element {
    const div = document.createElement('div');
    div.textContent = 'Loading...';
    return div;
  }
}

class ErrorComponent extends Component {
  private _error: Error;

  constructor(props: { error: Error }) {
    super();
    this._error = props.error;
  }

  protected render(): Element {
    const div = document.createElement('div');
    div.textContent = `Error: ${this._error.message}`;
    return div;
  }
}

//=============================================
// Tests
//=============================================

describe('lazyRoute', () => {
  beforeEach(() => {
    clearPreloadRegistry();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('creation', () => {
    it('should create a lazy route component', () => {
      const LazyTest = lazyRoute(() =>
        Promise.resolve({ default: TestComponent })
      );

      expect(typeof LazyTest).toBe('function');
      expect(LazyTest.$$lazyRoute).toBe(true);
    });

    it('should have state signals', () => {
      const LazyTest = lazyRoute(() =>
        Promise.resolve({ default: TestComponent })
      );

      expect(typeof LazyTest.state).toBe('object');
      expect(typeof LazyTest.loading).toBe('object');
      expect(typeof LazyTest.error).toBe('object');
      expect(typeof LazyTest.componentClass).toBe('object');
    });

    it('should have preload method', () => {
      const LazyTest = lazyRoute(() =>
        Promise.resolve({ default: TestComponent })
      );

      expect(typeof LazyTest.preload).toBe('function');
    });

    it('should start in idle state', () => {
      const LazyTest = lazyRoute(() =>
        Promise.resolve({ default: TestComponent })
      );

      expect(LazyTest.state.value).toBe('idle');
      expect(LazyTest.loading.value).toBe(false);
      expect(LazyTest.error.value).toBeUndefined();
      expect(LazyTest.componentClass.value).toBeUndefined();
    });
  });

  describe('preload', () => {
    it('should preload the component', async () => {
      const importer = vi.fn().mockResolvedValue({ default: TestComponent });
      const LazyTest = lazyRoute(importer);

      const result = await LazyTest.preload();

      expect(result).toBe(TestComponent);
      expect(importer).toHaveBeenCalledTimes(1);
    });

    it('should update state during preload', async () => {
      let resolveImport: (value: { default: typeof TestComponent }) => void;
      const importPromise = new Promise<{ default: typeof TestComponent }>(
        (resolve) => {
          resolveImport = resolve;
        }
      );

      const LazyTest = lazyRoute(() => importPromise);

      // Start preload
      const preloadPromise = LazyTest.preload();

      expect(LazyTest.state.value).toBe('loading');
      expect(LazyTest.loading.value).toBe(true);

      // Resolve import
      resolveImport!({ default: TestComponent });
      await preloadPromise;

      expect(LazyTest.state.value).toBe('ready');
      expect(LazyTest.loading.value).toBe(false);
      expect(LazyTest.componentClass.value).toBe(TestComponent);
    });

    it('should deduplicate concurrent preloads', async () => {
      const importer = vi.fn().mockResolvedValue({ default: TestComponent });
      const LazyTest = lazyRoute(importer);

      // Start multiple preloads
      const [result1, result2, result3] = await Promise.all([
        LazyTest.preload(),
        LazyTest.preload(),
        LazyTest.preload(),
      ]);

      expect(result1).toBe(TestComponent);
      expect(result2).toBe(TestComponent);
      expect(result3).toBe(TestComponent);
      expect(importer).toHaveBeenCalledTimes(1);
    });

    it('should not reimport if already loaded', async () => {
      const importer = vi.fn().mockResolvedValue({ default: TestComponent });
      const LazyTest = lazyRoute(importer);

      await LazyTest.preload();
      await LazyTest.preload();

      expect(importer).toHaveBeenCalledTimes(1);
    });

    it('should handle preload errors', async () => {
      const error = new Error('Network error');
      const LazyTest = lazyRoute(() => Promise.reject(error));

      await expect(LazyTest.preload()).rejects.toThrow('Network error');

      expect(LazyTest.state.value).toBe('error');
      expect(LazyTest.error.value).toBe(error);
    });

    it('should allow retry after error', async () => {
      const importer = vi
        .fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ default: TestComponent });

      const LazyTest = lazyRoute(importer);

      // First attempt fails
      await expect(LazyTest.preload()).rejects.toThrow();

      // Retry succeeds
      const result = await LazyTest.preload();

      expect(result).toBe(TestComponent);
      expect(LazyTest.state.value).toBe('ready');
    });
  });

  describe('rendering', () => {
    it('should render loading component while loading', async () => {
      let resolveImport: () => void;
      const importPromise = new Promise<{ default: typeof TestComponent }>(
        (resolve) => {
          resolveImport = () => resolve({ default: TestComponent });
        }
      );

      const LazyTest = lazyRoute(() => importPromise, {
        loading: LoadingComponent,
      });

      const instance = new LazyTest();
      const rendered = renderOf(instance);

      // Should show loading
      await settleAsync();
      expect(rendered.textContent).toContain('Loading...');

      // Resolve and wait
      resolveImport!();
      await settleAsync();
    });

    it('should render actual component after loading', async () => {
      const LazyTest = lazyRoute(
        () => Promise.resolve({ default: TestComponent }),
        { loading: LoadingComponent }
      );

      // Preload first
      await LazyTest.preload();

      const instance = new LazyTest();
      const rendered = renderOf(instance);

      // Should render actual component immediately
      await settleAsync();
      expect(rendered.textContent).toContain('Test Component');
    });

    it('should render error component on failure', async () => {
      const LazyTest = lazyRoute(
        () => Promise.reject(new Error('Load failed')),
        { error: ErrorComponent }
      );

      const instance = new LazyTest();
      const rendered = renderOf(instance);

      // Wait for error state
      await settleAsync();

      expect(rendered.textContent).toContain('Error: Load failed');
    });

    it('should render default error display without error component', async () => {
      const LazyTest = lazyRoute(() =>
        Promise.reject(new Error('Something went wrong'))
      );

      const instance = new LazyTest();
      const rendered = renderOf(instance);

      // Wait for error state
      await settleAsync();

      expect(rendered.textContent).toContain('Failed to load');
    });

    it('should pass props to loaded component', async () => {
      const LazyTest = lazyRoute(() =>
        Promise.resolve({ default: TestComponent })
      );

      await LazyTest.preload();

      const props = {
        params: { id: '123' },
        query: {},
        data: { name: 'Test' },
      };
      const instance = new LazyTest(props);
      renderOf(instance);

      await settleAsync();

      expect(constructed.at(-1)?.props).toEqual(props);
    });
  });

  describe('options', () => {
    it('should respect minLoadTime', async () => {
      vi.useFakeTimers();
      const LazyTest = lazyRoute(
        () => Promise.resolve({ default: TestComponent }),
        { minLoadTime: 50 }
      );

      let loaded = false;
      void LazyTest.preload().then(() => {
        loaded = true;
      });
      await vi.advanceTimersByTimeAsync(49);
      expect(loaded).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(loaded).toBe(true);
      vi.useRealTimers();
    });

    it('should use custom name in error messages', async () => {
      const LazyTest = lazyRoute(() => Promise.resolve({} as never), {
        name: 'UserProfile',
      });

      await expect(LazyTest.preload()).rejects.toThrow(
        'Lazy route module UserProfile has no default export'
      );
    });
  });

  describe('cleanup', () => {
    it('should clean up on unmount', async () => {
      const LazyTest = lazyRoute(() =>
        Promise.resolve({ default: TestComponent })
      );

      await LazyTest.preload();

      const instance = new LazyTest();
      const rendered = renderOf(instance);
      document.body.appendChild(rendered);

      await settleAsync();

      // Container should have content before unmount
      expect(rendered.children.length).toBeGreaterThan(0);

      instance.unmount();

      // Container content should be cleared on unmount
      expect(rendered.innerHTML).toBe('');

      // Clean up DOM
      rendered.remove();
    });
  });
});

describe('isLazyRouteComponent', () => {
  it('should return true for lazy route components', () => {
    const LazyTest = lazyRoute(() =>
      Promise.resolve({ default: TestComponent })
    );

    expect(isLazyRouteComponent(LazyTest)).toBe(true);
  });

  it('should return false for regular components', () => {
    expect(isLazyRouteComponent(TestComponent)).toBe(false);
  });

  it('should return false for non-functions', () => {
    expect(isLazyRouteComponent(null)).toBe(false);
    expect(isLazyRouteComponent(undefined)).toBe(false);
    expect(isLazyRouteComponent({})).toBe(false);
    expect(isLazyRouteComponent('string')).toBe(false);
  });

  it('should return false for functions without $$lazyRoute', () => {
    const regularFn = () => {};
    expect(isLazyRouteComponent(regularFn)).toBe(false);
  });
});

describe('preloadRoutes', () => {
  beforeEach(() => {
    clearPreloadRegistry();
  });

  it('should preload multiple components in parallel', async () => {
    const importer1 = vi.fn().mockResolvedValue({ default: TestComponent });
    const importer2 = vi.fn().mockResolvedValue({ default: LoadingComponent });

    const Lazy1 = lazyRoute(importer1);
    const Lazy2 = lazyRoute(importer2);

    await preloadRoutes([Lazy1, Lazy2]);

    expect(Lazy1.state.value).toBe('ready');
    expect(Lazy2.state.value).toBe('ready');
    expect(importer1).toHaveBeenCalledTimes(1);
    expect(importer2).toHaveBeenCalledTimes(1);
  });

  it('should continue if one preload fails', async () => {
    const importer1 = vi.fn().mockResolvedValue({ default: TestComponent });
    const importer2 = vi.fn().mockRejectedValue(new Error('Failed'));

    const Lazy1 = lazyRoute(importer1);
    const Lazy2 = lazyRoute(importer2);

    // Should not throw
    await preloadRoutes([Lazy1, Lazy2]);

    expect(Lazy1.state.value).toBe('ready');
    expect(Lazy2.state.value).toBe('error');
  });

  it('should handle empty array', async () => {
    await preloadRoutes([]);
    // Should not throw
  });
});

describe('integration with outlet detection', () => {
  it('should be detectable by isLazyRouteComponent', () => {
    const LazyDashboard = lazyRoute(() =>
      Promise.resolve({ default: TestComponent })
    );

    // This is what the Outlet uses to detect lazy route components
    expect(LazyDashboard.$$lazyRoute).toBe(true);
    expect(isLazyRouteComponent(LazyDashboard)).toBe(true);
  });

  it('should be instantiable as a Component', () => {
    const LazyDashboard = lazyRoute(() =>
      Promise.resolve({ default: TestComponent })
    );

    const instance = new LazyDashboard({ params: {}, query: {}, data: null });
    expect(instance).toBeInstanceOf(Component);
  });
});

describe('error handling', () => {
  it('should throw error for module without default export', async () => {
    const LazyTest = lazyRoute(() => Promise.resolve({} as never), {
      name: 'MissingDefault',
    });

    await expect(LazyTest.preload()).rejects.toThrow('no default export');
  });

  it('should convert non-Error throws to Error', async () => {
    const LazyTest = lazyRoute(() => Promise.reject('string error'));

    await expect(LazyTest.preload()).rejects.toThrow('string error');
    expect(LazyTest.error.value).toBeInstanceOf(Error);
  });
});

describe('lazyRoute lifecycle', () => {
  beforeEach(() => {
    clearPreloadRegistry();
    constructed.length = 0;
  });

  it('does not mount the component when unmounted while loading', async () => {
    let resolveImport!: () => void;
    const LazyTest = lazyRoute(
      () =>
        new Promise<{ default: typeof TestComponent }>((resolve) => {
          resolveImport = () => resolve({ default: TestComponent });
        })
    );
    const instance = new LazyTest();
    const rendered = renderOf(instance);
    instance.unmount();

    resolveImport();
    await settleAsync();
    expect(constructed).toHaveLength(0);
    expect(rendered.textContent).toBe('');
  });

  it('retries a failed import on the next render', async () => {
    const importer = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValue({ default: TestComponent });
    const LazyTest = lazyRoute(importer);

    renderOf(new LazyTest());
    await settleAsync();
    expect(LazyTest.state.value).toBe('error');

    const rendered = renderOf(new LazyTest());
    await settleAsync();
    expect(rendered.textContent).toContain('Test Component');
  });
});
