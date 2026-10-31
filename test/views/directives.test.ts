/**
 * Tests for use: directives and bind: bindings in h() and html
 */

import { describe, it, expect, vi } from 'vitest';
import { Signal, effect, onCleanup } from '../../src/reactivity';
import { Component, type RenderResult } from '../../src';
import { html } from '../../src/views/html';
import { h } from '../../src/views/hyperscript';
import { bind } from '../../src/views/directives';
import { spread } from '../../src/views/attributes';
import { microtask, settle } from '../support/tick';
import { expectLogged } from '../support/console';
import { testRoot } from '../support/root';

function type(control: HTMLInputElement | HTMLTextAreaElement, text: string) {
  control.value = text;
  control.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('use: directives', () => {
  it('calls the directive with the element and an accessor', () => {
    testRoot(() => {
      const seen: unknown[] = [];
      const directive = (el: Element, accessor: () => unknown) => {
        seen.push(el.tagName, accessor());
      };
      html`<div use:tip=${[directive, 'hello']}></div>`;
      expect(seen).toEqual(['DIV', 'hello']);
    });
  });

  it('accepts a bare function and passes an accessor of undefined', () => {
    testRoot(() => {
      const directive = vi.fn();
      html`<div use:tip=${directive}></div>`;
      expect(directive).toHaveBeenCalledOnce();
      expect(directive.mock.calls[0]![1]()).toBeUndefined();
    });
  });

  it('reads a function argument as the accessor, so it can be reactive', () => {
    testRoot(() => {
      const label = new Signal('a');
      const directive = (el: Element, accessor: () => unknown) => {
        effect(() => el.setAttribute('title', String(accessor())));
      };
      const el = html`<div use:tip=${[directive, () => label.value]}></div>`;
      settle();
      expect((el as Element).getAttribute('title')).toBe('a');
      label.value = 'b';
      settle();
      expect((el as Element).getAttribute('title')).toBe('b');
    });
  });

  it('runs the cleanups of the directive when the owner is disposed', () => {
    const cleanup = vi.fn();
    testRoot((dispose) => {
      html`<div use:tip=${(_el: Element) => onCleanup(cleanup)}></div>`;
      expect(cleanup).not.toHaveBeenCalled();
      dispose();
    });
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('does not track what the directive reads', () => {
    testRoot(() => {
      const count = new Signal(0);
      const directive = vi.fn(() => count.value);
      effect(() => {
        html`<div use:tip=${directive}></div>`;
      });
      settle();
      count.value = 1;
      settle();
      expect(directive).toHaveBeenCalledOnce();
    });
  });

  it('works through h()', () => {
    testRoot(() => {
      const directive = vi.fn();
      const el = h('div', { 'use:tip': [directive, 1] });
      expect(directive).toHaveBeenCalledWith(el, expect.any(Function));
    });
  });

  it('works in a template that falls back to h()', () => {
    testRoot(() => {
      const directive = vi.fn();
      const tag = 'div';
      html`<${tag} use:tip=${directive}></${tag}>`;
      expect(directive).toHaveBeenCalledOnce();
    });
  });

  it('warns and skips something that is not a function', () => {
    testRoot(() => {
      html`<div use:tip=${'nope'}></div>`;
    });
    expectLogged('warn', 'view:invalid-directive');
  });
});

describe('bind:value', () => {
  it('shows the signal and follows it', () => {
    testRoot(() => {
      const name = new Signal('Ada');
      const input = html`<input bind:value=${name} />` as HTMLInputElement;
      expect(input.value).toBe('Ada');
      name.value = 'Grace';
      settle();
      expect(input.value).toBe('Grace');
    });
  });

  it('writes the signal as the user types', () => {
    testRoot(() => {
      const name = new Signal('');
      const input = html`<input bind:value=${name} />` as HTMLInputElement;
      type(input, 'Lin');
      expect(name.value).toBe('Lin');
    });
  });

  it('does not write the control again when it already matches', () => {
    testRoot(() => {
      const name = new Signal('');
      const input = html`<input bind:value=${name} />` as HTMLInputElement;
      const setter = vi.spyOn(input, 'value', 'set');
      type(input, 'abc');
      setter.mockClear();
      settle();
      expect(setter).not.toHaveBeenCalled();
    });
  });

  it('shows an empty control for null and undefined', () => {
    testRoot(() => {
      const name = new Signal<string | null>(null);
      const input = html`<input bind:value=${name} />` as HTMLInputElement;
      expect(input.value).toBe('');
    });
  });

  it('works on a textarea', () => {
    testRoot(() => {
      const text = new Signal('one');
      const area = html`<textarea
        bind:value=${text}
      ></textarea>` as HTMLTextAreaElement;
      expect(area.value).toBe('one');
      type(area, 'two');
      expect(text.value).toBe('two');
    });
  });

  it('binds a number input to a number, null while empty', () => {
    testRoot(() => {
      const age = new Signal<number | null>(3);
      const input = html`<input
        type="number"
        bind:value=${age}
      />` as HTMLInputElement;
      expect(input.value).toBe('3');
      type(input, '42');
      expect(age.value).toBe(42);
      type(input, '');
      expect(age.value).toBeNull();
      age.value = 7;
      settle();
      expect(input.value).toBe('7');
    });
  });

  it('works on a select with static options', () => {
    testRoot(() => {
      const color = new Signal('green');
      const select = html`
        <select bind:value=${color}>
          <option value="red">Red</option>
          <option value="green">Green</option>
        </select>
      ` as HTMLSelectElement;
      expect(select.value).toBe('green');
      select.value = 'red';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      expect(color.value).toBe('red');
    });
  });

  it('works through h()', () => {
    testRoot(() => {
      const name = new Signal('x');
      const input = h('input', { 'bind:value': name }) as HTMLInputElement;
      expect(input.value).toBe('x');
    });
  });
});

describe('bind:checked', () => {
  it('shows the signal and writes it on change', () => {
    testRoot(() => {
      const done = new Signal(true);
      const box = html`<input
        type="checkbox"
        bind:checked=${done}
      />` as HTMLInputElement;
      expect(box.checked).toBe(true);
      box.checked = false;
      box.dispatchEvent(new Event('change', { bubbles: true }));
      expect(done.value).toBe(false);
      done.value = true;
      settle();
      expect(box.checked).toBe(true);
    });
  });
});

describe('invalid bindings', () => {
  it('warns about a target without a value', () => {
    testRoot(() => {
      html`<input bind:value=${'text'} />`;
    });
    expectLogged('warn', 'view:invalid-binding');
  });

  it('warns about a property that cannot be bound', () => {
    testRoot(() => {
      html`<input bind:title=${new Signal('')} />`;
    });
    expectLogged('warn', 'view:invalid-binding');
  });
});

describe('bind directive', () => {
  it('binds value, and checked on a checkbox', () => {
    testRoot(() => {
      const name = new Signal('a');
      const done = new Signal(true);
      const input = document.createElement('input');
      const box = document.createElement('input');
      box.type = 'checkbox';
      bind(input, () => name);
      bind(box, () => done);
      expect(input.value).toBe('a');
      expect(box.checked).toBe(true);
    });
  });

  it('takes [signal, property] to pick the property', () => {
    testRoot(() => {
      const on = new Signal(true);
      const box = document.createElement('input');
      box.type = 'radio';
      bind(box, () => [on, 'checked']);
      expect(box.checked).toBe(true);
    });
  });

  it('works as a use: directive in html', () => {
    testRoot(() => {
      const name = new Signal('Ada');
      const input = html`<input
        use:bind=${[bind, name]}
      />` as HTMLInputElement;
      expect(input.value).toBe('Ada');
      type(input, 'Lin');
      expect(name.value).toBe('Lin');
    });
  });
});

describe('bindings wait for the children and the other props', () => {
  const options = (values: string[]) =>
    values.map((v) => h('option', { value: v }, v));

  it('selects the option of a select built by h()', () => {
    testRoot(() => {
      const sig = new Signal('b');
      const select = h(
        'select',
        { 'bind:value': sig },
        ...options(['a', 'b'])
      ) as HTMLSelectElement;
      settle();
      expect(select.value).toBe('b');
    });
  });

  it('selects the option when the template has a component tag and falls back to h()', () => {
    class Badge extends Component {
      protected render(): RenderResult {
        return html`<i>badge</i>`;
      }
    }
    testRoot(() => {
      const color = new Signal('green');
      const form = html`<form>
        <${Badge} />
        <select bind:value=${color}>
          <option value="red">Red</option>
          <option value="green">Green</option>
        </select>
      </form>` as unknown as HTMLElement;
      settle();
      expect(form.querySelector('select')!.value).toBe('green');
    });
  });

  it('selects the option of a select in a compiled template whose options come from a child value', () => {
    testRoot(() => {
      const sig = new Signal('b');
      const list = ['a', 'b', 'c'];
      const select = html`<select bind:value=${sig}>
        ${list.map((v) => html`<option value=${v}>${v}</option>`)}
      </select>` as HTMLSelectElement;
      settle();
      expect(select.value).toBe('b');
    });
  });

  it('keeps the range limits before the value, whatever the order of the props', () => {
    testRoot(() => {
      const byH = h('input', {
        'bind:value': new Signal(500),
        type: 'range',
        min: '0',
        max: '1000',
      }) as HTMLInputElement;
      const byHtml = html`<input
        bind:value=${new Signal(500)}
        type="range"
        min="0"
        max=${'1000'}
      />` as HTMLInputElement;
      const limit = new Signal('1000');
      const dynamic = html`<input
        bind:value=${new Signal(500)}
        type="range"
        min="0"
        max=${() => limit.value}
      />` as HTMLInputElement;
      settle();
      expect(byH.value).toBe('500');
      expect(byHtml.value).toBe('500');
      expect(dynamic.value).toBe('500');
    });
  });

  it('applies prop:value after the children', () => {
    testRoot(() => {
      const select = h(
        'select',
        { 'prop:value': 'b' },
        ...options(['a', 'b'])
      ) as HTMLSelectElement;
      expect(select.value).toBe('b');
      const live = new Signal('b');
      const reactive = h(
        'select',
        { 'prop:value': () => live.value },
        ...options(['a', 'b'])
      ) as HTMLSelectElement;
      settle();
      expect(reactive.value).toBe('b');
    });
  });

  it('runs a directive after the children exist', () => {
    testRoot(() => {
      const seen: number[] = [];
      h(
        'div',
        { 'use:probe': (el: Element) => seen.push(el.children.length) },
        h('i', null),
        h('i', null)
      );
      html`<div use:probe=${(el: Element) => seen.push(el.children.length)}>
        <i></i><b></b><u></u>
      </div>`;
      expect(seen).toEqual([2, 3]);
    });
  });

  it('keeps the order of bindings and directives among themselves', () => {
    testRoot(() => {
      const order: string[] = [];
      h('div', {
        'use:a': () => order.push('a'),
        id: 'x',
        'use:b': () => order.push('b'),
      });
      expect(order).toEqual(['a', 'b']);
    });
  });

  it('still sets ref when the element is created, before the children', () => {
    testRoot(() => {
      let childrenAtRef = -1;
      h(
        'div',
        { ref: (el: Element) => (childrenAtRef = el.children.length) },
        h('i', null)
      );
      expect(childrenAtRef).toBe(0);
    });
  });

  describe('options that arrive later', () => {
    it('selects the value once its option is added', async () => {
      const sig = new Signal('b');
      const select = testRoot(
        () => html`<select bind:value=${sig}></select>` as HTMLSelectElement
      );
      expect(select.value).toBe('');
      for (const v of ['a', 'b']) {
        const option = document.createElement('option');
        option.value = v;
        select.appendChild(option);
      }
      await microtask();
      expect(select.value).toBe('b');
    });

    it('follows the signal and keeps the user choice after that', async () => {
      const sig = new Signal('a');
      const select = testRoot(
        () =>
          html`<select bind:value=${sig}>
            <option value="a">a</option>
            <option value="b">b</option>
          </select>` as HTMLSelectElement
      );
      select.value = 'b';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      expect(sig.value).toBe('b');
      select.appendChild(document.createElement('option'));
      await microtask();
      expect(select.value).toBe('b');
    });

    it('stops observing when its owner is disposed', () => {
      const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
      const sig = new Signal('b');
      testRoot((dispose) => {
        html`<select bind:value=${sig}></select>`;
        expect(disconnect).not.toHaveBeenCalled();
        dispose();
      });
      expect(disconnect).toHaveBeenCalledOnce();
      disconnect.mockRestore();
    });
  });
});

describe('use: and bind: through spread', () => {
  it('binds an input and runs a directive, with no stray attribute', () => {
    testRoot(() => {
      const sig = new Signal('x');
      const directive = vi.fn();
      const input = document.createElement('input');
      spread(input, { 'bind:value': sig, 'use:tip': [directive, 1] });
      settle();
      expect(input.value).toBe('x');
      type(input, 'typed');
      expect(sig.value).toBe('typed');
      expect(directive).toHaveBeenCalledOnce();
      expect(directive).toHaveBeenCalledWith(input, expect.any(Function));
      expect(input.hasAttribute('bind:value')).toBe(false);
      expect(input.hasAttribute('use:tip')).toBe(false);
    });
  });

  it('keeps the binding alive and adds one listener when a reactive spread re-runs', () => {
    testRoot(() => {
      let writes = 0;
      let current = 'start';
      const target = {
        get value() {
          return current;
        },
        set value(v: string) {
          writes++;
          current = v;
        },
      };
      const title = new Signal('a');
      const directive = vi.fn();
      const input = document.createElement('input');
      spread(input, () => ({
        'bind:value': target,
        'use:tip': directive,
        title: title.value,
      }));
      settle();
      title.value = 'b';
      settle();
      title.value = 'c';
      settle();
      expect(input.title).toBe('c');
      expect(directive).toHaveBeenCalledOnce();
      writes = 0;
      type(input, 'once');
      expect(writes).toBe(1);
    });
  });

  it('keeps following the signal after a re-run', () => {
    testRoot(() => {
      const sig = new Signal('one');
      const title = new Signal('a');
      const input = document.createElement('input');
      spread(input, () => ({ 'bind:value': sig, title: title.value }));
      settle();
      title.value = 'b';
      settle();
      sig.value = 'two';
      settle();
      expect(input.value).toBe('two');
    });
  });

  it('applies bindings after the other props of the spread', () => {
    testRoot(() => {
      const input = document.createElement('input');
      spread(input, {
        'bind:value': new Signal(500),
        type: 'range',
        min: '0',
        max: '1000',
      });
      settle();
      expect(input.value).toBe('500');
    });
  });
});
