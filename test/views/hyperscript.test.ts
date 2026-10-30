/**
 * Tests for hyperscript h() function
 */

import { describe, it, expect } from 'vitest';
import { h, Fragment } from '../../src/views/hyperscript';
import { createRef, type Ref } from '../../src/dom/ref';
import { Component } from '../../src/component/component';
import { Signal } from '../../src/reactivity';
import { settle } from '../support/tick';
import { appendChildren } from '../../src/views/append';
import { mount } from '../support/mount';
import type { RenderResult } from '../../src/types';

describe('h() - hyperscript function', () => {
  describe('SVG', () => {
    const SVG = 'http://www.w3.org/2000/svg';

    it('creates SVG elements in the SVG namespace', () => {
      const circle = h('circle', { cx: '5', cy: '5', r: '4' }) as Element;
      const svg = h('svg', { viewBox: '0 0 10 10' }, circle) as Element;
      expect(svg.namespaceURI).toBe(SVG);
      expect(circle.namespaceURI).toBe(SVG);
      expect(svg.getAttribute('viewBox')).toBe('0 0 10 10');
    });

    it('keeps HTML elements in the HTML namespace', () => {
      expect((h('div', null) as Element).namespaceURI).toBe(
        'http://www.w3.org/1999/xhtml'
      );
      expect((h('a', null) as Element).namespaceURI).toBe(
        'http://www.w3.org/1999/xhtml'
      );
    });

    it('puts any element in the namespace of an xmlns attribute', () => {
      const link = h('a', { xmlns: SVG, href: '/x' }) as Element;
      expect(link.namespaceURI).toBe(SVG);
      expect(link.getAttribute('href')).toBe('/x');
      expect(link.hasAttribute('xmlns')).toBe(false);
    });

    it('binds attributes and classes on SVG elements', () => {
      const cx = new Signal(5);
      const circle = h('circle', {
        cx: () => cx.value,
        class: 'dot',
      }) as Element;
      expect(circle.getAttribute('class')).toBe('dot');
      expect(circle.getAttribute('cx')).toBe('5');
      cx.value = 7;
      settle();
      expect(circle.getAttribute('cx')).toBe('7');
    });
  });

  describe('ref attribute handling', () => {
    it('should populate ref object with element reference', () => {
      const inputRef: Ref<HTMLInputElement> = createRef<HTMLInputElement>();
      expect(inputRef.current).toBeNull();

      const element = h('input', {
        ref: inputRef,
        type: 'text',
      }) as HTMLInputElement;

      expect(inputRef.current).toBe(element);
      expect(element.tagName).toBe('INPUT');
      expect(element.type).toBe('text');
    });

    it('should call ref callback with element', () => {
      let capturedElement: HTMLElement | null = null;
      const refCallback = (el: HTMLElement) => {
        capturedElement = el;
      };

      const element = h('div', {
        ref: refCallback,
        class: 'test',
      }) as HTMLDivElement;

      expect(capturedElement).toBe(element);
      expect(element.className).toBe('test');
    });

    it('should handle ref object with nested elements', () => {
      const buttonRef: Ref<HTMLButtonElement> = createRef<HTMLButtonElement>();

      // Create container to trigger ref assignment on nested button
      h('div', null, h('button', { ref: buttonRef }, 'Click me'));

      expect(buttonRef.current).not.toBeNull();
      expect(buttonRef.current?.tagName).toBe('BUTTON');
      expect(buttonRef.current?.textContent).toBe('Click me');
    });

    it('should allow access to element methods via ref', () => {
      const inputRef: Ref<HTMLInputElement> = createRef<HTMLInputElement>();

      const element = h('input', {
        ref: inputRef,
        type: 'text',
        value: 'test value',
      }) as HTMLInputElement;

      // Append to document so focus/select can work
      document.body.appendChild(element);

      expect(inputRef.current).toBe(element);
      expect(inputRef.current?.value).toBe('test value');

      // Test methods are accessible
      inputRef.current?.focus();
      inputRef.current?.select();
      inputRef.current!.value = 'new value';
      expect(inputRef.current?.value).toBe('new value');

      // Cleanup
      document.body.removeChild(element);
    });

    it('should ignore null or undefined ref values', () => {
      // Should not throw
      const element1 = h('div', { ref: null }) as HTMLDivElement;
      const element2 = h('div', { ref: undefined }) as HTMLDivElement;

      expect(element1.tagName).toBe('DIV');
      expect(element2.tagName).toBe('DIV');
    });
  });

  describe('basic element creation', () => {
    it('should create a simple element', () => {
      const element = h('div', null) as HTMLDivElement;
      expect(element.tagName).toBe('DIV');
    });

    it('should set string attributes', () => {
      const element = h('div', {
        id: 'test',
        class: 'container',
      }) as HTMLDivElement;
      expect(element.id).toBe('test');
      expect(element.className).toBe('container');
    });

    it('should add text children', () => {
      const element = h('p', null, 'Hello World') as HTMLParagraphElement;
      expect(element.textContent).toBe('Hello World');
    });
  });

  describe('Fragment', () => {
    it('should create a document fragment', () => {
      const fragment = Fragment(null, 'Hello', ' ', 'World');
      expect(fragment instanceof DocumentFragment).toBe(true);
      expect(fragment.textContent).toBe('Hello World');
    });
  });
});

describe('h() - elements and children', () => {
  it('maps className to class, statically and live', () => {
    const cls = new Signal('a');
    const staticEl = h('div', { className: 'x' }) as HTMLElement;
    const liveEl = h('div', { className: () => cls.value }) as HTMLElement;

    cls.value = 'b';
    settle();
    expect(staticEl.className).toBe('x');
    expect(liveEl.className).toBe('b');
  });

  it('applies a live style string', () => {
    const color = new Signal('red');
    const el = h('p', { style: () => `color: ${color.value}` }) as HTMLElement;
    expect(el.style.color).toBe('red');

    color.value = 'blue';
    settle();
    expect(el.style.color).toBe('blue');
  });

  it('renders a component instance passed as a child', () => {
    class Leaf extends Component {
      protected render() {
        return h('i', null, 'leaf');
      }
    }

    const el = h('div', null, new Leaf());
    expect(el.textContent).toBe('leaf');
  });

  it('renders numbers and flattens arrays', () => {
    const el = h('p', null, 1, [2, 3, null], false);
    expect(el.textContent).toBe('123');
  });

  it('renders a live child that returns a node', () => {
    const el = h('p', null, () => document.createElement('b')) as Element;
    expect(el.innerHTML).toBe('<b></b>');
  });
});

describe('Fragment', () => {
  it('groups children without a wrapper', () => {
    const frag = Fragment(null, h('a', null), 'text', h('b', null));
    expect(frag).toBeInstanceOf(DocumentFragment);
    expect(Array.from(frag.childNodes).map((n) => n.nodeName)).toEqual([
      'A',
      '#text',
      'B',
    ]);
  });
});

describe('h() - class component children', () => {
  it('renders accessor children reactively', () => {
    const label = new Signal('a');
    class Box extends Component<{ children?: unknown }> {
      protected render(): RenderResult {
        const div = document.createElement('div');
        appendChildren(div, [this.props.children]);
        return div;
      }
    }
    const { root } = mount(() => h(Box, null, 'x', () => label.value, '!'));
    expect(root.textContent).toBe('xa!');

    label.value = 'b';
    settle();
    expect(root.textContent).toBe('xb!');
  });

  it('keeps a component in a binding when a signal it read changes', () => {
    const count = new Signal(0);
    let runs = 0;
    class Label extends Component {
      protected render(): RenderResult {
        runs++;
        return document.createTextNode(String(count.value));
      }
    }
    mount(() => h('div', null, () => h(Label, null)));

    count.value = 1;
    settle();
    expect(runs).toBe(1);
  });

  it('keeps a children prop when there are no child arguments', () => {
    class Card extends Component<{ children?: unknown }> {
      protected render(): RenderResult {
        const section = document.createElement('section');
        appendChildren(section, [this.props.children]);
        return section;
      }
    }
    const { root } = mount(() => h(Card, { children: 'body' }));
    expect(root.textContent).toBe('body');
  });

  it('keeps getter props live', () => {
    const title = new Signal('a');
    class Title extends Component<{ title: string }> {
      protected render(): RenderResult {
        const p = document.createElement('p');
        appendChildren(p, [() => this.props.title]);
        return p;
      }
    }
    const props = {
      get title() {
        return title.value;
      },
    };
    const { root } = mount(() => h(Title, props));
    title.value = 'b';
    settle();
    expect(root.textContent).toBe('b');
  });
});
