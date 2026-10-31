/**
 * Tests for useHead
 */

import { afterEach, describe, expect, it } from 'vitest';
import { Component } from '../../src/component/component';
import { useHead } from '../../src/dom/head';
import { Signal } from '../../src/reactivity';
import { html } from '../../src/views/html';
import { expectLogged } from '../support/console';
import { mount } from '../support/mount';
import { settle } from '../support/tick';
import { testRoot } from '../support/root';
import type { RenderResult } from '../../src/types';

const metas = (): Element[] =>
  Array.from(document.head.querySelectorAll('meta'));
const links = (): Element[] =>
  Array.from(document.head.querySelectorAll('link'));

afterEach(() => {
  document.head.innerHTML = '';
  document.title = '';
});

describe('useHead title', () => {
  it('sets the title and puts the old one back on dispose', () => {
    document.title = 'Before';
    testRoot((dispose) => {
      useHead({ title: 'Inbox' });
      expect(document.title).toBe('Inbox');
      dispose();
    });
    expect(document.title).toBe('Before');
  });

  it('lets the latest entry win and brings the previous one back', () => {
    testRoot(() => {
      useHead({ title: 'App' });
      let disposePage!: () => void;
      testRoot((dispose) => {
        disposePage = dispose;
        useHead({ title: 'Page' });
      });
      expect(document.title).toBe('Page');
      disposePage();
      expect(document.title).toBe('App');
    });
  });

  it('follows the signals a function reads', () => {
    testRoot(() => {
      const unread = new Signal(3);
      useHead(() => ({ title: `Inbox (${unread.value})` }));
      expect(document.title).toBe('Inbox (3)');
      unread.value = 0;
      settle();
      expect(document.title).toBe('Inbox (0)');
    });
  });

  it('wraps the title in a string template', () => {
    testRoot(() => {
      useHead({ titleTemplate: '%s - Signy' });
      useHead({ title: 'Docs' });
      expect(document.title).toBe('Docs - Signy');
    });
  });

  it('keeps $ sequences in the title as text', () => {
    testRoot(() => {
      useHead({ titleTemplate: '%s | Site' });
      useHead({ title: "Cost $& and $` and $' and $1" });
      expect(document.title).toBe("Cost $& and $` and $' and $1 | Site");
    });
  });

  it('wraps the title in a function template', () => {
    testRoot(() => {
      useHead({ title: 'Docs', titleTemplate: (title) => title.toUpperCase() });
      expect(document.title).toBe('DOCS');
    });
  });

  it('leaves the title alone when no entry sets one', () => {
    document.title = 'Kept';
    testRoot(() => {
      useHead({ meta: [{ name: 'a', content: 'b' }] });
      expect(document.title).toBe('Kept');
    });
  });
});

describe('useHead tags', () => {
  it('adds a meta tag and removes it on dispose', () => {
    testRoot((dispose) => {
      useHead({ meta: [{ name: 'description', content: 'Hello' }] });
      expect(metas()).toHaveLength(1);
      expect(metas()[0]!.getAttribute('content')).toBe('Hello');
      expect(metas()[0]!.hasAttribute('data-signy-head')).toBe(true);
      dispose();
    });
    expect(metas()).toHaveLength(0);
  });

  it('takes over a tag that is already in the page and restores it', () => {
    document.head.innerHTML = '<meta name="description" content="Original">';
    testRoot((dispose) => {
      useHead({ meta: [{ name: 'description', content: 'Page' }] });
      expect(metas()).toHaveLength(1);
      expect(metas()[0]!.getAttribute('content')).toBe('Page');
      dispose();
    });
    expect(metas()).toHaveLength(1);
    expect(metas()[0]!.getAttribute('content')).toBe('Original');
    expect(metas()[0]!.hasAttribute('data-signy-head')).toBe(false);
  });

  it('lets the latest entry win per tag and restores the previous one', () => {
    testRoot(() => {
      useHead({ meta: [{ name: 'description', content: 'App' }] });
      let disposePage!: () => void;
      testRoot((dispose) => {
        disposePage = dispose;
        useHead({ meta: [{ name: 'description', content: 'Page' }] });
      });
      expect(metas()).toHaveLength(1);
      expect(metas()[0]!.getAttribute('content')).toBe('Page');
      disposePage();
      expect(metas()[0]!.getAttribute('content')).toBe('App');
    });
  });

  it('keeps tags with different keys side by side', () => {
    testRoot(() => {
      useHead({
        meta: [
          { name: 'description', content: 'd' },
          { property: 'og:title', content: 't' },
        ],
      });
      expect(metas()).toHaveLength(2);
    });
  });

  it('updates a tag when a signal changes and drops attributes that went away', () => {
    testRoot(() => {
      const theme = new Signal<string | undefined>('dark');
      useHead(() => ({
        meta: [{ name: 'theme-color', content: theme.value, media: '(x)' }],
      }));
      expect(metas()[0]!.getAttribute('content')).toBe('dark');
      theme.value = undefined;
      settle();
      expect(metas()[0]!.hasAttribute('content')).toBe(false);
      expect(metas()[0]!.getAttribute('media')).toBe('(x)');
    });
  });

  it('removes a tag when the entry stops listing it', () => {
    testRoot(() => {
      const on = new Signal(true);
      useHead(() => ({
        meta: on.value ? [{ name: 'robots', content: 'noindex' }] : [],
      }));
      expect(metas()).toHaveLength(1);
      on.value = false;
      settle();
      expect(metas()).toHaveLength(0);
    });
  });

  it('keeps one canonical link and one link per href otherwise', () => {
    testRoot(() => {
      useHead({
        link: [
          { rel: 'canonical', href: '/a' },
          { rel: 'canonical', href: '/b' },
          { rel: 'stylesheet', href: '/one.css' },
          { rel: 'stylesheet', href: '/two.css' },
        ],
      });
      expect(links()).toHaveLength(3);
      expect(
        links()
          .find((l) => l.getAttribute('rel') === 'canonical')!
          .getAttribute('href')
      ).toBe('/b');
    });
  });

  it('keeps a single charset tag', () => {
    testRoot(() => {
      useHead({ meta: [{ charset: 'utf-8' }] });
      useHead({ meta: [{ charset: 'utf-8' }] });
      expect(metas()).toHaveLength(1);
    });
  });

  it('does not write an unsafe URL', () => {
    testRoot(() => {
      useHead({ link: [{ rel: 'canonical', href: 'javascript:alert(1)' }] });
      expect(links()[0]?.getAttribute('href') ?? null).toBeNull();
    });
    expectLogged('warn', 'view:unsafe-attribute');
  });

  it('adds one tag per call when a tag has no key', () => {
    testRoot(() => {
      useHead({ meta: [{ content: 'a' }, { content: 'b' }] });
      expect(metas()).toHaveLength(2);
    });
  });
});

describe('useHead in a component', () => {
  it('lives as long as the component', () => {
    class Page extends Component {
      protected setup(): void {
        useHead({
          title: 'Page',
          meta: [{ name: 'description', content: 'p' }],
        });
      }
      protected render(): RenderResult {
        return html`<p>page</p>`;
      }
    }
    const view = mount(Page);
    expect(document.title).toBe('Page');
    expect(metas()).toHaveLength(1);
    view.unmount();
    expect(document.title).toBe('');
    expect(metas()).toHaveLength(0);
  });
});
