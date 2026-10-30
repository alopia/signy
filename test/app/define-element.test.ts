/**
 * Tests for defineElement
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineElement } from '../../src/app/define-element';
import { Component } from '../../src/component/component';
import { Signal } from '../../src/reactivity';
import { html } from '../../src/views/html';
import { microtask, settle } from '../support/tick';
import type { RenderResult } from '../../src/types';

let counter = 0;
const nextTag = (): string => `x-test-${++counter}`;

type LabelProps = {
  label?: string;
  count?: number;
  open?: boolean;
  maxItems?: number;
};

const show = (value: unknown): string =>
  value === undefined ? '' : String(value);

class Label extends Component<LabelProps> {
  protected render(): RenderResult {
    return html`<p>
      ${() => show(this.props.label)}|${() => show(this.props.count)}|${() => show(this.props.open)}|${() => show(this.props.maxItems)}
    </p>`;
  }
}

const text = (el: Element): string => el.textContent!.replace(/\s/g, '');

afterEach(async () => {
  document.body.innerHTML = '';
  await microtask();
});

function create(tag: string, attrs: Record<string, string> = {}): HTMLElement {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs))
    el.setAttribute(name, value);
  document.body.appendChild(el);
  settle();
  return el;
}

describe('defineElement', () => {
  it('mounts the component when the element is connected', () => {
    const tag = nextTag();
    defineElement(tag, Label);
    const el = create(tag);
    expect(el.querySelector('p')).not.toBeNull();
  });

  it('returns the element class that was registered', () => {
    const tag = nextTag();
    const Element = defineElement(tag, Label);
    expect(customElements.get(tag)).toBe(Element);
    expect(document.createElement(tag)).toBeInstanceOf(Element);
  });

  it('turns attributes into props by type', () => {
    const tag = nextTag();
    defineElement(tag, Label, {
      props: { label: String, count: Number, open: Boolean, maxItems: Number },
    });
    const el = create(tag, {
      label: 'Hi',
      count: '3',
      open: '',
      'max-items': '9',
    });
    expect(text(el)).toBe('Hi|3|true|9');
  });

  it('treats a bare name as a string prop', () => {
    const tag = nextTag();
    defineElement(tag, Label, { props: ['label'] });
    const el = create(tag, { label: 'Hi' });
    expect(text(el)).toBe('Hi|||');
  });

  it('gives false for a missing boolean and undefined for a missing string', () => {
    const tag = nextTag();
    defineElement(tag, Label, { props: { label: String, open: Boolean } });
    const el = create(tag);
    expect(text(el)).toBe('||false|');
  });

  it('follows attribute changes', () => {
    const tag = nextTag();
    defineElement(tag, Label, { props: { label: String, open: Boolean } });
    const el = create(tag, { label: 'a' });
    el.setAttribute('label', 'b');
    el.setAttribute('open', '');
    settle();
    expect(text(el)).toBe('b||true|');
    el.removeAttribute('open');
    settle();
    expect(text(el)).toBe('b||false|');
  });

  it('reads and writes props as properties', () => {
    const tag = nextTag();
    defineElement(tag, Label, { props: ['label'] });
    const el = create(tag) as HTMLElement & { label?: string };
    el.label = 'from property';
    settle();
    expect(text(el)).toBe('fromproperty|||');
    expect(el.label).toBe('from property');
  });

  it('keeps a property set before the element was defined', () => {
    const tag = nextTag();
    const early = document.createElement(tag) as HTMLElement & {
      label?: string;
    };
    early.label = 'early';
    defineElement(tag, Label, { props: ['label'] });
    document.body.appendChild(early);
    settle();
    expect(text(early)).toBe('early|||');
  });

  it('unmounts when the element is removed', async () => {
    const unmounted = vi.fn();
    class Probe extends Component {
      protected setup(): void {
        this.onUnmount(unmounted);
      }
      protected render(): RenderResult {
        return html`<i>probe</i>`;
      }
    }
    const tag = nextTag();
    defineElement(tag, Probe);
    const el = create(tag);
    el.remove();
    expect(unmounted).not.toHaveBeenCalled();
    await microtask();
    expect(unmounted).toHaveBeenCalledOnce();
  });

  it('stays mounted when the element is moved in the same task', async () => {
    const mounted = vi.fn();
    const unmounted = vi.fn();
    class Probe extends Component {
      protected setup(): void {
        mounted();
        this.onUnmount(unmounted);
      }
      protected render(): RenderResult {
        return html`<i>probe</i>`;
      }
    }
    const tag = nextTag();
    defineElement(tag, Probe);
    const el = create(tag);
    const other = document.createElement('div');
    document.body.appendChild(other);
    other.appendChild(el);
    await microtask();
    expect(mounted).toHaveBeenCalledOnce();
    expect(unmounted).not.toHaveBeenCalled();
    expect(el.querySelector('i')).not.toBeNull();
  });

  it('mounts a fresh component when an unmounted element comes back', async () => {
    const mounted = vi.fn();
    class Probe extends Component {
      protected setup(): void {
        mounted();
      }
      protected render(): RenderResult {
        return html`<i>probe</i>`;
      }
    }
    const tag = nextTag();
    defineElement(tag, Probe);
    const el = create(tag);
    el.remove();
    await microtask();
    document.body.appendChild(el);
    settle();
    expect(mounted).toHaveBeenCalledTimes(2);
  });

  it('keeps the children the element came with when it is removed (light DOM)', async () => {
    class Plain extends Component {
      protected render(): RenderResult {
        return html`<i>x</i>`;
      }
    }
    const tag = nextTag();
    defineElement(tag, Plain);
    const el = document.createElement(tag);
    el.innerHTML = '<b>mine</b>';
    document.body.appendChild(el);
    settle();
    expect(el.innerHTML).toBe('<b>mine</b><i>x</i>');
    el.remove();
    await microtask();
    expect(el.innerHTML).toBe('<b>mine</b>');
  });

  it('keeps slotted children when a shadow root element is removed and added back', async () => {
    class Shadowed extends Component {
      protected shadow = true;
      protected render(): RenderResult {
        return html`<slot></slot>`;
      }
    }
    const tag = nextTag();
    defineElement(tag, Shadowed);
    const el = document.createElement(tag);
    el.textContent = 'New';
    document.body.appendChild(el);
    settle();
    el.remove();
    await microtask();
    document.body.appendChild(el);
    settle();
    expect(el.textContent).toBe('New');
    expect(el.shadowRoot!.querySelector('slot')).not.toBeNull();
  });

  it('adds the component output again, once, when a light DOM element comes back', async () => {
    class Plain extends Component {
      protected render(): RenderResult {
        return html`<i>x</i>`;
      }
    }
    const tag = nextTag();
    defineElement(tag, Plain);
    const el = document.createElement(tag);
    el.innerHTML = '<b>mine</b>';
    document.body.appendChild(el);
    settle();
    el.remove();
    await microtask();
    document.body.appendChild(el);
    settle();
    expect(el.innerHTML).toBe('<b>mine</b><i>x</i>');
  });

  describe('when the first mount throws', () => {
    const connectFailing = (el: HTMLElement) => {
      const onError = (e: ErrorEvent) => e.preventDefault();
      window.addEventListener('error', onError);
      try {
        document.body.appendChild(el);
      } finally {
        window.removeEventListener('error', onError);
      }
    };

    it('logs nothing when the element is removed, and mounts again when it comes back', async () => {
      let attempts = 0;
      class Flaky extends Component {
        protected setup(): void {
          if (attempts++ === 0) throw new Error('first mount fails');
        }
        protected render(): RenderResult {
          return html`<p>ok</p>`;
        }
      }
      const tag = nextTag();
      defineElement(tag, Flaky);
      const el = document.createElement(tag);
      connectFailing(el);
      expect(el.querySelector('p')).toBeNull();
      el.remove();
      // No app:not-mounted warning: the test setup fails on any unclaimed log
      await microtask();
      document.body.appendChild(el);
      settle();
      expect(attempts).toBe(2);
      expect(el.querySelector('p')?.textContent).toBe('ok');
    });

    it('lets setup throw too without keeping an app', async () => {
      let calls = 0;
      class Plain extends Component {
        protected render(): RenderResult {
          return html`<p>ok</p>`;
        }
      }
      const tag = nextTag();
      defineElement(tag, Plain, {
        setup: () => {
          if (calls++ === 0) throw new Error('setup fails');
        },
      });
      const el = document.createElement(tag);
      connectFailing(el);
      el.remove();
      await microtask();
      document.body.appendChild(el);
      settle();
      expect(el.querySelector('p')?.textContent).toBe('ok');
    });
  });

  it('renders into a shadow root when the component has one', () => {
    class Shadowed extends Component {
      protected shadow = true;
      protected render(): RenderResult {
        return html`<p>inside</p>`;
      }
    }
    const tag = nextTag();
    defineElement(tag, Shadowed);
    const el = create(tag);
    expect(el.shadowRoot!.querySelector('p')!.textContent).toBe('inside');
  });

  it('fires emit() events on the element', () => {
    class Talker extends Component {
      protected setup(): void {
        this.onMount(() => {
          this.emit('ready', { ok: true });
        });
      }
      protected render(): RenderResult {
        return html`<i>talk</i>`;
      }
    }
    const tag = nextTag();
    defineElement(tag, Talker);
    const heard = vi.fn();
    const el = document.createElement(tag);
    el.addEventListener('ready', (event) =>
      heard((event as CustomEvent).detail)
    );
    document.body.appendChild(el);
    settle();
    expect(heard).toHaveBeenCalledWith({ ok: true });
  });

  it('lets setup install plugins on each element app', () => {
    const tag = nextTag();
    const setup = vi.fn();
    defineElement(tag, Label, { setup });
    const el = create(tag);
    expect(setup).toHaveBeenCalledOnce();
    expect(setup.mock.calls[0]![1]).toBe(el);
  });

  it('keeps instances apart', () => {
    const tag = nextTag();
    defineElement(tag, Label, { props: ['label'] });
    const a = create(tag, { label: 'a' });
    const b = create(tag, { label: 'b' });
    a.setAttribute('label', 'c');
    settle();
    expect(text(a)).toBe('c|||');
    expect(text(b)).toBe('b|||');
  });

  it.each([
    'title',
    'id',
    'hidden',
    'lang',
    'style',
    'children',
    'className',
    'click',
  ])('throws for a prop named like the native property %s', (prop) => {
    const tag = nextTag();
    expect(() => defineElement(tag, Label, { props: [prop] })).toThrow(
      'app:element-reserved-prop'
    );
    // Nothing was registered
    expect(customElements.get(tag)).toBeUndefined();
  });

  it('throws for such a name given with a type', () => {
    expect(() =>
      defineElement(nextTag(), Label, { props: { title: String } })
    ).toThrow('app:element-reserved-prop');
  });

  it('takes names that no element has', () => {
    const tag = nextTag();
    expect(() =>
      defineElement(tag, Label, {
        props: {
          label: String,
          count: Number,
          open: Boolean,
          maxItems: Number,
        },
      })
    ).not.toThrow();
  });

  it('throws when the tag is not a valid custom element name', () => {
    expect(() => defineElement('nohyphen', Label)).toThrow();
  });

  it('throws when the tag is already defined', () => {
    const tag = nextTag();
    defineElement(tag, Label);
    expect(() => defineElement(tag, Label)).toThrow();
  });

  it('is safe to import where there is no document', () => {
    const count = new Signal(0);
    expect(count.value).toBe(0);
    expect(typeof defineElement).toBe('function');
  });
});
