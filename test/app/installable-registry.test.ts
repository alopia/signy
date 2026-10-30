/**
 * InstallableRegistry tests
 *
 * Tests for the plugin/extension management system.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  InstallableRegistry,
  type Installable,
  type InstallableFunction,
  type InstallableObject,
} from '../../src/app/installable-registry';
import { expectLogged } from '../support/console';

// Test context type
interface TestContext {
  value: number;
  items: string[];
  data: Map<string, unknown>;
  callback: (() => void) | null;
}

describe('InstallableRegistry', () => {
  let registry: InstallableRegistry<TestContext>;
  let context: TestContext;

  beforeEach(() => {
    registry = new InstallableRegistry<TestContext>();
    context = {
      value: 0,
      items: [],
      data: new Map(),
      callback: null,
    };
  });

  //=============================================
  // Basic Operations
  //=============================================

  describe('constructor', () => {
    it('creates an empty registry', () => {
      expect(registry.size).toBe(0);
    });
  });

  describe('size', () => {
    it('returns 0 for empty registry', () => {
      expect(registry.size).toBe(0);
    });

    it('returns correct count after installations', () => {
      const plugin1: InstallableFunction<TestContext> = () => {};
      const plugin2: InstallableFunction<TestContext> = () => {};

      registry.install(plugin1, context);
      expect(registry.size).toBe(1);

      registry.install(plugin2, context);
      expect(registry.size).toBe(2);
    });
  });

  describe('has', () => {
    it('returns false for non-installed item', () => {
      const plugin: InstallableFunction<TestContext> = () => {};
      expect(registry.has(plugin)).toBe(false);
    });

    it('returns true for installed item', () => {
      const plugin: InstallableFunction<TestContext> = () => {};
      registry.install(plugin, context);
      expect(registry.has(plugin)).toBe(true);
    });
  });

  //=============================================
  // Installation
  //=============================================

  describe('install', () => {
    describe('function plugins', () => {
      it('installs a function plugin', () => {
        const installFn = vi.fn();
        const plugin: InstallableFunction<TestContext> = installFn;

        registry.install(plugin, context);

        expect(installFn).toHaveBeenCalledWith(context, undefined);
        expect(registry.has(plugin)).toBe(true);
      });

      it('passes options to plugin', () => {
        const installFn = vi.fn();
        const plugin: InstallableFunction<TestContext, { debug: boolean }> =
          installFn;

        registry.install(plugin, context, { options: { debug: true } });

        expect(installFn).toHaveBeenCalledWith(context, { debug: true });
      });

      it('modifies context correctly', () => {
        const plugin: InstallableFunction<TestContext> = (ctx) => {
          ctx.value = 42;
          ctx.items.push('modified');
        };

        registry.install(plugin, context);

        expect(context.value).toBe(42);
        expect(context.items).toContain('modified');
      });
    });

    describe('object plugins', () => {
      it('installs an object plugin with install method', () => {
        const installFn = vi.fn();
        const plugin: InstallableObject<TestContext> = {
          install: installFn,
        };

        registry.install(plugin, context);

        expect(installFn).toHaveBeenCalledWith(context, undefined);
        expect(registry.has(plugin)).toBe(true);
      });

      it('passes options to object plugin', () => {
        const installFn = vi.fn();
        const plugin: InstallableObject<TestContext, { key: string }> = {
          install: installFn,
          name: 'TestPlugin',
        };

        registry.install(plugin, context, { options: { key: 'value' } });

        expect(installFn).toHaveBeenCalledWith(context, { key: 'value' });
      });
    });

    describe('duplicate prevention', () => {
      it('prevents duplicate installation by default', () => {
        const installFn = vi.fn();
        const plugin: InstallableFunction<TestContext> = installFn;

        registry.install(plugin, context);
        registry.install(plugin, context);

        expect(installFn).toHaveBeenCalledTimes(1);
        expect(registry.size).toBe(1);
        expectLogged('warn', 'installable:already-installed');
      });

      it('allows reinstallation with force: true', () => {
        const installFn = vi.fn();
        const plugin: InstallableFunction<TestContext> = installFn;

        registry.install(plugin, context);
        registry.install(plugin, context, { force: true });

        expect(installFn).toHaveBeenCalledTimes(2);
      });
    });

    describe('validation', () => {
      it('throws for null plugin', () => {
        expect(() => {
          registry.install(
            null as unknown as Installable<TestContext>,
            context
          );
        }).toThrow();
      });

      it('throws for undefined plugin', () => {
        expect(() => {
          registry.install(
            undefined as unknown as Installable<TestContext>,
            context
          );
        }).toThrow();
      });

      it('throws for invalid plugin type', () => {
        expect(() => {
          registry.install(
            'not a plugin' as unknown as Installable<TestContext>,
            context
          );
        }).toThrow();
      });

      it('throws for object without install method', () => {
        expect(() => {
          registry.install(
            { name: 'bad plugin' } as unknown as Installable<TestContext>,
            context
          );
        }).toThrow();
      });
    });

    describe('rollback on failure', () => {
      it('removes plugin from registry on installation failure', () => {
        const plugin: InstallableFunction<TestContext> = () => {
          throw new Error('Installation failed');
        };

        expect(() => {
          registry.install(plugin, context);
        }).toThrow();

        expect(registry.has(plugin)).toBe(false);
        expect(registry.size).toBe(0);
      });

      it('keeps the plugin error as cause', () => {
        const failure = new Error('Failure');
        const plugin: InstallableFunction<TestContext> = () => {
          throw failure;
        };

        let thrown: unknown;
        try {
          registry.install(plugin, context);
        } catch (error) {
          thrown = error;
        }
        expect((thrown as Error).message).toContain(
          'installable:install-failed'
        );
        expect((thrown as Error).cause).toBe(failure);
      });
    });
  });

  //=============================================
  // Remove and Clear
  //=============================================

  describe('remove', () => {
    it('removes an installed item', () => {
      const plugin: InstallableFunction<TestContext> = () => {};
      registry.install(plugin, context);

      const result = registry.remove(plugin);

      expect(result).toBe(true);
      expect(registry.has(plugin)).toBe(false);
    });

    it('returns false for non-installed item', () => {
      const plugin: InstallableFunction<TestContext> = () => {};
      const result = registry.remove(plugin);

      expect(result).toBe(false);
    });
  });

  describe('getAll', () => {
    it('returns empty set for empty registry', () => {
      const all = registry.getAll();
      expect(all.size).toBe(0);
    });

    it('returns all installed items', () => {
      const plugin1: InstallableFunction<TestContext> = () => {};
      const plugin2: InstallableFunction<TestContext> = () => {};

      registry.install(plugin1, context);
      registry.install(plugin2, context);

      const all = registry.getAll();
      expect(all.size).toBe(2);
      expect(all.has(plugin1)).toBe(true);
      expect(all.has(plugin2)).toBe(true);
    });

    it('returns a copy, not the original set', () => {
      const plugin: InstallableFunction<TestContext> = () => {};
      registry.install(plugin, context);

      const all = registry.getAll();
      all.delete(plugin);

      expect(registry.has(plugin)).toBe(true);
    });
  });

  describe('clear', () => {
    it('removes all installed items', () => {
      const plugin1: InstallableFunction<TestContext> = () => {};
      const plugin2: InstallableFunction<TestContext> = () => {};

      registry.install(plugin1, context);
      registry.install(plugin2, context);
      registry.clear();

      expect(registry.size).toBe(0);
    });
  });

  describe('cleanups', () => {
    it('runs the cleanup an install returned on remove()', () => {
      const cleanup = vi.fn();
      const plugin: InstallableFunction<TestContext> = () => cleanup;
      registry.install(plugin, context);
      expect(cleanup).not.toHaveBeenCalled();

      registry.remove(plugin);
      expect(cleanup).toHaveBeenCalledTimes(1);
      registry.remove(plugin);
      expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it('runs every cleanup on clear(), the last installed first', () => {
      const order: string[] = [];
      const first: InstallableObject<TestContext> = {
        install: () => () => order.push('first'),
      };
      const second: InstallableFunction<TestContext> = () => () =>
        order.push('second');
      registry.install(first, context);
      registry.install(second, context);

      registry.clear();
      expect(order).toEqual(['second', 'first']);
    });

    it('runs the previous cleanup before a forced reinstall', () => {
      const cleanup = vi.fn();
      const plugin: InstallableFunction<TestContext> = () => cleanup;
      registry.install(plugin, context);
      registry.install(plugin, context, { force: true });
      expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it('logs a throwing cleanup and still runs the others', () => {
      const other = vi.fn();
      registry.install(() => other, context);
      registry.install(
        () => () => {
          throw new Error('boom');
        },
        context
      );

      registry.clear();
      expectLogged('error', 'installable:uninstall-failed');
      expect(other).toHaveBeenCalledTimes(1);
    });
  });

  //=============================================
  // Named Plugins
  //=============================================

  describe('plugin naming', () => {
    it('uses function name for named functions', () => {
      function myNamedPlugin(_ctx: TestContext) {}

      // The name is used internally for warnings, install should work
      registry.install(myNamedPlugin, context);
      expect(registry.has(myNamedPlugin)).toBe(true);
    });

    it('uses object name property when available', () => {
      const namedPlugin: InstallableObject<TestContext> = {
        name: 'CustomPluginName',
        install: () => {},
      };

      registry.install(namedPlugin, context);
      expect(registry.has(namedPlugin)).toBe(true);
    });
  });
});
