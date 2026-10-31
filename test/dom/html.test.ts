/**
 * Tests for the HTML string helpers
 */

import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  unescapeHtml,
  stripHtml,
  sanitizeHtml,
} from '../../src/dom/html';

describe('escapeHtml', () => {
  it('escapes markup characters', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;'
    );
  });

  it('escapes quotes, so it is safe inside attribute values', () => {
    expect(escapeHtml(`"'`)).toBe('&quot;&#39;');
    const div = document.createElement('div');
    div.innerHTML = `<a title="${escapeHtml('" onmouseover="x')}">y</a>`;
    expect(div.querySelector('a')!.hasAttribute('onmouseover')).toBe(false);
  });

  it('turns null and undefined into an empty string', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('stringifies other values', () => {
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(false)).toBe('false');
  });
});

describe('unescapeHtml', () => {
  it('reverses escapeHtml', () => {
    const raw = '<p class="a">Tom & "Jerry"</p>';
    expect(unescapeHtml(escapeHtml(raw))).toBe(raw);
  });

  it('returns an empty string for empty input', () => {
    expect(unescapeHtml('')).toBe('');
  });

  it('keeps carriage returns and NUL characters', () => {
    for (const raw of [
      'a\r\nb',
      'a\rb',
      '\r',
      'x\u0000y',
      'a\u0000\r\u0000b',
    ]) {
      expect(unescapeHtml(escapeHtml(raw)), JSON.stringify(raw)).toBe(raw);
    }
  });

  it('round trips awkward strings', () => {
    for (const raw of [
      '&amp;lt;',
      '&#65;',
      '<b>x</b>',
      '  leading',
      '\nfirst',
      'tab\tend',
      '😀',
      'a\u2028b',
      '&',
    ]) {
      expect(unescapeHtml(escapeHtml(raw)), JSON.stringify(raw)).toBe(raw);
    }
  });

  it('decodes an entity once, and named and numeric references', () => {
    expect(unescapeHtml('&amp;lt;')).toBe('&lt;');
    expect(unescapeHtml('&copy; &notin; &#65; &#x42;')).toBe('© ∉ A B');
  });
});

describe('stripHtml', () => {
  it('keeps only the text', () => {
    expect(stripHtml('<div>Hello <b>World</b></div>')).toBe('Hello World');
  });

  it('decodes entities in the text', () => {
    expect(stripHtml('<p>1 &lt; 2</p>')).toBe('1 < 2');
  });

  it('returns an empty string for empty input', () => {
    expect(stripHtml('')).toBe('');
  });
});

describe('sanitizeHtml', () => {
  it('escapes everything when no tags are allowed', () => {
    expect(sanitizeHtml('<b>hi</b>')).toBe('&lt;b&gt;hi&lt;/b&gt;');
  });

  it('keeps allowed tags and unwraps the rest', () => {
    expect(sanitizeHtml('<div>Hello <b>World</b></div>', ['b'])).toBe(
      'Hello <b>World</b>'
    );
  });

  it('drops attributes from allowed tags', () => {
    expect(
      sanitizeHtml('<a href="javascript:alert(1)" onclick="x()">x</a>', ['a'])
    ).toBe('<a>x</a>');
  });

  it('keeps escaped markup in text escaped', () => {
    const out = sanitizeHtml('<b>&lt;img src=x onerror=alert(1)&gt;</b>', [
      'b',
    ]);
    expect(out).toBe('<b>&lt;img src=x onerror=alert(1)&gt;</b>');
  });

  it('never outputs a disallowed tag, even nested in allowed ones', () => {
    const out = sanitizeHtml(
      '<b><img src=x onerror=alert(1)><script>alert(2)</script>ok</b>',
      ['b']
    );
    expect(out).not.toMatch(/<(img|script)/i);
    expect(out).toContain('ok');
  });

  it('drops comments', () => {
    expect(sanitizeHtml('<b>a<!-- secret --></b>', ['b'])).toBe('<b>a</b>');
  });

  it('returns an empty string for empty input', () => {
    expect(sanitizeHtml('', ['b'])).toBe('');
  });
});

describe('sanitizeHtml tag list', () => {
  it('matches tags in any case and writes void tags once', () => {
    expect(sanitizeHtml('<b>x</b><br>y', ['B', 'BR'])).toBe('<b>x</b><br>y');
  });

  it('never keeps script or style, even when allowed', () => {
    expect(
      sanitizeHtml('<script>alert(1)</script><style>p{}</style>ok', [
        'script',
        'style',
      ])
    ).toBe('ok');
  });
});
