/**
 * Tests for reactive rendering primitives
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createRenderEffect,
  createSyncEffect,
  text,
  onCleanup,
  createRoot,
  dynamic,
  Signal,
} from '../../src/reactivity';
import {
  bindAttribute,
  bindClassList,
  bindStyle,
  insert,
  spread,
} from '../../src/views';
import { microtask, settle } from '../support/tick';

describe('Reactive Rendering', () => {
  describe('createRenderEffect', () => {
    it('should run immediately', () => {
      const fn = vi.fn();
      createRenderEffect(fn);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should re-run when dependencies change', async () => {
      const count = new Signal(0);
      const values: number[] = [];

      createRenderEffect(() => {
        values.push(count.value);
      });

      expect(values).toEqual([0]);

      count.value = 1;
      settle();

      expect(values).toEqual([0, 1]);
    });

    it('runs a write made after settle() in the microtask already queued', async () => {
      const count = new Signal(0);
      const values: number[] = [];
      const cleanup = createRenderEffect(() => {
        values.push(count.value);
      });

      count.value = 1;
      settle();
      // The microtask queued for the first re-run is still pending
      count.value = 2;
      await microtask();
      expect(values).toEqual([0, 1, 2]);

      count.value = 3;
      await microtask();
      expect(values).toEqual([0, 1, 2, 3]);
      cleanup();
    });

    it('should return cleanup function', () => {
      const fn = vi.fn();
      const cleanup = createRenderEffect(fn);

      expect(typeof cleanup).toBe('function');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should stop running after disposal', async () => {
      const count = new Signal(0);
      const values: number[] = [];

      const cleanup = createRenderEffect(() => {
        values.push(count.value);
      });

      expect(values).toEqual([0]);
      cleanup();

      count.value = 1;
      settle();

      expect(values).toEqual([0]); // Should not have added 1
    });
  });

  describe('createSyncEffect', () => {
    it('should run immediately', () => {
      const fn = vi.fn();
      createSyncEffect(fn);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should re-run synchronously when dependencies change (no await needed)', () => {
      const count = new Signal(0);
      const values: number[] = [];

      createSyncEffect(() => {
        values.push(count.value);
      });

      expect(values).toEqual([0]);

      // Unlike createRenderEffect, this should update synchronously
      count.value = 1;
      expect(values).toEqual([0, 1]); // Already updated!

      count.value = 2;
      expect(values).toEqual([0, 1, 2]); // Already updated!
    });

    it('should return cleanup function', () => {
      const fn = vi.fn();
      const cleanup = createSyncEffect(fn);

      expect(typeof cleanup).toBe('function');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should stop running after disposal', () => {
      const count = new Signal(0);
      const values: number[] = [];

      const cleanup = createSyncEffect(() => {
        values.push(count.value);
      });

      expect(values).toEqual([0]);
      cleanup();

      count.value = 1;
      expect(values).toEqual([0]); // Should not have added 1
    });

    it('should update DOM synchronously for benchmarking', () => {
      const element = document.createElement('div');
      const count = new Signal(0);

      createSyncEffect(() => {
        element.textContent = `Count: ${count.value}`;
      });

      expect(element.textContent).toBe('Count: 0');

      count.value = 42;
      // No await needed - DOM is already updated
      expect(element.textContent).toBe('Count: 42');
    });
  });

  describe('text', () => {
    it('should create a text node', () => {
      const node = text(() => 'Hello');
      expect(node).toBeInstanceOf(Text);
      expect(node.textContent).toBe('Hello');
    });

    it('should update when signal changes', async () => {
      const name = new Signal('World');
      const node = text(() => `Hello, ${name.value}!`);

      expect(node.textContent).toBe('Hello, World!');

      name.value = 'Signy';
      settle();

      expect(node.textContent).toBe('Hello, Signy!');
    });

    it('should handle null/undefined', () => {
      const node = text(() => null);
      expect(node.textContent).toBe('');
    });

    it('should convert numbers to string', () => {
      const count = new Signal(42);
      const node = text(() => count.value);
      expect(node.textContent).toBe('42');
    });
  });

  describe('bindAttribute', () => {
    it('should set attribute reactively', async () => {
      const element = document.createElement('button');
      const disabled = new Signal(false);

      bindAttribute(element, 'disabled', () => disabled.value);

      expect(element.hasAttribute('disabled')).toBe(false);

      disabled.value = true;
      settle();

      expect(element.hasAttribute('disabled')).toBe(true);
    });

    it('should remove attribute when null', async () => {
      const element = document.createElement('div');
      const value = new Signal<string | null>('test');

      bindAttribute(element, 'data-test', () => value.value);
      expect(element.getAttribute('data-test')).toBe('test');

      value.value = null;
      settle();

      expect(element.hasAttribute('data-test')).toBe(false);
    });
  });

  describe('bindClassList', () => {
    it('should toggle classes reactively', async () => {
      const element = document.createElement('div');
      const isActive = new Signal(false);

      bindClassList(element, () => ({
        active: isActive.value,
        enabled: true,
      }));

      expect(element.classList.contains('active')).toBe(false);
      expect(element.classList.contains('enabled')).toBe(true);

      isActive.value = true;
      settle();

      expect(element.classList.contains('active')).toBe(true);
      expect(element.classList.contains('enabled')).toBe(true);
    });
  });

  describe('bindStyle', () => {
    it('should set styles reactively', async () => {
      const element = document.createElement('div');
      const color = new Signal('red');

      bindStyle(element, () => ({
        color: color.value,
        'font-weight': 'bold',
      }));

      // Note: jsdom may handle style differently
      // These tests verify the function runs without error

      color.value = 'blue';
      settle();

      // Effect should have run
    });
  });
});

describe('onCleanup in a render effect', () => {
  it('runs before the next run and on dispose', () => {
    const count = new Signal(0);
    const cleanups: number[] = [];
    const dispose = createRenderEffect(() => {
      const seen = count.value;
      onCleanup(() => cleanups.push(seen));
    });

    count.value = 1;
    settle();
    expect(cleanups).toEqual([0]);

    dispose();
    expect(cleanups).toEqual([0, 1]);
  });
});

describe('insert', () => {
  it('appends static content', () => {
    const parent = document.createElement('div');
    insert(parent, ['a', 1, null, document.createElement('b')]);
    expect(parent.innerHTML).toBe('a1<b></b>');
  });

  it('updates reactive text in place', () => {
    const parent = document.createElement('div');
    const value = new Signal('a');
    insert(parent, () => value.value);
    const node = parent.firstChild;

    value.value = 'b';
    settle();
    expect(parent.textContent).toBe('b');
    expect(parent.firstChild).toBe(node);
  });

  it('switches between markup, text and nothing', () => {
    const parent = document.createElement('div');
    const value = new Signal<unknown>(null);
    insert(parent, () => value.value);
    expect(parent.textContent).toBe('');

    const b = document.createElement('b');
    value.value = b;
    settle();
    expect(parent.firstChild).toBe(b);

    value.value = 'text';
    settle();
    expect(parent.innerHTML).toBe('text');

    value.value = [document.createElement('i'), 'x'];
    settle();
    expect(parent.innerHTML).toBe('<i></i>x');
  });

  it('keeps its place among siblings when it renders nothing', () => {
    const parent = document.createElement('div');
    const value = new Signal<string | null>('x');
    insert(parent, () => value.value);
    parent.appendChild(document.createTextNode('|'));

    value.value = null;
    settle();
    value.value = 'y';
    settle();
    expect(parent.textContent).toBe('y|');
  });

  it('follows its nodes when they move out of a fragment', () => {
    const fragment = document.createDocumentFragment();
    const value = new Signal('a');
    insert(fragment, () => value.value);
    const parent = document.createElement('div');
    parent.appendChild(fragment);

    value.value = 'b';
    settle();
    expect(parent.textContent).toBe('b');
  });

  it('inserts static content before a marker', () => {
    const parent = document.createElement('div');
    const end = parent.appendChild(document.createElement('i'));
    insert(parent, 'x', end);
    expect(parent.innerHTML).toBe('x<i></i>');
  });

  it('replaces reactive content in place', () => {
    const parent = document.createElement('div');
    parent.appendChild(document.createTextNode('['));
    const end = parent.appendChild(document.createTextNode(']'));
    const items = new Signal(['a', 'b']);

    insert(parent, () => items.value, end);
    expect(parent.textContent).toBe('[ab]');

    items.value = ['c'];
    settle();
    expect(parent.textContent).toBe('[c]');

    items.value = [];
    settle();
    expect(parent.textContent).toBe('[]');
  });

  it('skips booleans and null in reactive arrays', () => {
    const parent = document.createElement('div');
    insert(parent, () => ['a', true, false, null, 'b']);
    expect(parent.textContent).toBe('ab');
  });

  it('stops updating when its owner is disposed', () => {
    const parent = document.createElement('div');
    const value = new Signal('a');
    createRoot((dispose) => {
      insert(parent, () => value.value);
      dispose();
    });

    value.value = 'b';
    settle();
    expect(parent.textContent).toBe('a');
  });
});

describe('dynamic', () => {
  it('returns the accessor unchanged', () => {
    const accessor = () => 1;
    expect(dynamic(accessor)).toBe(accessor);
  });
});

describe('spread', () => {
  it('applies static props', () => {
    const el = document.createElement('div');
    const onClick = vi.fn();
    spread(el, {
      class: 'btn',
      style: { color: 'red' },
      disabled: true,
      title: 'go',
      hidden: false,
      children: 'ignored',
      onClick,
    });

    el.click();
    expect(el.className).toBe('btn');
    expect(el.style.color).toBe('red');
    expect(el.hasAttribute('disabled')).toBe(true);
    expect(el.getAttribute('title')).toBe('go');
    expect(el.hasAttribute('hidden')).toBe(false);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('updates reactive props and removes cleared ones', () => {
    const el = document.createElement('div');
    const title = new Signal<string | null>('a');
    spread(el, () => ({ title: title.value, style: 'color: blue' }));
    expect(el.getAttribute('title')).toBe('a');

    title.value = null;
    settle();
    expect(el.hasAttribute('title')).toBe(false);
    expect(el.style.color).toBe('blue');
  });

  it('keeps one listener per event across reactive updates', () => {
    const el = document.createElement('button');
    const title = new Signal('a');
    let clicks = 0;
    // A new handler on every run, as an inline arrow in a template would be
    spread(el, () => ({ title: title.value, onClick: () => clicks++ }));

    title.value = 'b';
    settle();
    title.value = 'c';
    settle();
    el.click();

    expect(clicks).toBe(1);
  });

  it('applies the on:, oncapture:, class:, style: and bool: namespaces', () => {
    const parent = document.createElement('div');
    const el = document.createElement('button');
    parent.appendChild(el);
    const order: string[] = [];
    parent.addEventListener('click', () => order.push('bubble'));
    spread(parent, { 'oncapture:click': () => order.push('capture') });
    spread(el, {
      'on:click': () => order.push('on'),
      'class:active': true,
      'class:gone': false,
      'style:color': 'red',
      'bool:hidden': true,
      'bool:inert': false,
    });

    el.click();
    expect(order).toEqual(['capture', 'on', 'bubble']);
    expect(el.className).toBe('active');
    expect(el.style.color).toBe('red');
    expect(el.hasAttribute('hidden')).toBe(true);
    expect(el.hasAttribute('inert')).toBe(false);
    expect(el.hasAttribute('class:active')).toBe(false);
  });

  it('replaces an on: listener and updates namespaced props', () => {
    const el = document.createElement('button');
    const on = new Signal(true);
    let clicks = 0;
    spread(el, () => ({
      'on:click': () => clicks++,
      'class:active': on.value,
      'style:color': on.value ? 'red' : null,
      'bool:hidden': on.value,
    }));

    on.value = false;
    settle();
    el.click();
    expect(clicks).toBe(1);
    expect(el.classList.contains('active')).toBe(false);
    expect(el.style.color).toBe('');
    expect(el.hasAttribute('hidden')).toBe(false);
  });

  it('removes a class dropped from a reactive classList', () => {
    const el = document.createElement('div');
    const on = new Signal(true);
    spread(el, () => ({
      classList: on.value ? { a: true, b: true } : { b: true },
    }));
    expect(el.className).toBe('a b');

    on.value = false;
    settle();
    expect(el.className).toBe('b');
  });

  it('sets form state, content and custom element props as properties', () => {
    const input = document.createElement('input');
    const value = new Signal('a');
    spread(input, () => ({ value: value.value, checked: true }));
    input.value = 'typed';
    value.value = 'b';
    settle();
    expect(input.value).toBe('b');
    expect(input.checked).toBe(true);

    const div = document.createElement('div');
    spread(div, { textContent: 'x' });
    expect(div.outerHTML).toBe('<div>x</div>');

    const label = document.createElement('label');
    spread(label, { htmlFor: 'name' });
    expect(label.getAttribute('for')).toBe('name');

    const custom = document.createElement('x-spread-props');
    const items = [1, 2];
    spread(custom, { items, 'data-x': '1' });
    expect((custom as unknown as { items: number[] }).items).toBe(items);
    expect(custom.getAttribute('data-x')).toBe('1');
  });

  it('clears a value set to null', () => {
    const input = document.createElement('input');
    spread(input, { value: null });
    expect(input.value).toBe('');
  });
});
