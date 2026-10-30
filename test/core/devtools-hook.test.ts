/**
 * Contract for the global dev tools hook. signy-dev and browser extensions
 * depend on this shape. signy-dev tests its own use of it in alopia/signy-dev.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getDevToolsHook,
  initDevToolsHook,
  destroyDevToolsHook,
} from '../../src/core/devtools-hook';
import { features } from '../../src/core/features';
import { VERSION } from '../../src/constants';
import { Component } from '../../src/component/component';
import { mount } from '../support/mount';

const KEY = '__SIGNY_DEVTOOLS_HOOK__';
const globals = globalThis as Record<string, unknown>;

afterEach(() => {
  destroyDevToolsHook();
  features.uninstallAll();
});

describe('dev tools hook', () => {
  it('is absent until initialized', () => {
    expect(getDevToolsHook()).toBeNull();
    expect(globals[KEY]).toBeUndefined();
  });

  it('ignores a global under its name that is not a hook', () => {
    const clobber = document.createElement('div');
    globals[KEY] = clobber;
    expect(getDevToolsHook()).toBeNull();
    const hook = initDevToolsHook();
    expect(hook).not.toBe(clobber);
    expect(typeof hook.on).toBe('function');
  });

  it('is published on globalThis under a fixed key', () => {
    const hook = initDevToolsHook();
    expect(globals[KEY]).toBe(hook);
    expect(getDevToolsHook()).toBe(hook);
  });

  it('has the documented shape', () => {
    const hook = initDevToolsHook();
    expect(hook.version).toBe(VERSION);
    expect(hook.apps).toEqual([]);
    expect(hook.installedFeatures).toEqual([]);
    expect(hook.isConnected).toBe(false);
    expect(hook.on).toBeTypeOf('function');
    expect(hook.emit).toBeTypeOf('function');
  });

  it('reuses a hook another bundle already created', () => {
    const first = initDevToolsHook();
    // Simulate a second copy of Signy that has no cached instance yet
    destroyDevToolsHook();
    globals[KEY] = first;
    expect(initDevToolsHook()).toBe(first);
    expect(getDevToolsHook()).toBe(first);
  });

  it('removes itself on destroy', () => {
    initDevToolsHook();
    destroyDevToolsHook();
    expect(globals[KEY]).toBeUndefined();
    expect(getDevToolsHook()).toBeNull();
  });

  it('delivers events to listeners until they unsubscribe', () => {
    const hook = initDevToolsHook();
    const handler = vi.fn();
    const off = hook.on('feature:install', handler);

    hook.emit('feature:install', 'id', 'Name');
    off();
    hook.emit('feature:install', 'id2', 'Name2');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('id', 'Name');
  });

  it('keeps going when a listener throws', () => {
    const hook = initDevToolsHook();
    const good = vi.fn();
    hook.on('feature:uninstall', () => {
      throw new Error('extension bug');
    });
    hook.on('feature:uninstall', good);

    expect(() => hook.emit('feature:uninstall', 'x')).not.toThrow();
    expect(good).toHaveBeenCalledWith('x');
  });

  it('tracks apps through app:mount and app:unmount', () => {
    const hook = initDevToolsHook();
    const app = { id: 'app-1' } as never;

    hook.emit('app:mount', app);
    expect(hook.apps).toEqual([app]);

    hook.emit('app:unmount', app);
    expect(hook.apps).toEqual([]);
  });

  it('returns a copy of the apps list', () => {
    const hook = initDevToolsHook();
    hook.emit('app:mount', { id: 'a' } as never);
    (hook.apps as unknown[]).length = 0;
    expect(hook.apps).toHaveLength(1);
  });

  it('lists installed features', () => {
    const hook = initDevToolsHook();
    features.install({ id: 'test:a', name: 'A', install: () => {} });
    expect(hook.installedFeatures).toEqual(['test:a']);
  });

  describe('framework events', () => {
    class Root extends Component {
      protected render() {
        return document.createElement('div');
      }
    }

    it('reports apps the framework mounts and unmounts', () => {
      const hook = initDevToolsHook();
      const mounted = vi.fn();
      hook.on('app:mount', mounted);

      const { app, unmount } = mount(Root);
      expect(mounted).toHaveBeenCalledWith(app);
      expect(hook.apps).toEqual([app]);

      unmount();
      expect(hook.apps).toEqual([]);
    });

    it('reports feature installs and uninstalls', () => {
      const hook = initDevToolsHook();
      const installed = vi.fn();
      const uninstalled = vi.fn();
      hook.on('feature:install', installed);
      hook.on('feature:uninstall', uninstalled);

      const remove = features.install({
        id: 'test:b',
        name: 'B',
        install: () => {},
      });
      remove();

      expect(installed).toHaveBeenCalledWith('test:b', 'B');
      expect(uninstalled).toHaveBeenCalledWith('test:b');
    });

    it('keeps its own bridge out of installedFeatures', () => {
      const hook = initDevToolsHook();
      expect(hook.installedFeatures).toEqual([]);
      expect(features.installed).toEqual(['signy:devtools-hook']);
    });

    it('stops reporting after destroy', () => {
      const hook = initDevToolsHook();
      destroyDevToolsHook();
      const { app } = mount(Root);
      expect(hook.apps).not.toContain(app);
      expect(features.installed).toEqual([]);
    });
  });
});
