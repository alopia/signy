/**
 * The html tagged template, through the public entry point. Covers the rules
 * in ai/signy-usage.md, including the documented pitfalls.
 */

import { describe, it, expect, vi } from 'vitest';
import { within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import {
  Component,
  Signal,
  Show,
  For,
  Index,
  Switch,
  Match,
  createRef,
  html,
  type RenderResult,
} from '../../src';
import { mount } from '../support/mount';
import { settle } from '../support/tick';
import { expectLogged } from '../support/console';

const first = (result: unknown): Element =>
  (Array.isArray(result) ? result[0] : result) as Element;

describe('html template', () => {
  describe('static markup', () => {
    // htm caches the result of a fully static template, and a DOM node can
    // only be in one place
    describe('character references', () => {
      class Tag extends Component {
        protected render(): RenderResult {
          return html`<b>c</b>`;
        }
      }
      it('decodes them in text and attributes', () => {
        const p = first(html`<p title="a &amp; b">a&amp;b&nbsp;c &copy;</p>`);
        expect(p.textContent).toBe('a&b\u00a0c \u00a9');
        expect(p.getAttribute('title')).toBe('a & b');
        const q = first(html`<p title="x <b> &lt; &#38; &#x26;">y</p>`);
        expect(q.getAttribute('title')).toBe('x <b> < & &');
      });

      it('decodes them on the path with component tags', () => {
        const { root } = mount(
          () => html`<div title="x &lt; y"><${Tag} />&copy; 2026</div>`
        );
        const div = root.querySelector('div')!;
        expect(div.textContent).toBe('c\u00a9 2026');
        expect(div.title).toBe('x < y');
      });

      it('leaves the values passed in as they are', () => {
        const text = 'a &amp; b';
        const p = first(html`<p title=${text}>${text}</p>`) as HTMLElement;
        expect(p.textContent).toBe(text);
        expect(p.title).toBe(text);
        const { root } = mount(
          () => html`<div title="&copy; ${text}"><${Tag} />${text} &amp;</div>`
        );
        const div = root.querySelector('div')!;
        expect(div.textContent).toBe(`c${text} &`);
        expect(div.title).toBe(`\u00a9 ${text}`);
      });
    });

    it('creates new nodes each time a static template runs', () => {
      const make = () => html`<p class="hint">Loading</p>`;
      const a = make();
      const b = make();
      expect(a).not.toBe(b);
      expect(first(a).outerHTML).toBe(first(b).outerHTML);
    });

    it('shows a static fallback in every row that uses it', () => {
      const make = () => html`<i>none</i>`;
      const host = document.createElement('div');
      for (let i = 0; i < 3; i++) {
        const row = document.createElement('p');
        row.append(first(make()));
        host.append(row);
      }
      expect(host.querySelectorAll('i')).toHaveLength(3);
    });

    it('creates elements with attributes and text', () => {
      const el = first(html`<a href="/x" title="go">link</a>`);
      expect(el.outerHTML).toBe('<a href="/x" title="go">link</a>');
    });

    it('returns an array for several root nodes', () => {
      const result = html`<p>a</p>
        <p>b</p>`;
      expect(Array.isArray(result)).toBe(true);
      expect((result as Element[]).map((n) => n.textContent)).toEqual([
        'a',
        'b',
      ]);
    });

    it('renders true boolean attributes and omits false and null ones', () => {
      const el = first(
        html`<input disabled=${true} readonly=${false} name=${null} />`
      );
      expect(el.hasAttribute('disabled')).toBe(true);
      expect(el.hasAttribute('readonly')).toBe(false);
      expect(el.hasAttribute('name')).toBe(false);
    });

    it('accepts a style object and a class string', () => {
      const el = first(
        html`<div class="a b" style=${{ color: 'red' }}></div>`
      ) as HTMLElement;
      expect(el.className).toBe('a b');
      expect(el.style.color).toBe('red');
    });

    it('skips null, undefined and boolean children', () => {
      const el = first(html`<p>${null}${undefined}${false}${true}x</p>`);
      expect(el.innerHTML).toBe('x');
    });

    it('renders arrays of nodes', () => {
      const items = ['a', 'b', 'c'];
      const el = first(
        html`<ul>
          ${items.map((i) => html`<li>${i}</li>`)}
        </ul>`
      );
      expect(el.querySelectorAll('li')).toHaveLength(3);
      expect(el.textContent).toBe('abc');
    });

    it('escapes interpolated strings instead of parsing them', () => {
      const el = first(html`<p>${'<b>bold</b>'}</p>`);
      expect(el.querySelector('b')).toBeNull();
      expect(el.textContent).toBe('<b>bold</b>');
    });
  });

  describe('live bindings', () => {
    it('updates text bound with a function', () => {
      const count = new Signal(1);
      const el = first(html`<p>${() => count.value}</p>`);

      count.value = 2;
      expect(el.textContent).toBe('1');
      settle();
      expect(el.textContent).toBe('2');
    });

    it('keeps a plain value frozen at render time', () => {
      const count = new Signal(1);
      const el = first(html`<p>${count.value}</p>`);

      count.value = 2;
      settle();
      expect(el.textContent).toBe('1');
    });

    it('updates class, style and boolean attributes', () => {
      const on = new Signal(false);
      const el = first(
        html`<button
          class=${() => (on.value ? 'on' : 'off')}
          style=${() => ({ opacity: on.value ? '1' : '0.5' })}
          disabled=${() => !on.value}
        ></button>`
      ) as HTMLButtonElement;

      expect(el.className).toBe('off');
      expect(el.style.opacity).toBe('0.5');
      expect(el.disabled).toBe(true);

      on.value = true;
      settle();
      expect(el.className).toBe('on');
      expect(el.style.opacity).toBe('1');
      expect(el.disabled).toBe(false);
    });

    it('removes an attribute when its binding returns null', () => {
      const title = new Signal<string | null>('hi');
      const el = first(html`<p title=${() => title.value}></p>`);
      expect(el.getAttribute('title')).toBe('hi');

      title.value = null;
      settle();
      expect(el.hasAttribute('title')).toBe(false);
    });

    it('sets the value attribute, not the property (pitfall)', async () => {
      const value = new Signal('a');
      const { root } = mount(() => html`<input value=${() => value.value} />`);
      const input = root.querySelector('input')!;

      await userEvent.type(input, 'typed');
      value.value = 'reset';
      settle();

      expect(input.getAttribute('value')).toBe('reset');
      expect(input.value).toBe('atyped');
    });

    it('renders markup returned from a function child', () => {
      const ok = new Signal(true);
      const el = first(
        html`<p>${() => (ok.value ? html`<b>yes</b>` : null)}</p>`
      );
      expect(el.querySelector('b')?.textContent).toBe('yes');

      ok.value = false;
      settle();
      expect(el.querySelector('b')).toBeNull();

      ok.value = true;
      settle();
      expect(el.querySelector('b')?.textContent).toBe('yes');
    });
  });

  describe('events', () => {
    it('attaches on* handlers', async () => {
      const onClick = vi.fn();
      const { root } = mount(
        () => html`<button onClick=${onClick}>go</button>`
      );

      await userEvent.click(within(root).getByRole('button', { name: 'go' }));
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('lowercases the event name, so onDblClick listens to dblclick', async () => {
      const onDblClick = vi.fn();
      const { root } = mount(
        () => html`<button onDblClick=${onDblClick}>go</button>`
      );

      await userEvent.dblClick(within(root).getByRole('button'));
      expect(onDblClick).toHaveBeenCalledTimes(1);
    });

    it('delegates a click, with the element as this and currentTarget', () => {
      let seen: [unknown, unknown] | undefined;
      const { root } = mount(
        () =>
          html`<button
            onClick=${function (this: unknown, e: Event) {
              seen = [this, e.currentTarget];
            }}
          >
            go
          </button>`
      );
      const button = within(root).getByRole('button');

      expect(button.onclick).toBeNull();
      button.click();
      expect(seen).toEqual([button, button]);
    });

    const clickThrowingChild = (parent: () => void) => {
      const root = html`<div onClick=${parent}>
        <button
          onClick=${() => {
            throw new Error('child fails');
          }}
        >
          x
        </button>
      </div>` as HTMLElement;
      document.body.appendChild(root);
      const reported: unknown[] = [];
      const onError = (e: ErrorEvent) => {
        e.preventDefault();
        reported.push(e.error);
      };
      window.addEventListener('error', onError);
      root.querySelector('button')!.click();
      return {
        reported,
        done: () => {
          window.removeEventListener('error', onError);
          root.remove();
        },
      };
    };

    it('reports a throwing delegated handler with reportError and still runs the handlers above it', () => {
      // What browsers have: reportError dispatches the window error event at once
      const original = (globalThis as { reportError?: unknown }).reportError;
      (globalThis as { reportError?: unknown }).reportError = (
        error: unknown
      ) =>
        window.dispatchEvent(
          new ErrorEvent('error', { error, cancelable: true })
        );
      const parent = vi.fn();
      const { reported, done } = clickThrowingChild(parent);
      done();
      (globalThis as { reportError?: unknown }).reportError = original;

      expect(parent).toHaveBeenCalledOnce();
      expect(reported).toHaveLength(1);
      expect((reported[0] as Error).message).toBe('child fails');
    });

    it('rethrows it from a timer where reportError is missing, and still runs the handlers above it', () => {
      const original = (globalThis as { reportError?: unknown }).reportError;
      (globalThis as { reportError?: unknown }).reportError = undefined;
      const timers: (() => void)[] = [];
      const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
        fn: () => void
      ) => {
        timers.push(fn);
        return 0;
      }) as never);
      const parent = vi.fn();
      const { done } = clickThrowingChild(parent);
      spy.mockRestore();
      done();
      (globalThis as { reportError?: unknown }).reportError = original;

      expect(parent).toHaveBeenCalledOnce();
      expect(timers).toHaveLength(1);
      expect(() => timers[0]!()).toThrow('child fails');
    });

    it('keeps honoring stopPropagation when the handler that called it threw', () => {
      const parent = vi.fn();
      const root = html`<div onClick=${parent}>
        <button
          onClick=${(e: Event) => {
            e.stopPropagation();
            throw new Error('after stop');
          }}
        >
          x
        </button>
      </div>` as HTMLElement;
      document.body.appendChild(root);
      const onError = (e: ErrorEvent) => e.preventDefault();
      window.addEventListener('error', onError);
      root.querySelector('button')!.click();
      window.removeEventListener('error', onError);
      root.remove();

      expect(parent).not.toHaveBeenCalled();
    });

    it('runs every handler of a path when more than one throws', () => {
      const calls: string[] = [];
      const root = html`<section onClick=${() => calls.push('section')}>
        <div
          onClick=${() => {
            calls.push('div');
            throw new Error('div');
          }}
        >
          <button
            onClick=${() => {
              calls.push('button');
              throw new Error('button');
            }}
          >
            x
          </button>
        </div>
      </section>` as HTMLElement;
      document.body.appendChild(root);
      const onError = (e: ErrorEvent) => e.preventDefault();
      window.addEventListener('error', onError);
      root.querySelector('button')!.click();
      window.removeEventListener('error', onError);
      root.remove();

      expect(calls).toEqual(['button', 'div', 'section']);
    });

    it('restores currentTarget after a delegated handler throws', () => {
      const button = html`<button
        onClick=${() => {
          throw new Error('boom');
        }}
      >
        x
      </button>` as HTMLButtonElement;
      document.body.appendChild(button);
      const event = new MouseEvent('click', { bubbles: true });
      const onError = (e: ErrorEvent) => e.preventDefault();
      window.addEventListener('error', onError);
      button.dispatchEvent(event);
      window.removeEventListener('error', onError);
      button.remove();

      expect(event.currentTarget).toBe(document);
    });

    it('runs the inner delegated handler first and stops at stopPropagation', () => {
      const calls: string[] = [];
      const { root } = mount(
        () =>
          html`<div onClick=${() => calls.push('outer')}>
            <button
              onClick=${(e: Event) => (calls.push('inner'), e.stopPropagation())}
            >
              go
            </button>
            <i onClick=${() => calls.push('i')}>x</i>
          </div>`
      );

      within(root).getByRole('button').click();
      root.querySelector('i')!.click();
      expect(calls).toEqual(['inner', 'i', 'outer']);
    });

    it('listens on the element itself with on:, also outside the document', () => {
      const onClick = vi.fn();
      const onPing = vi.fn();
      const button = first(
        html`<button on:click=${onClick} on:Ping=${onPing}>go</button>`
      ) as HTMLButtonElement;

      button.click();
      button.dispatchEvent(new Event('Ping'));
      expect(onClick).toHaveBeenCalledTimes(1);
      expect(onPing).toHaveBeenCalledTimes(1);
    });

    it('listens on the element for an event that is not delegated', () => {
      const onChange = vi.fn();
      const input = first(
        html`<input onChange=${onChange} />`
      ) as HTMLInputElement;

      input.dispatchEvent(new Event('change'));
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('runs delegated handlers inside a closed shadow root', () => {
      const onClick = vi.fn();
      const button = createRef<HTMLButtonElement>();
      class Widget extends Component {
        protected shadow = { mode: 'closed' as const };
        protected render(): RenderResult {
          return html`<button ref=${button} onClick=${onClick}>in</button>`;
        }
      }
      const outer = vi.fn();
      mount(() => html`<div onClick=${outer}><${Widget} /></div>`);

      button.current!.click();
      expect(onClick).toHaveBeenCalledTimes(1);
      expect(outer).toHaveBeenCalledTimes(1);
    });
  });

  describe('template reuse', () => {
    it('puts each value next to the right static nodes', () => {
      const make = (a: unknown, b: unknown) =>
        first(html`<p>${a}<b>x</b>${b} tail <i>${a}${b}</i></p>`);

      expect(make('1', '2').outerHTML).toBe('<p>1<b>x</b>2 tail <i>12</i></p>');
      expect(make(3, null).outerHTML).toBe('<p>3<b>x</b> tail <i>3</i></p>');
    });

    it('keeps live bindings in each copy apart', () => {
      const count = new Signal(1);
      const make = (n: number) =>
        first(html`<p title=${`row ${n}`}>${() => count.value * n}</p>`);
      const a = make(1);
      const b = make(10);
      count.value = 2;
      settle();

      expect([a.outerHTML, b.outerHTML]).toEqual([
        '<p title="row 1">2</p>',
        '<p title="row 10">20</p>',
      ]);
    });

    it('renders a value inside an attribute string', () => {
      const make = (n: number) => first(html`<p class="a b-${n}">x</p>`);
      expect(make(1).className).toBe('a b-1');
      expect(make(2).className).toBe('a b-2');
    });

    it('renders a spread and a tag from a value', () => {
      const make = (tag: string, props: object) =>
        first(html`<${tag} ...${props} id="x" />`);
      expect(make('section', { title: 't' }).outerHTML).toBe(
        '<section title="t" id="x"></section>'
      );
      expect(make('aside', {}).outerHTML).toBe('<aside id="x"></aside>');
    });

    it('creates SVG elements in the SVG namespace, also as a root', () => {
      const circle = first(html`<circle r=${2} />`);
      const svg = first(
        html`<svg>
          <g><path d=${'M0 0'} /></g>
        </svg>`
      );
      const ns = 'http://www.w3.org/2000/svg';

      expect(circle.namespaceURI).toBe(ns);
      expect(svg.querySelector('path')!.namespaceURI).toBe(ns);
      expect(svg.querySelector('path')!.getAttribute('d')).toBe('M0 0');
    });

    it('writes no class for an empty or null value', () => {
      const make = (cls: string | null) => first(html`<p class=${cls}>x</p>`);
      expect(make('').outerHTML).toBe('<p>x</p>');
      expect(make(null).outerHTML).toBe('<p>x</p>');
    });

    it('empties a bound class that had a value', () => {
      const on = new Signal(false);
      const p = first(html`<p class=${() => (on.value ? 'on' : '')}>x</p>`);
      expect(p.hasAttribute('class')).toBe(false);

      on.value = true;
      settle();
      expect(p.className).toBe('on');

      on.value = false;
      settle();
      expect(p.className).toBe('');
    });

    it('drops an unsafe static attribute', () => {
      const make = () => first(html`<a href="javascript:alert(1)">x</a>`);
      expect(make().outerHTML).toBe('<a>x</a>');
      expect(make().outerHTML).toBe('<a>x</a>');
      expectLogged('warn', 'view:unsafe-attribute');
    });
  });

  describe('refs', () => {
    it('fills a ref object', () => {
      const ref = createRef<HTMLInputElement>();
      const el = first(html`<input ref=${ref} />`);
      expect(ref.current).toBe(el);
    });

    it('calls a ref callback with the element', () => {
      const ref = vi.fn();
      const el = first(html`<input ref=${ref} />`);
      expect(ref).toHaveBeenCalledWith(el);
    });
  });

  describe('components as tags', () => {
    it('passes props and a single child', () => {
      class Card extends Component<{ title: string; children?: Node }> {
        protected render(): RenderResult {
          return html`<section>
            <h2>${this.props.title}</h2>
            ${this.props.children}
          </section>`;
        }
      }

      const { root } = mount(
        () => html`<${Card} title="Hello"><p>body</p></${Card}>`
      );
      expect(within(root).getByRole('heading').textContent).toBe('Hello');
      expect(root.querySelector('section > p')?.textContent).toBe('body');
    });

    it('passes several children as an array', () => {
      let received: unknown;
      class List extends Component<{ children?: Node[] }> {
        protected render(): RenderResult {
          received = this.props.children;
          return html`<ul>
            ${this.props.children}
          </ul>`;
        }
      }

      const { root } = mount(
        () => html`<${List}><li>a</li><li>b</li></${List}>`
      );
      expect(Array.isArray(received)).toBe(true);
      expect(root.querySelectorAll('li')).toHaveLength(2);
    });

    it('calls function components with props and children', () => {
      const Badge = (props: { label: string; children: unknown[] }) =>
        first(html`<span class="badge">${props.label}${props.children}</span>`);

      const el = first(html`<${Badge} label="new">!</${Badge}>`);
      expect(el.outerHTML).toBe('<span class="badge">new!</span>');
    });

    it('nests templates', () => {
      const inner = html`<b>inner</b>`;
      const el = first(html`<div>${inner}</div>`);
      expect(el.innerHTML).toBe('<b>inner</b>');
    });
  });

  describe('control flow', () => {
    it('renders Show and For called as functions', () => {
      const visible = new Signal(false);
      const items = new Signal(['a']);
      const { root } = mount(
        () =>
          html`<div>
            ${Show({ when: () => visible.value, children: () => first(html`<b>shown</b>`) })}
            <ul>
              ${For({ each: () => items.value, children: (i: string) => first(html`<li>${i}</li>`) })}
            </ul>
          </div>`
      );

      expect(root.querySelector('b')).toBeNull();
      expect(root.querySelectorAll('li')).toHaveLength(1);

      visible.value = true;
      items.value = ['a', 'b', 'c'];
      settle();

      expect(root.querySelector('b')?.textContent).toBe('shown');
      expect(root.querySelectorAll('li')).toHaveLength(3);
    });

    it('renders For, Index, Switch and Match used as tags', () => {
      const items = new Signal([1, 2]);
      const { root } = mount(
        () => html`<div>
          <ul class="for"><${For} each=${() => items.value}>${(i: number) => html`<li>${i}</li>`}</${For}></ul>
          <ul class="index"><${Index} each=${() => items.value}>${(i: () => number) => html`<li>${() => i()}</li>`}</${Index}></ul>
          <${Switch}>
            <${Match} when=${false}><i>no</i></${Match}>
            <${Match} when=${true}><b>yes</b></${Match}>
          </${Switch}>
        </div>`
      );
      items.value = [3, 4, 5];
      settle();
      expect(root.querySelector('.for')?.textContent).toBe('345');
      expect(root.querySelector('.index')?.textContent).toBe('345');
      expect(root.querySelector('b')?.textContent).toBe('yes');
      expect(root.querySelector('i')).toBeNull();
    });

    it('renders Show used as a tag with node children', () => {
      const { root } = mount(
        () => html`<div><${Show} when=${true}><b>x</b></${Show}></div>`
      );
      expect(root.querySelector('b')?.textContent).toBe('x');
    });

    it('keeps listeners on a node child passed to Show', async () => {
      const onClick = vi.fn();
      const { root } = mount(
        () =>
          html`<div>
            ${Show({ when: true, children: first(html`<button onClick=${onClick}>x</button>`) })}
          </div>`
      );

      await userEvent.click(within(root).getByRole('button'));
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('keeps listeners when Show gets a function child', async () => {
      const onClick = vi.fn();
      const { root } = mount(
        () =>
          html`<div>
            ${Show({ when: true, children: () => first(html`<button onClick=${onClick}>x</button>`) })}
          </div>`
      );

      await userEvent.click(within(root).getByRole('button'));
      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });
});

describe('prop: and attr: in templates', () => {
  it('prop: sets a property, not an attribute', () => {
    const input = first(
      html`<input prop:value=${'typed'} />`
    ) as HTMLInputElement;
    expect(input.value).toBe('typed');
    expect(input.hasAttribute('value')).toBe(false);
    expect(input.hasAttribute('prop:value')).toBe(false);
  });

  it('prop: writes an empty string for undefined on a text property', () => {
    const value = new Signal<string | undefined>('x');
    const extra = new Signal<unknown>(1);
    const { root } = mount(
      () =>
        html`<div>
          <input prop:value=${() => value.value} />
          <x-card prop:extra=${() => extra.value}></x-card>
        </div>`
    );
    value.value = undefined;
    extra.value = undefined;
    settle();
    expect(root.querySelector('input')!.value).toBe('');
    expect(
      (root.querySelector('x-card') as unknown as { extra: unknown }).extra
    ).toBeUndefined();
  });

  it('a class binding keeps a class other code added', () => {
    const cls = new Signal('a');
    const { root } = mount(
      () => html`<div><p class=${() => cls.value}></p></div>`
    );
    const p = root.querySelector('p')!;
    // A directive or a third party script, for example
    p.classList.add('lit');
    cls.value = 'b';
    settle();
    expect(p.className).toBe('lit b');
  });

  it('prop: follows a binding', () => {
    const checked = new Signal(false);
    const { root } = mount(
      () => html`<input type="checkbox" prop:checked=${() => checked.value} />`
    );
    const box = root.querySelector('input')!;
    expect(box.checked).toBe(false);

    checked.value = true;
    settle();
    expect(box.checked).toBe(true);
    expect(box.hasAttribute('checked')).toBe(false);
  });

  it('sets a static prop: on each element the template makes', () => {
    const render = () =>
      first(html`<x-card prop:mode="compact" title=${'t'}></x-card>`);
    for (const card of [render(), render()]) {
      expect((card as unknown as { mode: string }).mode).toBe('compact');
      expect(card.hasAttribute('prop:mode')).toBe(false);
    }
  });

  it('attr: sets the attribute', () => {
    const el = first(html`<div attr:data-x=${'1'} attr:title="hi"></div>`);
    expect(el.getAttribute('data-x')).toBe('1');
    expect(el.getAttribute('title')).toBe('hi');
    expect(el.hasAttribute('attr:title')).toBe(false);
  });

  it('prop: refuses a javascript: URL', () => {
    const a = first(
      html`<a prop:href=${'javascript:alert(1)'}>x</a>`
    ) as HTMLAnchorElement;
    expectLogged('warn', 'view:unsafe-attribute');
    expect(a.getAttribute('href')).toBeNull();
  });
});

describe('mixed attribute values', () => {
  it('bind a function among static text', () => {
    const tone = new Signal('b');
    const { root } = mount(
      () => html`<p class="a ${() => tone.value} c" title="${'x'}-${'y'}">p</p>`
    );
    const p = root.querySelector('p')!;
    expect(p.className).toBe('a b c');
    expect(p.title).toBe('x-y');

    tone.value = 'd';
    settle();
    expect(p.className).toBe('a d c');
  });

  it('bind a function in a template that holds a component', () => {
    class Badge extends Component {
      protected render(): RenderResult {
        return html`<b>badge</b>`;
      }
    }
    const on = new Signal(true);
    const { root } = mount(
      () =>
        html`<div class="box ${() => (on.value ? 'on' : 'off')}">
          <${Badge} />
        </div>`
    );
    const div = root.querySelector('div')!;
    expect(div.className).toBe('box on');
    on.value = false;
    settle();
    expect(div.className).toBe('box off');
    expect(div.textContent).toBe('badge');
  });
});

describe('SVG elements with HTML names', () => {
  const SVG = 'http://www.w3.org/2000/svg';
  const HTML = 'http://www.w3.org/1999/xhtml';

  it('are created in the SVG namespace inside an svg', () => {
    const svg = first(
      html`<svg>
        <title>tip</title>
        <a href="/x"><text>t</text></a>
      </svg>`
    );
    expect(svg.querySelector('title')!.namespaceURI).toBe(SVG);
    expect(svg.querySelector('a')!.namespaceURI).toBe(SVG);
  });

  it('are in the SVG namespace in a template that holds a component', () => {
    class Icon extends Component {
      protected render(): RenderResult {
        return html`<i>icon</i>`;
      }
    }
    const { root } = mount(
      () =>
        html`<div>
          <svg><title>tip</title></svg><${Icon} />
        </div>`
    );
    expect(root.querySelector('title')!.namespaceURI).toBe(SVG);
  });

  it('stay HTML inside a foreignObject', () => {
    const svg = first(
      html`<svg>
        <foreignObject><a href="/x">link</a></foreignObject>
      </svg>`
    );
    expect(svg.querySelector('a')!.namespaceURI).toBe(HTML);
  });
});
