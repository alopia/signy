/**
 * Security corpus: known XSS payloads through sanitizeHtml(), stripHtml()
 * and attribute bindings. None may produce a handler, a script or a
 * javascript: URL.
 */

import { describe, it, expect } from 'vitest';
import { sanitizeHtml, stripHtml } from '../../src/dom/html';
import { h, html } from '../../src/views';
import { setAttribute, setProperty, spread } from '../../src/views/attributes';
import { mergeProps, setAttributeNS } from '../../src/jsx/runtime';
import { createElement } from '../../src/dom/query';
import { setAttributes } from '../../src/dom/manipulation';
import { Signal } from '../../src/reactivity';
import { expectLogged } from '../support/console';
import { settle } from '../support/tick';

const payloads = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<svg onload=alert(1)><circle /></svg>',
  '<svg><script>alert(1)</script></svg>',
  '<a href="javascript:alert(1)">x</a>',
  '<a href=" jav&#x09;ascript:alert(1)">x</a>',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<body onload=alert(1)>',
  '<div style="background:url(javascript:alert(1))">x</div>',
  '&lt;img src=x onerror=alert(1)&gt;',
  '&#60;script&#62;alert(1)&#60;/script&#62;',
  '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
  '<form><button formaction="javascript:alert(1)">x</button></form>',
  '<details open ontoggle=alert(1)>',
  '"><img src=x onerror=alert(1)>',
];

/** Parses output the way a page would and finds anything that can run */
function liveCode(markup: string): string[] {
  const template = document.createElement('template');
  template.innerHTML = markup;
  const found: string[] = [];
  for (const el of Array.from(template.content.querySelectorAll('*'))) {
    if (el.tagName.toLowerCase() === 'script') found.push('script');
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('on')) found.push(attr.name);
      if (/javascript:/i.test(attr.value.replace(/\s/g, ''))) {
        found.push(`${attr.name}=javascript:`);
      }
      if (attr.name === 'srcdoc') found.push('srcdoc');
    }
  }
  return found;
}

describe('sanitizeHtml', () => {
  it.each(payloads)('escapes %s with no tags allowed', (payload) => {
    expect(liveCode(sanitizeHtml(payload))).toEqual([]);
  });

  it.each(payloads)(
    'keeps nothing live from %s with tags allowed',
    (payload) => {
      const out = sanitizeHtml(payload, [
        'b',
        'a',
        'img',
        'svg',
        'iframe',
        'div',
        'button',
        'details',
      ]);
      expect(liveCode(out)).toEqual([]);
    }
  );

  it('drops attributes of allowed tags', () => {
    expect(sanitizeHtml('<a href="/x" onclick="y()">x</a>', ['a'])).toBe(
      '<a>x</a>'
    );
  });
});

describe('stripHtml', () => {
  // Entities decode to literal text, which is what plain text means
  it.each(payloads.filter((p) => !p.includes('&')))(
    'leaves no markup or script text from %s',
    (payload) => {
      const text = stripHtml(payload);
      expect(text).not.toContain('<');
      expect(text).not.toContain('alert(1)</script');
    }
  );

  it('drops script and style contents', () => {
    expect(stripHtml('<script>alert(1)</script>Text<style>a{}</style>')).toBe(
      'Text'
    );
  });
});

describe('attribute bindings', () => {
  const unsafeUrls = [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    '\u0001javascript:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html,<script>alert(1)</script>',
  ];

  it.each(unsafeUrls)('never sets the href %j', (url) => {
    const a = document.createElement('a');
    setAttribute(a, 'href', url);
    expectLogged('warn', 'view:unsafe-attribute');
    expect(a.hasAttribute('href')).toBe(false);
  });

  it('sets ordinary URLs', () => {
    const a = document.createElement('a');
    setAttribute(a, 'href', '/javascript-guide');
    expect(a.getAttribute('href')).toBe('/javascript-guide');
  });

  it('never sets an on* attribute from a string in h()', () => {
    const img = h('img', { onerror: 'alert(1)' }) as Element;
    expectLogged('warn', 'view:unsafe-attribute');
    expect(img.hasAttribute('onerror')).toBe(false);
  });

  it('never sets an on* attribute from a string in html', () => {
    const img = html`<img onload=${'alert(1)'} />` as Element;
    expectLogged('warn', 'view:unsafe-attribute');
    expect(img.hasAttribute('onload')).toBe(false);
  });

  it('removes a URL that turns into javascript: later', () => {
    const url = new Signal('/ok');
    const a = html`<a href=${() => url.value}>x</a>` as Element;
    expect(a.getAttribute('href')).toBe('/ok');

    url.value = 'javascript:alert(1)';
    settle();
    expectLogged('warn', 'view:unsafe-attribute');
    expect(a.hasAttribute('href')).toBe(false);
  });

  it('never sets unsafe values through spread', () => {
    const el = document.createElement('iframe');
    spread(el, { src: 'javascript:alert(1)', onload: 'alert(1)' });
    expectLogged('warn', 'view:unsafe-attribute');
    expect(el.hasAttribute('src')).toBe(false);
    expect(el.hasAttribute('onload')).toBe(false);
  });
});

describe('other ways to write an attribute', () => {
  it('sets a data: image URL', () => {
    const img = document.createElement('img');
    setAttribute(img, 'src', 'data:image/png;base64,AAAA');
    expect(img.getAttribute('src')).toBe('data:image/png;base64,AAAA');
  });

  it('never sets srcdoc from a binding', () => {
    const frame = document.createElement('iframe');
    setAttribute(frame, 'srcdoc', '<script>alert(1)</script>');
    expectLogged('warn', 'view:unsafe-attribute');
    expect(frame.hasAttribute('srcdoc')).toBe(false);
  });

  it('never sets a javascript: URL through setProperty()', () => {
    const a = document.createElement('a');
    setProperty(a, 'href', 'javascript:alert(1)');
    expectLogged('warn', 'view:unsafe-attribute');
    expect(a.hasAttribute('href')).toBe(false);
  });

  it('still sets ordinary properties', () => {
    const input = document.createElement('input');
    setProperty(input, 'value', 'javascript:is fine as a value');
    expect(input.value).toBe('javascript:is fine as a value');
  });

  it('never sets a javascript: xlink:href through setAttributeNS()', () => {
    const ns = 'http://www.w3.org/1999/xlink';
    const a = document.createElementNS('http://www.w3.org/2000/svg', 'a');
    setAttributeNS(a, ns, 'xlink:href', '/ok');
    expect(a.getAttributeNS(ns, 'href')).toBe('/ok');

    setAttributeNS(a, ns, 'xlink:href', 'javascript:alert(1)');
    expectLogged('warn', 'view:unsafe-attribute');
    expect(a.hasAttributeNS(ns, 'href')).toBe(false);
  });

  it('never sets unsafe values through the dom helpers', () => {
    const a = createElement('a', { href: 'javascript:alert(1)', id: 'x' });
    const img = document.createElement('img');
    setAttributes(img, { onerror: 'alert(1)', alt: 'y' });
    expectLogged('warn', 'view:unsafe-attribute');
    expect(a.hasAttribute('href')).toBe(false);
    expect(a.id).toBe('x');
    expect(img.hasAttribute('onerror')).toBe(false);
    expect(img.alt).toBe('y');
  });
});

describe('mergeProps', () => {
  it('skips an own __proto__ key', () => {
    const merged = mergeProps(JSON.parse('{"__proto__":{"x":1},"a":2}'));
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(merged['a']).toBe(2);
  });

  it('skips an own __proto__ key of a dynamic spread', () => {
    const parsed = JSON.parse('{"__proto__":{"x":1},"a":2}');
    const merged = mergeProps(() => parsed);
    expect(Object.keys(merged)).toEqual(['a']);
    expect(merged['__proto__']).toBeUndefined();
    expect(merged['x']).toBeUndefined();
  });
});
