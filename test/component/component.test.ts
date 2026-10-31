/**
 * Component class tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Component } from '../../src/component/component';
import { html } from '../../src/views/html';
import { Application, application } from '../../src/app/application';
import { Signal, onMount, onCleanup, flushAll } from '../../src/reactivity';
import type { InjectionKey, RenderResult } from '../../src/types';
import { expectLogged } from '../support/console';

//=============================================
// Test Components
//=============================================

class SimpleComponent extends Component {
  renderCalled = 0;

  protected render(): RenderResult {
    this.renderCalled++;
    const div = document.createElement('div');
    div.className = 'simple';
    div.textContent = 'Hello';
    return div;
  }
}

class PropsComponent extends Component<{ title: string; count?: number }> {
  protected render(): RenderResult {
    const div = document.createElement('div');
    div.className = 'props-component';
    div.textContent = `${this.props.title} - ${this.props.count ?? 0}`;
    return div;
  }
}

class SetupComponent extends Component {
  setupCalled = false;
  setupValue = '';

  protected setup(): void {
    this.setupCalled = true;
    this.setupValue = 'initialized';
  }

  protected render(): RenderResult {
    const div = document.createElement('div');
    div.textContent = this.setupValue;
    return div;
  }
}

class LifecycleComponent extends Component {
  events: string[] = [];
  cleanupCalled = false;

  protected setup(): void {
    this.events.push('setup');

    this.onMount(() => {
      this.events.push('mount');
      return () => {
        this.events.push('mount-cleanup');
        this.cleanupCalled = true;
      };
    });

    this.onUnmount(() => {
      this.events.push('unmount');
    });
  }

  protected render(): RenderResult {
    this.events.push('render');
    return document.createElement('div');
  }
}

class ReactiveComponent extends Component {
  count = new Signal(0);
  renderCount = 0;

  protected render(): RenderResult {
    this.renderCount++;
    const div = document.createElement('div');
    div.className = 'reactive';
    div.textContent = `Count: ${this.count.value}`;
    return div;
  }
}

//=============================================
// Test Helpers
//=============================================
// Tests
//=============================================

describe('Component', () => {
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
    it('creates component with default props', () => {
      const component = new SimpleComponent();
      expect(component).toBeInstanceOf(Component);
    });

    it('creates component with props', () => {
      const component = new PropsComponent({ title: 'Test', count: 5 });
      expect(component).toBeInstanceOf(Component);
    });

    it('creates component with options', () => {
      const app = new Application();
      const component = new SimpleComponent({}, { app });
      expect(component).toBeInstanceOf(Component);
    });

    it('assigns unique id to each component', () => {
      const comp1 = new SimpleComponent();
      const comp2 = new SimpleComponent();
      expect(comp1.id).toEqual(expect.any(String));
      expect(comp1.id).not.toBe(comp2.id);
    });

    it('id contains component class name', () => {
      const component = new SimpleComponent();
      expect(component.id).toContain('SimpleComponent');
    });

    it('name returns constructor name', () => {
      const component = new SimpleComponent();
      expect(component.name).toBe('SimpleComponent');
    });
  });

  //=============================================
  // Lifecycle Status
  //=============================================

  describe('isMounted', () => {
    it('returns false before mounting', () => {
      const app = application(SimpleComponent);
      // Root component is created but not mounted
      expect(app.status).toBe(0); // CREATED
    });

    it('returns true after mounting', () => {
      const app = application(SimpleComponent);
      app.mount('#app');
      expect(app.status).toBe(1); // MOUNTED
    });

    it('returns false after unmounting', () => {
      const app = application(SimpleComponent);
      app.mount('#app');
      app.unmount();
      expect(app.status).toBe(2); // UNMOUNTED
    });
  });

  //=============================================
  // Mount
  //=============================================

  describe('mount', () => {
    it('mounts component via application', () => {
      const app = application(SimpleComponent);
      app.mount('#app');

      expect(container.querySelector('.simple')).not.toBeNull();
    });

    it('calls render during mount', () => {
      const component = new SimpleComponent();
      const app = application(component);
      app.mount('#app');

      expect(component.renderCalled).toBeGreaterThan(0);
    });

    it('renders component content to container', () => {
      const app = application(SimpleComponent);
      app.mount('#app');

      expect(container.textContent).toContain('Hello');
    });

    it('mounts component with props', () => {
      const component = new PropsComponent({ title: 'My Title', count: 42 });
      const app = application(component);
      app.mount('#app');

      expect(container.textContent).toContain('My Title');
      expect(container.textContent).toContain('42');
    });

    it('throws when mounting component without app', () => {
      const component = new SimpleComponent();
      expect(() => {
        component.mount(container);
      }).toThrow();
    });
  });

  //=============================================
  // Unmount
  //=============================================

  describe('unmount', () => {
    it('clears container content', () => {
      const app = application(SimpleComponent);
      app.mount('#app');
      app.unmount();

      expect(container.innerHTML).toBe('');
    });

    it('double unmount is no-op', () => {
      const app = application(SimpleComponent);
      app.mount('#app');
      app.unmount();

      // Should not throw
      expect(() => app.unmount()).not.toThrow();
      expectLogged('warn', 'app:not-mounted');
    });
  });

  //=============================================
  // Setup
  //=============================================

  describe('setup', () => {
    it('calls setup before render', () => {
      const component = new SetupComponent();
      const app = application(component);
      app.mount('#app');

      expect(component.setupCalled).toBe(true);
    });

    it('setup values are available in render', () => {
      const component = new SetupComponent();
      const app = application(component);
      app.mount('#app');

      expect(container.textContent).toContain('initialized');
    });

    it('options.setup is called during mount', () => {
      const setupSpy = vi.fn();

      class CustomComponent extends Component {
        protected render(): RenderResult {
          return document.createElement('div');
        }
      }

      const component = new CustomComponent({}, { setup: setupSpy });
      const app = application(component);
      app.mount('#app');

      expect(setupSpy).toHaveBeenCalled();
    });
  });

  //=============================================
  // Lifecycle Hooks
  //=============================================

  describe('lifecycle hooks', () => {
    it('calls onMount after component is mounted', () => {
      const component = new LifecycleComponent();
      const app = application(component);
      app.mount('#app');

      expect(component.events).toContain('mount');
    });

    it('lifecycle order is setup -> render -> mount', () => {
      const component = new LifecycleComponent();
      const app = application(component);
      app.mount('#app');

      const setupIndex = component.events.indexOf('setup');
      const renderIndex = component.events.indexOf('render');
      const mountIndex = component.events.indexOf('mount');

      expect(setupIndex).toBeLessThan(renderIndex);
      expect(renderIndex).toBeLessThan(mountIndex);
    });

    it('calls onUnmount before component is unmounted', () => {
      const component = new LifecycleComponent();
      const app = application(component);
      app.mount('#app');
      app.unmount();

      expect(component.events).toContain('unmount');
    });

    it('calls mount cleanup during unmount', () => {
      const component = new LifecycleComponent();
      const app = application(component);
      app.mount('#app');
      app.unmount();

      expect(component.cleanupCalled).toBe(true);
      expect(component.events).toContain('mount-cleanup');
    });

    it('multiple onMount callbacks are supported', () => {
      const callbacks: number[] = [];

      class MultiMountComponent extends Component {
        protected setup(): void {
          this.onMount(() => {
            callbacks.push(1);
          });
          this.onMount(() => {
            callbacks.push(2);
          });
          this.onMount(() => {
            callbacks.push(3);
          });
        }

        protected render(): RenderResult {
          return document.createElement('div');
        }
      }

      const app = application(MultiMountComponent);
      app.mount('#app');

      expect(callbacks).toEqual([1, 2, 3]);
    });

    it('multiple onUnmount callbacks are supported', () => {
      const callbacks: number[] = [];

      class MultiUnmountComponent extends Component {
        protected setup(): void {
          this.onUnmount(() => callbacks.push(1));
          this.onUnmount(() => callbacks.push(2));
          this.onUnmount(() => callbacks.push(3));
        }

        protected render(): RenderResult {
          return document.createElement('div');
        }
      }

      const app = application(MultiUnmountComponent);
      app.mount('#app');
      app.unmount();

      expect(callbacks).toEqual([1, 2, 3]);
    });

    it('onMount cleanup is called even if callback throws', () => {
      let cleanupCalled = false;

      class ThrowingMountComponent extends Component {
        protected setup(): void {
          this.onMount(() => {
            return () => {
              cleanupCalled = true;
            };
          });
          this.onMount(() => {
            throw new Error('Mount error');
          });
        }

        protected render(): RenderResult {
          return document.createElement('div');
        }
      }

      const app = application(ThrowingMountComponent);

      // Mount may throw due to the callback error
      try {
        app.mount('#app');
      } catch {
        // Expected
      }

      app.unmount();
      expect(cleanupCalled).toBe(true);
      expectLogged('error', 'reactivity:cleanup-error');
    });

    it('global onCleanup inside global onMount registers on component', async () => {
      const cleanup = vi.fn();
      const mountFn = vi.fn();

      class GlobalHooksComponent extends Component {
        protected setup(): void {
          // Use global onMount from reactivity module
          onMount(() => {
            mountFn();
            // Use global onCleanup - should register on component
            onCleanup(cleanup);
          });
        }

        protected render(): RenderResult {
          return document.createElement('div');
        }
      }

      const app = application(GlobalHooksComponent);
      app.mount('#app');

      // Wait for onMount effect to run (it's scheduled as microtask)
      flushAll();

      expect(mountFn).toHaveBeenCalledTimes(1);
      expect(cleanup).not.toHaveBeenCalled();

      // Unmount should trigger cleanup
      app.unmount();

      expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it('child component cleanup is called when parent is unmounted', async () => {
      const cleanup = vi.fn();
      const mountFn = vi.fn();

      class ChildComponent extends Component {
        protected setup(): void {
          onMount(() => {
            mountFn();
            onCleanup(cleanup);
          });
        }

        protected render(): RenderResult {
          return document.createElement('div');
        }
      }

      class ParentComponent extends Component {
        protected render(): RenderResult {
          return html`<div><${ChildComponent} /></div>`;
        }
      }

      const app = application(ParentComponent);
      app.mount('#app');

      // Wait for mount effect
      flushAll();

      expect(mountFn).toHaveBeenCalledTimes(1);
      expect(cleanup).not.toHaveBeenCalled();

      // Unmount parent - should trigger child cleanup
      app.unmount();

      expect(cleanup).toHaveBeenCalledTimes(1);
    });
  });

  //=============================================
  // Dependency Injection
  //=============================================

  describe('provide/inject', () => {
    it('provides values to self', () => {
      class SelfInjectComponent extends Component {
        injectedValue?: string;

        protected setup(): void {
          this.provide('testKey', 'testValue');
          this.injectedValue = this.inject('testKey') as string;
        }

        protected render(): RenderResult {
          return document.createElement('div');
        }
      }

      const component = new SelfInjectComponent();
      const app = application(component);
      app.mount('#app');

      expect(component.injectedValue).toBe('testValue');
    });

    it('inject returns default value when key not found', () => {
      class DefaultValueComponent extends Component {
        value?: string;

        protected setup(): void {
          this.value = this.inject('missing', 'default') as string;
        }

        protected render(): RenderResult {
          return document.createElement('div');
        }
      }

      const component = new DefaultValueComponent();
      const app = application(component);
      app.mount('#app');

      expect(component.value).toBe('default');
    });

    it('inject returns undefined when key not found and no default', () => {
      class NoDefaultComponent extends Component {
        value?: string;

        protected setup(): void {
          this.value = this.inject('missing') as string | undefined;
        }

        protected render(): RenderResult {
          return document.createElement('div');
        }
      }

      const component = new NoDefaultComponent();
      const app = application(component);
      app.mount('#app');

      expect(component.value).toBeUndefined();
    });

    it('provides typed values with InjectionKey', () => {
      const NumberKey = Symbol('number') as InjectionKey<number>;

      class TypedProviderComponent extends Component {
        injectedValue?: number;

        protected setup(): void {
          this.provide(NumberKey, 42);
          this.injectedValue = this.inject(NumberKey);
        }

        protected render(): RenderResult {
          return document.createElement('div');
        }
      }

      const component = new TypedProviderComponent();
      const app = application(component);
      app.mount('#app');

      expect(component.injectedValue).toBe(42);
    });
  });

  //=============================================
  // Child Components
  //=============================================

  describe('child components', () => {
    it('renderChild creates and tracks child component', () => {
      let childRendered = false;

      class ChildComponent extends Component {
        protected render(): RenderResult {
          childRendered = true;
          const span = document.createElement('span');
          span.className = 'child';
          span.textContent = 'Child';
          return span;
        }
      }

      class ParentComponent extends Component {
        protected render(): RenderResult {
          const div = document.createElement('div');
          div.className = 'parent';
          const childContent = this.renderChild(ChildComponent);
          if (childContent instanceof Node) {
            div.appendChild(childContent);
          }
          return div;
        }
      }

      const app = application(ParentComponent);
      app.mount('#app');

      expect(childRendered).toBe(true);
      expect(container.querySelector('.parent')).not.toBeNull();
      expect(container.querySelector('.child')).not.toBeNull();
    });

    it('child components are unmounted when parent unmounts', () => {
      let childUnmounted = false;

      class ChildComponent extends Component {
        protected setup(): void {
          this.onUnmount(() => {
            childUnmounted = true;
          });
        }

        protected render(): RenderResult {
          return document.createElement('span');
        }
      }

      class ParentComponent extends Component {
        protected render(): RenderResult {
          const div = document.createElement('div');
          const childContent = this.renderChild(ChildComponent);
          if (childContent instanceof Node) {
            div.appendChild(childContent);
          }
          return div;
        }
      }

      const app = application(ParentComponent);
      app.mount('#app');
      app.unmount();

      expect(childUnmounted).toBe(true);
    });

    it('renderChild passes props to child', () => {
      let receivedProps: { message: string } | null = null;

      class ChildComponent extends Component<{ message: string }> {
        protected setup(): void {
          receivedProps = this.props;
        }

        protected render(): RenderResult {
          return document.createElement('span');
        }
      }

      class ParentComponent extends Component {
        protected render(): RenderResult {
          const div = document.createElement('div');
          const childContent = this.renderChild(ChildComponent, {
            message: 'Hello from parent',
          });
          if (childContent instanceof Node) {
            div.appendChild(childContent);
          }
          return div;
        }
      }

      const app = application(ParentComponent);
      app.mount('#app');

      expect(receivedProps).toEqual({ message: 'Hello from parent' });
    });
  });

  //=============================================
  // Reactive Rendering
  //=============================================

  describe('reactive rendering', () => {
    it('initial render displays signal value', () => {
      const component = new ReactiveComponent();
      const app = application(component);
      app.mount('#app');

      expect(container.textContent).toContain('Count: 0');
    });

    // Note: Testing reactive re-rendering requires async microtask handling
    // These tests verify the basic structure; full reactive tests are in reactivity module
  });

  //=============================================
  // Update
  //=============================================

  describe('update', () => {
    it('update re-renders component', () => {
      class UpdatableComponent extends Component {
        value = 'initial';
        renderCount = 0;

        protected render(): RenderResult {
          this.renderCount++;
          const div = document.createElement('div');
          div.textContent = this.value;
          return div;
        }
      }

      const component = new UpdatableComponent();
      const app = application(component);
      app.mount('#app');

      const initialRenderCount = component.renderCount;
      component.value = 'updated';
      component.update();

      expect(component.renderCount).toBeGreaterThan(initialRenderCount);
      expect(container.textContent).toContain('updated');
    });

    it('update is no-op when not mounted', () => {
      class UpdatableComponent extends Component {
        renderCount = 0;

        protected render(): RenderResult {
          this.renderCount++;
          return document.createElement('div');
        }

        // Expose update for testing
        doUpdate(): void {
          this.update();
        }
      }

      const component = new UpdatableComponent();
      // Not mounted, so update should do nothing
      component.doUpdate();

      expect(component.renderCount).toBe(0);
    });
  });

  //=============================================
  // Emit
  //=============================================

  describe('emit', () => {
    it('emits custom events from component', () => {
      const eventHandler = vi.fn();

      class EmittingComponent extends Component {
        protected setup(): void {
          this.onMount(() => {
            this.emit('custom-event', { value: 42 });
          });
        }

        protected render(): RenderResult {
          return document.createElement('div');
        }
      }

      const component = new EmittingComponent();
      const app = application(component);

      container.addEventListener('custom-event', eventHandler);
      app.mount('#app');

      expect(eventHandler).toHaveBeenCalled();
      expect(eventHandler.mock.calls[0]![0].detail).toEqual({ value: 42 });
    });

    it('emitted events are composed (cross shadow boundary)', () => {
      let eventComposed = false;

      class EmittingComponent extends Component {
        protected setup(): void {
          this.onMount(() => {
            this.emit('test-event');
          });
        }

        protected render(): RenderResult {
          return document.createElement('div');
        }
      }

      container.addEventListener('test-event', (e) => {
        eventComposed = (e as CustomEvent).composed;
      });

      const app = application(EmittingComponent);
      app.mount('#app');

      expect(eventComposed).toBe(true);
    });
  });

  //=============================================
  // Render Result Types
  //=============================================

  describe('render result types', () => {
    it('handles null render result', () => {
      class NullRenderComponent extends Component {
        protected render(): RenderResult {
          return null;
        }
      }

      const app = application(NullRenderComponent);
      // Should not throw
      expect(() => app.mount('#app')).not.toThrow();
    });

    it('handles DocumentFragment render result', () => {
      class FragmentRenderComponent extends Component {
        protected render(): RenderResult {
          const fragment = document.createDocumentFragment();
          const div1 = document.createElement('div');
          div1.className = 'frag-1';
          const div2 = document.createElement('div');
          div2.className = 'frag-2';
          fragment.appendChild(div1);
          fragment.appendChild(div2);
          return fragment;
        }
      }

      const app = application(FragmentRenderComponent);
      app.mount('#app');

      expect(container.querySelector('.frag-1')).not.toBeNull();
      expect(container.querySelector('.frag-2')).not.toBeNull();
    });

    it('handles array render result', () => {
      class ArrayRenderComponent extends Component {
        protected render(): RenderResult {
          const div1 = document.createElement('div');
          div1.className = 'arr-1';
          const div2 = document.createElement('div');
          div2.className = 'arr-2';
          return [div1, div2];
        }
      }

      const app = application(ArrayRenderComponent);
      app.mount('#app');

      expect(container.querySelector('.arr-1')).not.toBeNull();
      expect(container.querySelector('.arr-2')).not.toBeNull();
    });
  });

  //=============================================
  // Error Handling
  //=============================================

  describe('error handling', () => {
    it('cleanup errors do not prevent other cleanups', () => {
      const cleanups: number[] = [];

      class MultiCleanupComponent extends Component {
        protected setup(): void {
          this.onMount(() => {
            return () => cleanups.push(1);
          });
          this.onMount(() => {
            return () => {
              throw new Error('Cleanup error');
            };
          });
          this.onMount(() => {
            return () => cleanups.push(3);
          });
        }

        protected render(): RenderResult {
          return document.createElement('div');
        }
      }

      const app = application(MultiCleanupComponent);
      app.mount('#app');

      // Unmount should not throw despite cleanup error
      expect(() => app.unmount()).not.toThrow();

      // Other cleanups should still run
      expect(cleanups).toContain(1);
      expect(cleanups).toContain(3);
      expectLogged('error', 'reactivity:cleanup-error');
    });

    it('unmount callback errors do not prevent cleanup', () => {
      let cleanupCalled = false;

      class ErrorUnmountComponent extends Component {
        protected setup(): void {
          this.onUnmount(() => {
            throw new Error('Unmount error');
          });
          this.onMount(() => {
            return () => {
              cleanupCalled = true;
            };
          });
        }

        protected render(): RenderResult {
          return document.createElement('div');
        }
      }

      const app = application(ErrorUnmountComponent);
      app.mount('#app');

      // Should not throw
      expect(() => app.unmount()).not.toThrow();
      expect(cleanupCalled).toBe(true);
      expectLogged('error', 'reactivity:cleanup-error');
    });
  });

  //=============================================
  // Internal API
  //=============================================

  describe('child registration', () => {
    it('unmounts every child rendered in a template with the parent', () => {
      const unmounted: string[] = [];

      class Child extends Component<{ name: string }> {
        protected setup(): void {
          onCleanup(() => unmounted.push(this.props.name));
        }

        protected render(): RenderResult {
          return document.createElement('span');
        }
      }

      class Parent extends Component {
        protected render(): RenderResult {
          return html`<div>
            <${Child} name="a" />
            <${Child} name="b" />
          </div>`;
        }
      }

      const app = application(Parent);
      app.mount('#app');
      expect(document.querySelectorAll('#app span')).toHaveLength(2);

      app.unmount();
      expect(unmounted.sort()).toEqual(['a', 'b']);
    });
  });

  //=============================================
  // _renderAsChild
  //=============================================

  describe('_renderAsChild', () => {
    it('renders component as child and sets mounted status', () => {
      class ChildAsChild extends Component {
        protected render(): RenderResult {
          const div = document.createElement('div');
          div.className = 'child-as-child';
          return div;
        }
      }

      class ParentForAsChild extends Component {
        protected render(): RenderResult {
          const child = new ChildAsChild();
          const content = child._renderAsChild();
          const wrapper = document.createElement('div');
          if (content) {
            wrapper.appendChild(content);
          }
          return wrapper;
        }
      }

      const app = application(ParentForAsChild);
      app.mount('#app');

      expect(container.querySelector('.child-as-child')).not.toBeNull();
    });

    it('_renderAsChild calls onMount callbacks', () => {
      let mountCalled = false;

      class ChildWithMount extends Component {
        protected setup(): void {
          this.onMount(() => {
            mountCalled = true;
          });
        }

        protected render(): RenderResult {
          return document.createElement('div');
        }
      }

      class ParentForMountTest extends Component {
        protected render(): RenderResult {
          const child = new ChildWithMount();
          const content = child._renderAsChild();
          const wrapper = document.createElement('div');
          if (content) {
            wrapper.appendChild(content);
          }
          return wrapper;
        }
      }

      const app = application(ParentForMountTest);
      app.mount('#app');

      expect(mountCalled).toBe(true);
    });
  });
});

//=============================================
// Edge Cases
//=============================================

describe('render results with several roots', () => {
  const items = ['a', 'b'];

  class Mixed extends Component {
    protected render(): RenderResult {
      return html`<p>start</p>
        ${items.map((item) => html`<i>${item}</i>`)} ${null} ${'end'}` as RenderResult;
    }
  }

  class ShadowMixed extends Mixed {
    protected shadow = true;
  }

  class Parent extends Component {
    protected render(): RenderResult {
      return html`<section><${Mixed} /></section>` as RenderResult;
    }
  }

  it('flattens a nested list among the roots of a root component', () => {
    const host = document.createElement('div');
    const app = application(Mixed).mount(host);
    expect(host.querySelectorAll('i')).toHaveLength(2);
    expect(host.textContent).toContain('end');
    app.unmount();
  });

  it('flattens it in a shadow root', () => {
    const host = document.createElement('div');
    const app = application(ShadowMixed).mount(host);
    expect(host.shadowRoot!.querySelectorAll('i')).toHaveLength(2);
    app.unmount();
  });

  it('flattens it in a child component', () => {
    const host = document.createElement('div');
    const app = application(Parent).mount(host);
    expect(host.querySelectorAll('section i')).toHaveLength(2);
    expect(host.querySelector('section')!.textContent).toContain('end');
    app.unmount();
  });
});

describe('a binding among the roots of a template', () => {
  function counter(shadow: boolean) {
    const n = new Signal(1);
    let reads = 0;
    let component!: Component;
    class Roots extends Component {
      protected shadow = shadow;
      protected setup(): void {
        component = this;
      }
      protected render(): RenderResult {
        return html`<h1>a</h1>
          ${() => {
            reads++;
            return n.value;
          }}
          <p>c</p>` as RenderResult;
      }
    }
    return { n, Roots, reads: () => reads, component: () => component };
  }

  it.each([
    ['light DOM', false],
    ['a shadow root', true],
  ])('stops with the root component in %s', (_name, shadow) => {
    const { n, Roots, reads } = counter(shadow);
    const host = document.createElement('div');
    const app = application(Roots).mount(host);
    app.unmount();
    const before = reads();
    n.value = 2;
    flushAll();
    expect(reads()).toBe(before);
  });

  it('stops the old one on update()', () => {
    const { n, Roots, reads, component } = counter(false);
    const host = document.createElement('div');
    const app = application(Roots).mount(host);
    component().update();
    component().update();
    const before = reads();
    n.value = 2;
    flushAll();
    // Only the binding of the last render reads it
    expect(reads()).toBe(before + 1);
    expect(host.textContent).toBe('a2c');
    app.unmount();
  });
});

describe('Component Edge Cases', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'app';
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('handles deeply nested child components', () => {
    const mountOrder: string[] = [];

    class Level3 extends Component {
      protected setup(): void {
        this.onMount(() => {
          mountOrder.push('level3');
        });
      }

      protected render(): RenderResult {
        const span = document.createElement('span');
        span.className = 'level-3';
        return span;
      }
    }

    class Level2 extends Component {
      protected setup(): void {
        this.onMount(() => {
          mountOrder.push('level2');
        });
      }

      protected render(): RenderResult {
        const div = document.createElement('div');
        div.className = 'level-2';
        const childContent = this.renderChild(Level3);
        if (childContent instanceof Node) {
          div.appendChild(childContent);
        }
        return div;
      }
    }

    class Level1 extends Component {
      protected setup(): void {
        this.onMount(() => {
          mountOrder.push('level1');
        });
      }

      protected render(): RenderResult {
        const div = document.createElement('div');
        div.className = 'level-1';
        const childContent = this.renderChild(Level2);
        if (childContent instanceof Node) {
          div.appendChild(childContent);
        }
        return div;
      }
    }

    const app = application(Level1);
    app.mount('#app');

    expect(container.querySelector('.level-1')).not.toBeNull();
    expect(container.querySelector('.level-2')).not.toBeNull();
    expect(container.querySelector('.level-3')).not.toBeNull();

    // All should be mounted
    expect(mountOrder).toContain('level1');
    expect(mountOrder).toContain('level2');
    expect(mountOrder).toContain('level3');
  });

  it('handles component with no render content', () => {
    class EmptyComponent extends Component {
      protected render(): RenderResult {
        return undefined;
      }
    }

    const app = application(EmptyComponent);

    // Should not throw
    expect(() => app.mount('#app')).not.toThrow();
  });

  it('handles rapid mount/unmount cycles', () => {
    class RapidComponent extends Component {
      protected render(): RenderResult {
        return document.createElement('div');
      }
    }

    // Multiple mount/unmount cycles should not cause issues
    for (let i = 0; i < 5; i++) {
      const app = application(RapidComponent);
      app.mount('#app');
      app.unmount();
    }

    expect(container.innerHTML).toBe('');
  });
});

describe('child mount timing', () => {
  it('runs child onMount once its node is in the document, before the parent', () => {
    const log: string[] = [];

    class Child extends Component {
      private el!: HTMLElement;
      protected setup(): void {
        this.onMount(() => {
          log.push(`child:${this.el.isConnected}`);
        });
      }
      protected render(): RenderResult {
        this.el = document.createElement('span');
        return this.el;
      }
    }

    class Parent extends Component {
      protected setup(): void {
        this.onMount(() => {
          log.push('parent');
        });
      }
      protected render(): RenderResult {
        return html`<div><${Child} /></div>` as RenderResult;
      }
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = application(Parent);
    app.mount(container);

    expect(log).toEqual(['child:true', 'parent']);
    app.unmount();
  });

  it('runs onMount of a child rendered later after it is inserted', () => {
    const show = new Signal(false);
    const log: boolean[] = [];

    class Child extends Component {
      private el!: HTMLElement;
      protected setup(): void {
        this.onMount(() => {
          log.push(this.el.isConnected);
        });
      }
      protected render(): RenderResult {
        this.el = document.createElement('span');
        return this.el;
      }
    }

    class Parent extends Component {
      protected render(): RenderResult {
        return html`<div>
          ${() => (show.value ? html`<${Child} />` : null)}
        </div>` as RenderResult;
      }
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = application(Parent);
    app.mount(container);

    show.value = true;
    flushAll();
    expect(log).toEqual([true]);
    app.unmount();
  });
});

describe('displayName', () => {
  it('names the component, its id and shadow host after displayName', () => {
    class T extends Component {
      static displayName = 'TodoList';
      protected render(): RenderResult {
        return null;
      }
    }
    const instance = new T();
    expect(instance.name).toBe('TodoList');
    expect(instance.id).toMatch(/^TodoList-\d+$/);
  });
});

describe('inject without an app', () => {
  it('returns the default value', () => {
    class Lonely extends Component {
      read(): string | undefined {
        return this.inject('missing', 'fallback');
      }
      protected render(): RenderResult {
        return null;
      }
    }
    expect(new Lonely().read()).toBe('fallback');
  });
});
