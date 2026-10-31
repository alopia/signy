/**
 * Tests for the small DOM helpers: classes, attributes, queries and templates
 */

import { describe, it, expect, vi } from 'vitest';
import {
  addClass,
  removeClass,
  toggleClass,
  hasClass,
  setAttributes,
  getAttributes,
  removeAttributes,
  getAttribute,
  hasAttribute,
} from '../../src/dom/manipulation';
import {
  query,
  queryAll,
  createElement,
  getElement,
} from '../../src/dom/query';
import {
  createTemplate,
  clearTemplateCache,
  getTemplateCacheSize,
  createMany,
  createFragment,
} from '../../src/dom/template';

describe('class helpers', () => {
  it('add, remove, toggle and check classes', () => {
    const el = document.createElement('div');
    addClass(el, 'a', 'b');
    expect(el.className).toBe('a b');

    removeClass(el, 'a');
    expect(hasClass(el, 'a')).toBe(false);
    expect(hasClass(el, 'b')).toBe(true);

    expect(toggleClass(el, 'c')).toBe(true);
    expect(toggleClass(el, 'c')).toBe(false);
    expect(toggleClass(el, 'd', true)).toBe(true);
    expect(toggleClass(el, 'd', true)).toBe(true);
  });
});

describe('attribute helpers', () => {
  it('set, read, list and remove attributes', () => {
    const el = document.createElement('input');
    setAttributes(el, { type: 'text', name: 'q', placeholder: 'Search' });

    expect(getAttribute(el, 'name')).toBe('q');
    expect(hasAttribute(el, 'type')).toBe(true);
    expect(getAttributes(el)).toEqual({
      type: 'text',
      name: 'q',
      placeholder: 'Search',
    });

    removeAttributes(el, 'name', 'placeholder');
    expect(getAttributes(el)).toEqual({ type: 'text' });
    expect(getAttribute(el, 'name')).toBeNull();
  });
});

describe('query helpers', () => {
  it('query and queryAll search the document or a parent', () => {
    document.body.innerHTML =
      '<ul id="a"><li>1</li><li>2</li></ul><ul id="b"><li>3</li></ul>';
    const b = document.getElementById('b')!;

    expect(query('li')?.textContent).toBe('1');
    expect(query('li', b)?.textContent).toBe('3');
    expect(queryAll('li').map((li) => li.textContent)).toEqual(['1', '2', '3']);
    expect(queryAll('li', b)).toHaveLength(1);
    expect(query('.missing')).toBeNull();
  });

  it('createElement sets attributes and children', () => {
    const child = document.createElement('b');
    const el = createElement('p', { class: 'x', 'data-id': '1' }, [
      'hi ',
      child,
    ]);
    expect(el.outerHTML).toBe('<p class="x" data-id="1">hi <b></b></p>');
  });

  it('getElement resolves selectors and passes elements through', () => {
    document.body.innerHTML = '<main id="app"></main>';
    const main = document.getElementById('app')!;
    expect(getElement('#app')).toBe(main);
    expect(getElement(main)).toBe(main);
    expect(getElement('#nope')).toBeNull();
  });
});

describe('template helpers', () => {
  it('clones a fresh copy each call and caches by markup', () => {
    clearTemplateCache();
    const make = createTemplate('<li class="row"><span></span></li>');
    const a = make() as Element;
    const b = make() as Element;

    expect(a).not.toBe(b);
    expect(a.outerHTML).toBe('<li class="row"><span></span></li>');

    createTemplate('<li class="row"><span></span></li>');
    expect(getTemplateCacheSize()).toBe(1);

    clearTemplateCache();
    expect(getTemplateCacheSize()).toBe(0);
  });

  it('takes the element of markup written with leading whitespace', () => {
    const make = createTemplate(`
      <li class="row"></li>
    `);
    expect((make() as Element).outerHTML).toBe('<li class="row"></li>');
    expect(createTemplate('plain text')().textContent).toBe('plain text');
  });

  it('keeps at most 500 templates', () => {
    clearTemplateCache();
    for (let i = 0; i < 600; i++) createTemplate(`<p>${i}</p>`);
    expect(getTemplateCacheSize()).toBe(500);
    clearTemplateCache();
  });

  it('uses only the first node of the markup', () => {
    clearTemplateCache();
    const node = createTemplate('<a></a><b></b>')();
    expect(node.nodeName).toBe('A');
  });

  it('createMany builds and customizes one node per item', () => {
    const customize = vi.fn((el: HTMLElement, item: string, i: number) => {
      el.textContent = `${i}:${item}`;
    });
    const items = createMany<string, HTMLElement>(
      '<li></li>',
      ['a', 'b'],
      customize
    );

    expect(items.map((el) => el.outerHTML)).toEqual([
      '<li>0:a</li>',
      '<li>1:b</li>',
    ]);
    expect(customize).toHaveBeenCalledTimes(2);
  });

  it('createMany accepts a template function', () => {
    const items = createMany(
      () => document.createElement('i'),
      [1, 2, 3],
      () => {}
    );
    expect(items).toHaveLength(3);
  });

  it('createFragment groups nodes', () => {
    const frag = createFragment(
      document.createElement('a'),
      document.createTextNode('t')
    );
    expect(frag.childNodes).toHaveLength(2);
  });
});
