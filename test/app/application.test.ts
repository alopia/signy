/**
 * Application class tests
 *
 * Tests for the main application class that manages the app lifecycle.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Application, application, AppStatus } from '../../src/app/application';
import { AppConfig } from '../../src/app/app-config';
import { Component } from '../../src/component/component';
import { VERSION } from '../../src/constants';
import type {
  InstallableObject,
  InstallableFunction,
} from '../../src/app/installable-registry';
import { Signal, effect, onCleanup } from '../../src/reactivity';
import type { RenderResult } from '../../src/types';
import { expectLogged } from '../support/console';
import { settle } from '../support/tick';

// Mock Component for testing
class TestComponent extends Component {
  mountCalled = false;
  unmountCalled = false;

  protected render() {
    return document.createElement('div');
  }

  mount(target: Element | string): void {
    this.mountCalled = true;
    super.mount(target);
  }

  unmount(): void {
    this.unmountCalled = true;
    super.unmount();
  }
}

describe('Application', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'app';
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  //=============================================
  // Constructor
  //=============================================

  describe('constructor', () => {
    it('creates app with default options', () => {
      const app = new Application();

      expect(app).toBeInstanceOf(Application);
      expect(app.status).toBe(AppStatus.CREATED);
      expect(app.config).toBeInstanceOf(AppConfig);
    });

    it('creates app with component instance', () => {
      const component = new TestComponent();
      const app = new Application({ rootComponent: component });

      expect(app).toBeInstanceOf(Application);
    });

    it('creates app with component class', () => {
      const app = new Application({ rootComponent: TestComponent });

      expect(app).toBeInstanceOf(Application);
    });

    it('applies initial config options', () => {
      const app = new Application({
        config: {
          theme: 'dark',
        },
      });

      expect(app.config.getValue('theme' as never)).toBe('dark');
    });

    it('uses custom mount point', () => {
      const customContainer = document.createElement('div');
      customContainer.id = 'custom-app';
      document.body.appendChild(customContainer);

      const app = new Application({
        rootComponent: TestComponent,
        mountPoint: '#custom-app',
      });

      app.mount();

      expect(app.status).toBe(AppStatus.MOUNTED);
    });
  });

  //=============================================
  // Getters
  //=============================================

  describe('version', () => {
    it('returns the framework version', () => {
      const app = new Application();
      expect(app.version).toBe(VERSION);
    });
  });

  describe('status', () => {
    it('returns CREATED initially', () => {
      const app = new Application();
      expect(app.status).toBe(AppStatus.CREATED);
    });

    it('returns MOUNTED after mounting', () => {
      const app = new Application();
      app.mount('#app');
      expect(app.status).toBe(AppStatus.MOUNTED);
    });

    it('returns UNMOUNTED after unmounting', () => {
      const app = new Application();
      app.mount('#app');
      app.unmount();
      expect(app.status).toBe(AppStatus.UNMOUNTED);
    });
  });

  //=============================================
  // Mounting
  //=============================================

  describe('mount', () => {
    it('mounts to selector', () => {
      const app = new Application();
      const result = app.mount('#app');

      expect(result).toBe(app);
      expect(app.status).toBe(AppStatus.MOUNTED);
    });

    it('mounts to element', () => {
      const app = new Application();
      const result = app.mount(container);

      expect(result).toBe(app);
      expect(app.status).toBe(AppStatus.MOUNTED);
    });

    it('mounts with root component', () => {
      const component = new TestComponent();
      const app = new Application({ rootComponent: component });

      app.mount('#app');

      expect(component.mountCalled).toBe(true);
    });

    it('uses default mount point from options', () => {
      const app = new Application({ mountPoint: '#app' });

      app.mount();

      expect(app.status).toBe(AppStatus.MOUNTED);
    });

    it('throws when mount target not found', () => {
      const app = new Application();

      expect(() => {
        app.mount('#non-existent');
      }).toThrow();
    });

    it('throws when already mounted', () => {
      const app = new Application();
      app.mount('#app');

      expect(() => {
        app.mount('#app');
      }).toThrow();
    });

    it('throws when trying to remount after unmount', () => {
      const app = new Application();
      app.mount('#app');
      app.unmount();

      expect(() => {
        app.mount('#app');
      }).toThrow();
    });

    it('returns this for chaining', () => {
      const app = new Application();
      const result = app.mount('#app');

      expect(result).toBe(app);
    });

    it('disposes the root and its plugins when the root throws', () => {
      const count = new Signal(0);
      let runs = 0;
      const cleanups: string[] = [];
      class Broken extends Component {
        protected setup(): void {
          effect(() => {
            void count.value;
            runs++;
          });
          onCleanup(() => cleanups.push('component'));
        }
        protected render(): RenderResult {
          throw new Error('broken');
        }
      }
      const app = application(Broken).use(() => () => cleanups.push('plugin'));

      expect(() => app.mount(container)).toThrow('broken');
      expect(app.status).toBe(AppStatus.UNMOUNTED);
      expect(cleanups).toEqual(['component', 'plugin']);
      settle();
      const before = runs;
      count.value = 1;
      settle();
      expect(runs).toBe(before);
    });
  });

  describe('unmount', () => {
    it('unmounts a mounted app', () => {
      const app = new Application();
      app.mount('#app');

      const result = app.unmount();

      expect(result).toBe(app);
      expect(app.status).toBe(AppStatus.UNMOUNTED);
    });

    it('unmounts root component', () => {
      const component = new TestComponent();
      const app = new Application({ rootComponent: component });

      app.mount('#app');
      app.unmount();

      expect(component.unmountCalled).toBe(true);
    });

    it('removes what the root component added and keeps the rest of the container', () => {
      container.innerHTML = '<p id="before">before</p>';
      const app = new Application({ rootComponent: new TestComponent() });
      app.mount('#app');
      const after = document.createElement('p');
      after.id = 'after';
      container.appendChild(after);

      app.unmount();

      expect(container.innerHTML).toBe(
        '<p id="before">before</p><p id="after"></p>'
      );
    });

    it('leaves a container it never filled as it is', () => {
      const app = new Application();
      app.mount('#app');
      container.innerHTML = '<div>content</div>';

      app.unmount();

      expect(container.innerHTML).toBe('<div>content</div>');
    });

    it('returns this when not mounted', () => {
      const app = new Application();
      const result = app.unmount();

      expect(result).toBe(app);
      expectLogged('warn', 'app:not-mounted');
    });

    it('returns this for chaining', () => {
      const app = new Application();
      app.mount('#app');
      const result = app.unmount();

      expect(result).toBe(app);
    });
  });

  //=============================================
  // Component Methods
  //=============================================

  describe('createComponent', () => {
    it('creates a component bound to the app', () => {
      const app = new Application();
      const component = app.createComponent(TestComponent);

      expect(component).toBeInstanceOf(TestComponent);
    });

    it('passes options to component constructor', () => {
      const app = new Application();

      class OptionsComponent extends Component {
        get customOption(): string {
          return (
            (this as unknown as { _customOption?: string })._customOption ??
            'default'
          );
        }

        constructor(options?: { props?: { customOption?: string } }) {
          super(options);
          (this as unknown as { _customOption?: string })._customOption =
            options?.props?.customOption ?? 'default';
        }

        protected render() {
          return document.createElement('div');
        }
      }

      const component = app.createComponent(OptionsComponent, {
        props: { customOption: 'test' },
      });
      expect(component.customOption).toBe('test');
    });
  });

  //=============================================
  // Plugin System
  //=============================================

  describe('use', () => {
    it('installs a function plugin', () => {
      const app = new Application();
      const installFn = vi.fn();
      const plugin: InstallableFunction<Application> = installFn;

      app.use(plugin);

      expect(installFn).toHaveBeenCalledWith(app, undefined);
    });

    it('installs an object plugin', () => {
      const app = new Application();
      const installFn = vi.fn();
      const plugin: InstallableObject<Application> = {
        install: installFn,
      };

      app.use(plugin);

      expect(installFn).toHaveBeenCalledWith(app, undefined);
    });

    it('passes options to plugin', () => {
      const app = new Application();
      const installFn = vi.fn();
      const plugin: InstallableFunction<Application> = installFn;

      app.use(plugin, { options: { debug: true } });

      expect(installFn).toHaveBeenCalledWith(app, { debug: true });
    });

    it('prevents duplicate installations', () => {
      const app = new Application();
      const installFn = vi.fn();
      const plugin: InstallableFunction<Application> = installFn;

      app.use(plugin);
      app.use(plugin);

      expect(installFn).toHaveBeenCalledTimes(1);
      expectLogged('warn', 'installable:already-installed');
    });

    it('allows force reinstallation', () => {
      const app = new Application();
      const installFn = vi.fn();
      const plugin: InstallableFunction<Application> = installFn;

      app.use(plugin);
      app.use(plugin, { force: true });

      expect(installFn).toHaveBeenCalledTimes(2);
    });

    it('returns this for chaining', () => {
      const app = new Application();
      const plugin: InstallableFunction<Application> = () => {};

      const result = app.use(plugin);

      expect(result).toBe(app);
    });

    it('allows chaining multiple plugins', () => {
      const app = new Application();
      const plugin1: InstallableFunction<Application> = vi.fn();
      const plugin2: InstallableFunction<Application> = vi.fn();

      app.use(plugin1).use(plugin2);

      expect(plugin1).toHaveBeenCalled();
      expect(plugin2).toHaveBeenCalled();
    });
  });

  //=============================================
  // Lifecycle Methods
  //=============================================

  describe('isMounted', () => {
    it('returns false initially', () => {
      const app = new Application();
      expect(app.isMounted).toBe(false);
    });

    it('returns true when mounted', () => {
      const app = new Application();
      app.mount('#app');
      expect(app.isMounted).toBe(true);
    });

    it('returns false after unmount', () => {
      const app = new Application();
      app.mount('#app');
      app.unmount();
      expect(app.isMounted).toBe(false);
    });
  });

  //=============================================
  // Dependency Injection
  //=============================================

  describe('provide', () => {
    it('provides a value with string key', () => {
      const app = new Application();
      const value = { data: 'test' };

      app.provide('testKey', value);

      expect(app.get('testKey')).toBe(value);
    });

    it('provides a value with symbol key', () => {
      const app = new Application();
      const key = Symbol('testSymbol');
      const value = { data: 'test' };

      app.provide(key, value);

      expect(app.get(key)).toBe(value);
    });
  });

  describe('get', () => {
    it('returns provided value', () => {
      const app = new Application();
      const value = { count: 42 };

      app.provide('counter', value);

      expect(app.get<{ count: number }>('counter')).toBe(value);
    });

    it('returns undefined for non-existent key', () => {
      const app = new Application();
      expect(app.get('nonExistent')).toBeUndefined();
    });
  });

  describe('has', () => {
    it('returns true for provided key', () => {
      const app = new Application();
      app.provide('existingKey', 'value');

      expect(app.has('existingKey')).toBe(true);
    });

    it('returns false for non-existent key', () => {
      const app = new Application();
      expect(app.has('nonExistent')).toBe(false);
    });
  });
});

//=============================================
// application() Factory Function
//=============================================

describe('application', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'app';
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('creates an Application instance', () => {
    const app = application();
    expect(app).toBeInstanceOf(Application);
  });

  it('creates app with component instance', () => {
    const component = new TestComponent();
    const app = application(component);

    expect(app).toBeInstanceOf(Application);
  });

  it('creates app with component class', () => {
    const app = application(TestComponent);
    expect(app).toBeInstanceOf(Application);
  });

  it('creates app with options object', () => {
    const app = application({
      rootComponent: TestComponent,
      config: { theme: 'dark' },
    });

    expect(app).toBeInstanceOf(Application);
    expect(app.config.getValue('theme' as never)).toBe('dark');
  });

  it('creates app without options', () => {
    const app = application();
    expect(app).toBeInstanceOf(Application);
    expect(app.status).toBe(AppStatus.CREATED);
  });
});

//=============================================
// AppStatus Enum
//=============================================

describe('AppStatus', () => {
  it('has CREATED status', () => {
    expect(AppStatus.CREATED).toBe(0);
  });

  it('has MOUNTED status', () => {
    expect(AppStatus.MOUNTED).toBe(1);
  });

  it('has UNMOUNTED status', () => {
    expect(AppStatus.UNMOUNTED).toBe(2);
  });
});

describe('mountComponent and unmount', () => {
  it('unmounts the components mounted with mountComponent()', () => {
    const unmounted: string[] = [];
    class Widget extends Component {
      protected setup(): void {
        this.onUnmount(() => unmounted.push('widget'));
      }
      protected render() {
        return document.createElement('aside');
      }
    }

    const target = document.createElement('div');
    document.body.appendChild(target);
    const app = new Application();
    const widget = app.mountComponent(Widget, target);

    app.unmount();
    expect(unmounted).toEqual(['widget']);
    expect(widget.isMounted).toBe(false);
  });

  it('drops components unmounted on their own', () => {
    class Widget extends Component {
      protected render() {
        return document.createElement('aside');
      }
    }
    const app = new Application();
    const mounted = (app as unknown as { _mountedComponents: Set<Component> })
      ._mountedComponents;
    const first = app.mountComponent(
      Widget,
      document.body.appendChild(document.createElement('div'))
    );
    first.unmount();
    app.mountComponent(
      Widget,
      document.body.appendChild(document.createElement('div'))
    );
    expect(mounted.has(first)).toBe(false);
    expect(mounted.size).toBe(1);
    app.unmount();
  });

  it('runs plugin cleanups and clears services on unmount', () => {
    class Root extends Component {
      protected render() {
        return document.createElement('div');
      }
    }
    const cleanup = vi.fn();
    const app = new Application(Root);
    app.use((context) => {
      context.provide('service', 1);
      return cleanup;
    });
    app.mount(document.body.appendChild(document.createElement('div')));
    app.unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(app.has('service')).toBe(false);
  });
});
