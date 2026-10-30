/**
 * Feature Registry Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { expectLogged } from '../support/console';
import { features, isFeaturesActive } from '../../src/core/features';
import { Signal } from '../../src/reactivity';
import type { DevFeature, FeatureContext } from '../../src/core/features';

describe('FeatureRegistry', () => {
  beforeEach(() => {
    // Ensure clean state
    features.uninstallAll();
  });

  afterEach(() => {
    features.uninstallAll();
  });

  describe('install/uninstall', () => {
    it('should install a feature', () => {
      const feature: DevFeature = {
        id: 'test:feature',
        name: 'Test Feature',
        install: vi.fn(),
      };

      features.install(feature);

      expect(features.isInstalled('test:feature')).toBe(true);
      expect(features.count).toBe(1);
      expect(feature.install).toHaveBeenCalled();
    });

    it('should throw when installing duplicate feature', () => {
      const feature: DevFeature = {
        id: 'test:feature',
        name: 'Test Feature',
        install: () => {},
      };

      features.install(feature);
      expect(() => features.install(feature)).toThrow(
        'Feature "test:feature" is already installed'
      );
      expectLogged('error', 'feature:already-installed');
    });

    it('should uninstall a feature by id', () => {
      const uninstall = vi.fn();
      const feature: DevFeature = {
        id: 'test:feature',
        name: 'Test Feature',
        install: () => {},
        uninstall,
      };

      const cleanup = features.install(feature);
      expect(features.isInstalled('test:feature')).toBe(true);

      cleanup();
      expect(features.isInstalled('test:feature')).toBe(false);
      expect(uninstall).toHaveBeenCalled();
    });

    it('should uninstall all features', () => {
      features.install({
        id: 'test:one',
        name: 'One',
        install: () => {},
      });
      features.install({
        id: 'test:two',
        name: 'Two',
        install: () => {},
      });

      expect(features.count).toBe(2);

      features.uninstallAll();

      expect(features.count).toBe(0);
      expect(features.installed).toEqual([]);
    });
  });

  describe('handler registration', () => {
    it('should register fine-grained handlers', () => {
      const handler = vi.fn();

      features.install({
        id: 'test:handlers',
        name: 'Handler Test',
        install(ctx: FeatureContext) {
          ctx.onComponentCreate(handler);
        },
      });

      // Emit should call the handler
      features.emit.componentCreate({
        id: 'test-1',
        name: 'TestComponent',
        isMounted: false,
      });

      expect(handler).toHaveBeenCalledWith({
        id: 'test-1',
        name: 'TestComponent',
        isMounted: false,
      });
    });

    it('should register grouped lifecycle handlers', () => {
      const onCreate = vi.fn();
      const onMount = vi.fn();

      features.install({
        id: 'test:grouped',
        name: 'Grouped Test',
        install(ctx: FeatureContext) {
          ctx.onLifecycle({
            onCreate,
            onMount,
          });
        },
      });

      const component = {
        id: 'test-1',
        name: 'TestComponent',
        isMounted: false,
      };
      const element = document.createElement('div');

      features.emit.componentCreate(component);
      features.emit.componentMount(component, element);

      expect(onCreate).toHaveBeenCalledWith(component);
      expect(onMount).toHaveBeenCalledWith(component, element);
    });

    it('should cleanup handlers when feature is uninstalled', () => {
      const handler = vi.fn();

      const cleanup = features.install({
        id: 'test:cleanup',
        name: 'Cleanup Test',
        install(ctx: FeatureContext) {
          ctx.onComponentCreate(handler);
        },
      });

      // Handler should be called
      features.emit.componentCreate({
        id: 'test-1',
        name: 'Test',
        isMounted: false,
      });
      expect(handler).toHaveBeenCalledTimes(1);

      // Uninstall
      cleanup();

      // Handler should not be called
      features.emit.componentCreate({
        id: 'test-2',
        name: 'Test2',
        isMounted: false,
      });
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('lazy emit', () => {
    it('should be noop when no features installed', () => {
      // This should not throw even though no features are installed
      features.emit.componentCreate({
        id: 'test',
        name: 'Test',
        isMounted: false,
      });
      features.emit.signalWrite({ value: 'new' }, 'old', 'new');
    });

    it('should activate emit when feature is installed', () => {
      const handler = vi.fn();

      features.install({
        id: 'test:emit',
        name: 'Emit Test',
        install(ctx) {
          ctx.onSignalWrite(handler);
        },
      });

      const signal = { value: 'new' };
      features.emit.signalWrite(signal, 'old', 'new');

      expect(handler).toHaveBeenCalledWith(signal, 'old', 'new');
    });

    it('should deactivate emit when all features uninstalled', () => {
      const handler = vi.fn();

      const cleanup = features.install({
        id: 'test:deactivate',
        name: 'Deactivate Test',
        install(ctx) {
          ctx.onSignalWrite(handler);
        },
      });

      cleanup();

      // This should be a noop now
      features.emit.signalWrite({ value: 'new' }, 'old', 'new');
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('multiple features', () => {
    it('should call handlers from all features', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      features.install({
        id: 'test:one',
        name: 'One',
        install(ctx) {
          ctx.onComponentCreate(handler1);
        },
      });

      features.install({
        id: 'test:two',
        name: 'Two',
        install(ctx) {
          ctx.onComponentCreate(handler2);
        },
      });

      const component = {
        id: 'test',
        name: 'Test',
        isMounted: false,
      };
      features.emit.componentCreate(component);

      expect(handler1).toHaveBeenCalledWith(component);
      expect(handler2).toHaveBeenCalledWith(component);
    });

    it('should maintain insertion order', () => {
      const order: string[] = [];

      features.install({
        id: 'test:first',
        name: 'First',
        install(ctx) {
          ctx.onComponentCreate(() => order.push('first'));
        },
      });

      features.install({
        id: 'test:second',
        name: 'Second',
        install(ctx) {
          ctx.onComponentCreate(() => order.push('second'));
        },
      });

      features.emit.componentCreate({
        id: 'test',
        name: 'Test',
        isMounted: false,
      });

      expect(order).toEqual(['first', 'second']);
    });
  });

  describe('properties', () => {
    it('should report hasFeatures correctly', () => {
      expect(features.hasFeatures).toBe(false);

      const cleanup = features.install({
        id: 'test:has',
        name: 'Has Test',
        install: () => {},
      });

      expect(features.hasFeatures).toBe(true);

      cleanup();

      expect(features.hasFeatures).toBe(false);
    });

    it('should return installed feature ids', () => {
      features.install({
        id: 'test:a',
        name: 'A',
        install: () => {},
      });
      features.install({
        id: 'test:b',
        name: 'B',
        install: () => {},
      });

      expect(features.installed).toEqual(['test:a', 'test:b']);
    });
  });
});

describe('framework events reach features', () => {
  afterEach(() => {
    features.uninstallAll();
  });

  it('reports component, app, signal and effect lifecycle', async () => {
    const { Component } = await import('../../src/component/component');
    const { Signal, effect, createRoot } = await import('../../src/reactivity');
    const { mount } = await import('../support/mount');
    const { settle } = await import('../support/tick');

    const events: string[] = [];
    features.install({
      id: 'test:recorder',
      name: 'Recorder',
      install: (ctx) => {
        ctx.onApp({
          onMount: () => events.push('app:mount'),
          onUnmount: () => events.push('app:unmount'),
        });
        ctx.onLifecycle({
          onCreate: () => events.push('component:create'),
          onMount: () => events.push('component:mount'),
          onUnmount: () => events.push('component:unmount'),
        });
        ctx.onReactivity({
          onSignalWrite: (_s, prev, next) =>
            events.push(`signal:write ${String(prev)}->${String(next)}`),
          onEffectCreate: () => events.push('effect:create'),
          onEffectRun: () => events.push('effect:run'),
          onEffectDispose: () => events.push('effect:dispose'),
        });
      },
    });

    class Root extends Component {
      protected render() {
        return document.createElement('div');
      }
    }
    const { unmount } = mount(Root);

    const count = new Signal(0);
    createRoot((dispose) => {
      effect(() => void count.value);
      settle();
      count.value = 1;
      settle();
      dispose();
    });
    unmount();

    expect(events).toEqual(
      expect.arrayContaining([
        'app:mount',
        'app:unmount',
        'component:create',
        'component:mount',
        'component:unmount',
        'signal:write 0->1',
        'effect:create',
        'effect:run',
        'effect:dispose',
      ])
    );
  });

  it('reports the mount of a child component with where it went', async () => {
    const { Component } = await import('../../src/component/component');
    const { html } = await import('../../src/views/html');
    const { mount } = await import('../support/mount');

    const mounts: [string, string][] = [];
    features.install({
      id: 'test:child-mount',
      name: 'Child mount',
      install: (ctx) => {
        ctx.onLifecycle({
          onMount: (component, target) =>
            mounts.push([component.name, (target as Element).localName]),
        });
      },
    });

    class Leaf extends Component {
      protected render() {
        return html`<p>leaf</p>`;
      }
    }
    class Empty extends Component {
      protected render() {
        return null;
      }
    }
    class Tree extends Component {
      protected render() {
        return html`<section><${Leaf} /><${Empty} /></section>`;
      }
    }
    const { unmount } = mount(Tree);
    unmount();

    expect(mounts).toEqual(
      expect.arrayContaining([
        ['Tree', 'div'],
        ['Leaf', 'section'],
        ['Empty', 'div'],
      ])
    );
  });

  it('logs and continues when uninstall hooks or cleanups throw', () => {
    features.install({
      id: 'test:broken',
      name: 'Broken',
      install: (ctx) => {
        ctx.onSignalWrite(() => {});
      },
      uninstall: () => {
        throw new Error('uninstall failed');
      },
    });

    features.uninstall('test:broken');
    expectLogged('error', 'feature:uninstall-error');
    expect(features.isInstalled('test:broken')).toBe(false);
  });

  it('devEmit forwards to installed features', async () => {
    const { devEmit } = await import('../../src/core/features');
    const onAppMount = vi.fn();
    features.install({
      id: 'test:emit',
      name: 'Emit',
      install: (ctx) => {
        ctx.onAppMount(onAppMount);
      },
    });

    const app = { id: 'x' } as never;
    devEmit.appMount(app);
    expect(onAppMount).toHaveBeenCalledWith(app);
  });
});

describe('feature failures', () => {
  afterEach(() => {
    features.uninstallAll();
  });

  it('rolls back a feature whose install throws', () => {
    const handler = vi.fn();
    const broken: DevFeature = {
      id: 'test:broken',
      name: 'Broken',
      install(ctx) {
        ctx.onSignalCreate(handler);
        throw new Error('boom');
      },
    };
    expect(() => features.install(broken)).toThrow('boom');
    expect(features.isInstalled('test:broken')).toBe(false);
    expect(isFeaturesActive()).toBe(false);

    features.install({ ...broken, install: () => {} });
    expect(features.isInstalled('test:broken')).toBe(true);
  });

  it('logs a throwing handler and keeps the write', () => {
    features.install({
      id: 'test:throws',
      name: 'Throws',
      install(ctx) {
        ctx.onSignalWrite(() => {
          throw new Error('boom');
        });
      },
    });
    const count = new Signal(0);
    count.value = 1;
    expectLogged('error', 'feature:handler-error');
    expect(count.peek()).toBe(1);
  });
});
