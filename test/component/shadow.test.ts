/**
 * Shadow DOM Support Tests
 *
 * Tests for Shadow DOM functionality in Signy components.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  // Helper functions
  isShadowOptions,
  isShadowEnabled,
  normalizeShadowOptions,
  mergeShadowOptions,
  normalizeStyles,
  mergeStyles,
  createComposedEvent,
  createShadowRootInit,
  attachShadow,
  hasShadowRoot,
  getShadowRoot,
  applyStyles,
  getSlottedElements,
  getSlottedNodes,
  hasSlottedContent,
  onSlotChange,
  emit,
  isSSR,
  shouldUseShadowDOM,
  generateDeclarativeShadowDOM,
  DEFAULT_SHADOW_OPTIONS,
  SHADOW_DOM_SUPPORTED,
  CONSTRUCTABLE_STYLESHEETS_SUPPORTED,
} from '../../src/component/shadow';
import type { ShadowOptions, RenderResult } from '../../src/types';
import { Component } from '../../src/component/component';
import { html } from '../../src/views/html';
import { Signal } from '../../src/reactivity';
import { mount } from '../support/mount';
import { application } from '../../src/app/application';
import { settle } from '../support/tick';

describe('Shadow DOM Support', () => {
  //=============================================
  // Type Guards
  //=============================================

  describe('isShadowOptions', () => {
    it('returns true for object with valid properties', () => {
      expect(isShadowOptions({ mode: 'open' })).toBe(true);
      expect(isShadowOptions({ delegatesFocus: true })).toBe(true);
      expect(isShadowOptions({})).toBe(true);
    });

    it('returns false for non-objects', () => {
      expect(isShadowOptions(true)).toBe(false);
      expect(isShadowOptions(false)).toBe(false);
      expect(isShadowOptions(null)).toBe(false);
      expect(isShadowOptions(undefined)).toBe(false);
      expect(isShadowOptions('open')).toBe(false);
      expect(isShadowOptions(123)).toBe(false);
    });

    it('returns false for arrays', () => {
      expect(isShadowOptions([])).toBe(false);
      expect(isShadowOptions([{ mode: 'open' }])).toBe(false);
    });
  });

  describe('isShadowEnabled', () => {
    it('returns true for boolean true', () => {
      expect(isShadowEnabled(true)).toBe(true);
    });

    it('returns true for options object', () => {
      expect(isShadowEnabled({ mode: 'open' })).toBe(true);
      expect(isShadowEnabled({})).toBe(true);
    });

    it('returns false for boolean false', () => {
      expect(isShadowEnabled(false)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isShadowEnabled(undefined)).toBe(false);
    });
  });

  //=============================================
  // Normalization Functions
  //=============================================

  describe('normalizeShadowOptions', () => {
    it('returns null for disabled shadow', () => {
      expect(normalizeShadowOptions(false)).toBe(null);
      expect(normalizeShadowOptions(undefined)).toBe(null);
    });

    it('returns default options for true', () => {
      const result = normalizeShadowOptions(true);
      expect(result).toEqual({
        mode: 'open',
        delegatesFocus: false,
        slotAssignment: 'named',
      });
    });

    it('returns default options for empty object', () => {
      const result = normalizeShadowOptions({});
      expect(result).toEqual({
        mode: 'open',
        delegatesFocus: false,
        slotAssignment: 'named',
      });
    });

    it('merges partial options with defaults', () => {
      const result = normalizeShadowOptions({ mode: 'closed' });
      expect(result).toEqual({
        mode: 'closed',
        delegatesFocus: false,
        slotAssignment: 'named',
      });
    });

    it('preserves all provided options', () => {
      const options: ShadowOptions = {
        mode: 'closed',
        delegatesFocus: true,
        ssr: 'declarative',
        slotAssignment: 'manual',
      };
      const result = normalizeShadowOptions(options);
      expect(result).toEqual({
        mode: 'closed',
        delegatesFocus: true,
        ssr: 'declarative',
        slotAssignment: 'manual',
      });
    });
  });

  describe('mergeShadowOptions', () => {
    it('uses constructor option when provided', () => {
      const result = mergeShadowOptions(true, { mode: 'closed' });
      expect(result?.mode).toBe('closed');
    });

    it('uses class option when constructor is undefined', () => {
      const result = mergeShadowOptions({ mode: 'closed' }, undefined);
      expect(result?.mode).toBe('closed');
    });

    it('constructor false overrides class true', () => {
      const result = mergeShadowOptions(true, false);
      expect(result).toBe(null);
    });

    it('returns null when both undefined', () => {
      const result = mergeShadowOptions(undefined, undefined);
      expect(result).toBe(null);
    });

    it('constructor true uses defaults', () => {
      const result = mergeShadowOptions(undefined, true);
      expect(result).toEqual({
        mode: 'open',
        delegatesFocus: false,
        slotAssignment: 'named',
      });
    });
  });

  //=============================================
  // Style Functions
  //=============================================

  describe('normalizeStyles', () => {
    it('returns empty arrays for undefined', () => {
      const result = normalizeStyles(undefined);
      expect(result).toEqual({ strings: [], sheets: [] });
    });

    it('wraps string in array', () => {
      const result = normalizeStyles(':host { display: block; }');
      expect(result.strings).toEqual([':host { display: block; }']);
      expect(result.sheets).toEqual([]);
    });

    it('passes through string array', () => {
      const styles = [
        ':host { display: block; }',
        '.content { padding: 16px; }',
      ];
      const result = normalizeStyles(styles);
      expect(result.strings).toEqual(styles);
      expect(result.sheets).toEqual([]);
    });

    it('separates CSSStyleSheets from strings', () => {
      // Skip if Constructable Stylesheets not supported
      if (!CONSTRUCTABLE_STYLESHEETS_SUPPORTED) {
        return;
      }

      const sheet = new CSSStyleSheet();
      const styles = [':host { display: block; }', sheet];
      const result = normalizeStyles(styles);
      expect(result.strings).toEqual([':host { display: block; }']);
      expect(result.sheets).toEqual([sheet]);
    });
  });

  describe('mergeStyles', () => {
    it('returns empty array for no sources', () => {
      const result = mergeStyles();
      expect(result).toEqual([]);
    });

    it('handles string source', () => {
      const result = mergeStyles(':host { display: block; }');
      expect(result).toEqual([':host { display: block; }']);
    });

    it('handles array source', () => {
      const result = mergeStyles([':host { display: block; }', '.a { }']);
      expect(result).toEqual([':host { display: block; }', '.a { }']);
    });

    it('merges multiple sources', () => {
      const result = mergeStyles(
        ':host { display: block; }',
        ['.a { }', '.b { }'],
        '.c { }'
      );
      expect(result).toEqual([
        ':host { display: block; }',
        '.a { }',
        '.b { }',
        '.c { }',
      ]);
    });

    it('skips undefined sources', () => {
      const result = mergeStyles(undefined, ':host { }', undefined, '.a { }');
      expect(result).toEqual([':host { }', '.a { }']);
    });
  });

  //=============================================
  // Event Functions
  //=============================================

  describe('createComposedEvent', () => {
    it('creates event with composed: true', () => {
      const event = createComposedEvent('test-event');
      expect(event.composed).toBe(true);
    });

    it('sets bubbles to true by default', () => {
      const event = createComposedEvent('test-event');
      expect(event.bubbles).toBe(true);
    });

    it('sets cancelable to false by default', () => {
      const event = createComposedEvent('test-event');
      expect(event.cancelable).toBe(false);
    });

    it('includes detail data', () => {
      const event = createComposedEvent('test-event', {
        detail: { value: 42 },
      });
      expect(event.detail).toEqual({ value: 42 });
    });

    it('respects custom options', () => {
      const event = createComposedEvent('test-event', {
        detail: { foo: 'bar' },
        bubbles: false,
        cancelable: true,
      });
      expect(event.detail).toEqual({ foo: 'bar' });
      expect(event.bubbles).toBe(false);
      expect(event.cancelable).toBe(true);
      expect(event.composed).toBe(true); // Always true
    });
  });

  //=============================================
  // Constants
  //=============================================

  describe('Constants', () => {
    it('DEFAULT_SHADOW_OPTIONS has expected values', () => {
      expect(DEFAULT_SHADOW_OPTIONS).toEqual({
        mode: 'open',
        delegatesFocus: false,
        slotAssignment: 'named',
      });
    });

    it('SHADOW_DOM_SUPPORTED is boolean', () => {
      expect(typeof SHADOW_DOM_SUPPORTED).toBe('boolean');
    });

    it('CONSTRUCTABLE_STYLESHEETS_SUPPORTED is boolean', () => {
      expect(typeof CONSTRUCTABLE_STYLESHEETS_SUPPORTED).toBe('boolean');
    });
  });
});

//=============================================
// Component Integration Tests
//=============================================

describe('Shadow DOM helpers', () => {
  const host = () => document.body.appendChild(document.createElement('div'));

  it('attaches a shadow root with the given options', () => {
    const el = host();
    const root = attachShadow(el, {
      ...DEFAULT_SHADOW_OPTIONS,
      mode: 'closed',
    });
    expect(root).toBeInstanceOf(ShadowRoot);
    expect(root.mode).toBe('closed');
    expect(el.shadowRoot).toBeNull();
  });

  it('reports and returns an open shadow root', () => {
    const el = host();
    expect(hasShadowRoot(el)).toBe(false);
    const root = attachShadow(el);
    expect(hasShadowRoot(el)).toBe(true);
    expect(getShadowRoot(el)).toBe(root);
  });

  it('builds ShadowRootInit from options', () => {
    expect(
      createShadowRootInit({ ...DEFAULT_SHADOW_OPTIONS, delegatesFocus: true })
    ).toEqual({
      mode: DEFAULT_SHADOW_OPTIONS.mode,
      delegatesFocus: true,
      slotAssignment: DEFAULT_SHADOW_OPTIONS.slotAssignment,
    });
  });

  it('applies string styles to the shadow root', () => {
    const root = attachShadow(host());
    applyStyles(root, ['p { color: red; }', 'b { color: blue; }']);

    const css = CONSTRUCTABLE_STYLESHEETS_SUPPORTED
      ? root.adoptedStyleSheets.flatMap((sheet) =>
          Array.from(sheet.cssRules).map((rule) => rule.cssText)
        )
      : Array.from(root.querySelectorAll('style')).map((s) => s.textContent);
    expect(css.join(' ')).toContain('color: red');
    expect(css.join(' ')).toContain('color: blue');
  });

  it.runIf(CONSTRUCTABLE_STYLESHEETS_SUPPORTED)(
    'shares one parsed sheet between roots with the same CSS',
    () => {
      const a = attachShadow(host());
      const b = attachShadow(host());
      applyStyles(a, 'i { color: green; }');
      applyStyles(b, 'i { color: green; }');
      expect(b.adoptedStyleSheets[0]).toBe(a.adoptedStyleSheets[0]);
    }
  );

  it('does nothing for undefined styles', () => {
    const root = attachShadow(host());
    applyStyles(root, undefined);
    expect(root.childNodes).toHaveLength(0);
  });

  describe('slots', () => {
    function slotted() {
      const el = host();
      el.innerHTML = '<b slot="title">T</b><i>body</i>text';
      const root = attachShadow(el);
      root.innerHTML =
        '<slot name="title"></slot><slot></slot><slot name="empty"></slot>';
      return root;
    }

    it('returns assigned elements by slot name', () => {
      const root = slotted();
      expect(getSlottedElements(root, 'title').map((e) => e.tagName)).toEqual([
        'B',
      ]);
      expect(getSlottedElements(root).map((e) => e.tagName)).toEqual(['I']);
    });

    it('returns assigned nodes, including text', () => {
      const root = slotted();
      expect(getSlottedNodes(root).map((n) => n.textContent)).toEqual([
        'body',
        'text',
      ]);
    });

    it('reports whether a slot has content', () => {
      const root = slotted();
      expect(hasSlottedContent(root, 'title')).toBe(true);
      expect(hasSlottedContent(root, 'empty')).toBe(false);
    });

    it('counts text as content, but not whitespace alone', () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root = attachShadow(host);
      root.innerHTML = '<slot></slot>';
      host.textContent = 'Save';
      expect(hasSlottedContent(root)).toBe(true);
      host.textContent = '\n  ';
      expect(hasSlottedContent(root)).toBe(false);
      host.remove();
    });

    it('returns empty results for a missing slot', () => {
      const root = slotted();
      expect(getSlottedElements(root, 'nope')).toEqual([]);
      expect(getSlottedNodes(root, 'nope')).toEqual([]);
      expect(onSlotChange(root, 'nope', () => {})).toBeTypeOf('function');
    });

    it('calls back on slotchange until unsubscribed', () => {
      const root = slotted();
      const callback = vi.fn();
      const off = onSlotChange(root, 'title', callback);
      const slot = root.querySelector('slot[name="title"]')!;

      slot.dispatchEvent(new Event('slotchange'));
      expect(callback).toHaveBeenCalledWith(getSlottedElements(root, 'title'));

      off();
      slot.dispatchEvent(new Event('slotchange'));
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  it('emits composed events that cross the shadow boundary', () => {
    const el = host();
    const root = attachShadow(el);
    const inner = root.appendChild(document.createElement('button'));
    const received = vi.fn();
    document.body.addEventListener('picked', (e) =>
      received((e as CustomEvent).detail)
    );

    expect(emit(inner, 'picked', { id: 1 })).toBe(true);
    expect(received).toHaveBeenCalledWith({ id: 1 });
  });

  it('detects the browser environment', () => {
    expect(isSSR()).toBe(false);
    expect(shouldUseShadowDOM(null)).toBe(false);
    expect(shouldUseShadowDOM(DEFAULT_SHADOW_OPTIONS)).toBe(
      SHADOW_DOM_SUPPORTED
    );
  });

  it('generates declarative Shadow DOM markup', () => {
    const out = generateDeclarativeShadowDOM(
      { ...DEFAULT_SHADOW_OPTIONS, mode: 'open', delegatesFocus: true },
      '<p>hi</p>',
      'p { margin: 0; }'
    );
    expect(out).toBe(
      '<template shadowrootmode="open" shadowrootdelegatesfocus><style>p { margin: 0; }</style><p>hi</p></template>'
    );
  });
});

describe('Component Shadow DOM Integration', () => {
  it('should detect Shadow DOM support in jsdom', () => {
    expect(SHADOW_DOM_SUPPORTED).toBe(true);
  });

  it('renders a root component into its shadow root', () => {
    class Widget extends Component {
      protected shadow = true;
      protected styles = ':host { display: block; }';
      protected render(): RenderResult {
        return html`<p class="inside">shadow</p>`;
      }
    }

    const { root } = mount(Widget);
    expect(root.shadowRoot).not.toBeNull();
    expect(root.shadowRoot!.querySelector('.inside')?.textContent).toBe(
      'shadow'
    );
    expect(root.querySelector('.inside')).toBeNull();
  });

  it('renders a child component inside a named host element', () => {
    class FancyCard extends Component {
      protected shadow = true;
      protected render(): RenderResult {
        return html`<div class="card"><slot></slot></div>`;
      }
    }

    const { root } = mount(
      () => html`<section><${FancyCard}><p>slotted</p></${FancyCard}></section>`
    );
    const hostEl = root.querySelector('signy-fancy-card');
    expect(hostEl).not.toBeNull();
    expect(hostEl!.shadowRoot!.querySelector('.card')).not.toBeNull();
  });

  it('replaces the style elements of its template on update()', () => {
    let widget!: Widget;
    class Widget extends Component {
      protected shadow = true;
      protected styles = ':host { display: block; }';
      protected setup(): void {
        widget = this;
      }
      protected render(): RenderResult {
        return html`<style>
            p {
              color: red;
            }
          </style>
          <p>x</p>`;
      }
    }

    const { root } = mount(Widget);
    const styles = () =>
      Array.from(root.shadowRoot!.querySelectorAll('style')).map(
        (style) => style.textContent
      );
    const before = styles();
    widget.update();
    widget.update();
    expect(styles()).toEqual(before);
    expect(styles().filter((css) => css?.includes('color: red'))).toHaveLength(
      1
    );
  });

  it('keeps live bindings working inside the shadow root', () => {
    const count = new Signal(1);
    class Counter extends Component {
      protected shadow = true;
      protected render(): RenderResult {
        return html`<span>${() => count.value}</span>`;
      }
    }

    const { root } = mount(Counter);
    count.value = 2;
    settle();
    expect(root.shadowRoot!.textContent).toBe('2');
  });

  it('empties the shadow root on unmount', () => {
    class Widget extends Component {
      protected shadow = true;
      protected render(): RenderResult {
        return html`<p>x</p>`;
      }
    }

    const { root, unmount } = mount(Widget);
    const shadowRoot = root.shadowRoot!;
    unmount();
    expect(shadowRoot.childNodes).toHaveLength(0);
  });

  it('can be turned off per instance with shadow: false', () => {
    class Widget extends Component {
      protected shadow = true;
      protected render(): RenderResult {
        return html`<p class="light">x</p>`;
      }
    }

    const { root } = mount(
      () => html`<div>${new Widget({}, { shadow: false })}</div>`
    );
    expect(root.querySelector('.light')).not.toBeNull();
    expect(root.querySelector('signy-widget')).toBeNull();
  });

  it('mounts again into the same container after an unmount', () => {
    class Widget extends Component {
      protected shadow = true;
      protected render(): RenderResult {
        return html`<p>x</p>`;
      }
    }
    const container = document.body.appendChild(document.createElement('div'));
    application(Widget).mount(container).unmount();
    const app = application(Widget).mount(container);
    expect(container.shadowRoot!.querySelector('p')!.textContent).toBe('x');
    app.unmount();
  });

  it('reports a host that cannot have a shadow root', () => {
    expect(() => attachShadow(document.createElement('ul'))).toThrow(
      'component:shadow-dom-attach-failed'
    );
  });

  it.each([
    ['_Foo$1', 'signy-foo-1'],
    ['My Widget', 'signy-my-widget'],
    ['$', 'signy-component'],
  ])('renders a host for the display name %j', (name, tag) => {
    class Widget extends Component {
      static displayName = name;
      protected shadow = true;
      protected render(): RenderResult {
        return html`<p>x</p>`;
      }
    }
    const { root } = mount(() => html`<div><${Widget} /></div>`);
    expect(root.querySelector(tag)?.shadowRoot).toBeTruthy();
  });

  it('escapes CSS that would end the declarative style element', () => {
    const markup = generateDeclarativeShadowDOM(
      DEFAULT_SHADOW_OPTIONS,
      '<slot></slot>',
      'p {}</style><img src=x onerror=alert(1)>'
    );
    const template = document.createElement('template');
    template.innerHTML = markup;
    expect(template.content.querySelector('img')).toBeNull();
  });

  it('finds a slot whose name has a quote', () => {
    const el = document.body.appendChild(document.createElement('div'));
    el.innerHTML = "<b slot='a\"b'>T</b>";
    const root = attachShadow(el);
    root.innerHTML = "<slot name='a\"b'></slot>";
    expect(getSlottedElements(root, 'a"b')).toHaveLength(1);
    el.remove();
  });

  it('keeps own __proto__ keys from options.setup() off the prototype', () => {
    class Widget extends Component {
      protected render(): RenderResult {
        return html`<p>x</p>`;
      }
    }
    const widget = new Widget(
      {},
      { setup: () => JSON.parse('{"__proto__":{"render":null},"extra":1}') }
    );
    mount(() => html`<div>${widget}</div>`);
    expect(Object.getPrototypeOf(widget)).toBe(Widget.prototype);
    expect((widget as unknown as { extra: number }).extra).toBe(1);
  });
});

describe('onSlotChange() before the component rendered', () => {
  const slotchange = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('listens once the slot is there, when called in setup()', async () => {
    const counts: number[] = [];
    class Box extends Component {
      protected shadow = true;
      protected setup(): void {
        this.onSlotChange(undefined, (elements) =>
          counts.push(elements.length)
        );
      }
      protected render(): RenderResult {
        return html`<div><slot></slot></div>`;
      }
    }
    const { root, unmount } = mount(() => html`<div><${Box} /></div>`);
    const host = root.querySelector('signy-box')!;
    host.appendChild(document.createElement('span'));
    await slotchange();
    expect(counts).toEqual([1]);

    unmount();
    host.appendChild(document.createElement('span'));
    await slotchange();
    expect(counts).toEqual([1]);
  });

  it('does not listen when stopped before the render', async () => {
    const counts: number[] = [];
    class Box extends Component {
      protected shadow = true;
      protected setup(): void {
        const stop = this.onSlotChange(undefined, (elements) =>
          counts.push(elements.length)
        );
        stop();
      }
      protected render(): RenderResult {
        return html`<div><slot></slot></div>`;
      }
    }
    const { root } = mount(() => html`<div><${Box} /></div>`);
    root.querySelector('signy-box')!.appendChild(document.createElement('i'));
    await slotchange();
    expect(counts).toEqual([]);
  });
});

describe('event props of a shadow component in html', () => {
  it('hear emit() and leave standard events to the component', () => {
    let clicks = 0;
    const heard: number[] = [];
    let rating!: Rating;
    class Rating extends Component<{ onClick?: () => void }> {
      protected shadow = true;
      protected setup(): void {
        rating = this;
      }
      rate(): void {
        this.emit('rate', 4);
      }
      protected render(): RenderResult {
        return html`<button onClick=${() => this.props.onClick?.()}>
          go
        </button>`;
      }
    }
    const { root } = mount(
      () =>
        html`<div>
          <${Rating}
            onClick=${() => clicks++}
            onRate=${(event: CustomEvent<number>) => heard.push(event.detail)}
          />
        </div>`
    );
    root
      .querySelector('signy-rating')!
      .shadowRoot!.querySelector('button')!
      .click();
    rating.rate();
    expect(clicks).toBe(1);
    expect(heard).toEqual([4]);
  });
});
