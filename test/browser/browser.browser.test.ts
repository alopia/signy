/**
 * Behavior jsdom cannot show: layout, scrolling, real history traversal,
 * Shadow DOM styling, and resource loading.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  Component,
  Outlet,
  Signal,
  html,
  emit,
  useTransition,
  type RenderResult,
} from '../../src';
import { router as createRouter, type Router } from '../../src/router/router';
import { createBrowserHistory, type History } from '../../src/router/history';
import { stripHtml, sanitizeHtml } from '../../src/dom/html';
import { mount } from '../support/mount';
import { settleAsync } from '../support/tick';

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const popped = () =>
  new Promise<void>((resolve) =>
    window.addEventListener('popstate', () => resolve(), { once: true })
  );

describe('scroll restoration', () => {
  let r: Router | undefined;

  afterEach(() => {
    r?.destroy();
    window.scrollTo(0, 0);
  });

  class Tall extends Component {
    protected render(): RenderResult {
      return html`<div style="height: 5000px">tall</div>`;
    }
  }

  class Shell extends Component {
    protected render(): RenderResult {
      return html`<div><${Outlet} /></div>`;
    }
  }

  it('scrolls to top on push and restores the position on back', async () => {
    r = createRouter({
      mode: 'history',
      routes: [
        { path: '/', component: Tall },
        { path: '/a', component: Tall },
        { path: '/b', component: Tall },
      ],
    });
    mount(Shell, { plugins: [r] });
    await r.push('/a');
    await settleAsync();

    window.scrollTo(0, 1200);
    await frame();
    expect(window.scrollY).toBe(1200);

    await r.push('/b');
    await settleAsync();
    await frame();
    expect(window.scrollY).toBe(0);

    const pop = popped();
    r.back();
    await pop;
    await settleAsync();
    await frame();
    expect(window.scrollY).toBe(1200);
  });

  it('saves the position of the page left with back or forward', async () => {
    r = createRouter({
      mode: 'history',
      routes: [
        { path: '/', component: Tall },
        { path: '/a', component: Tall },
        { path: '/b', component: Tall },
      ],
    });
    mount(Shell, { plugins: [r] });
    const traverse = async (go: () => void): Promise<number> => {
      const pop = popped();
      go();
      await pop;
      await settleAsync();
      await frame();
      return window.scrollY;
    };
    await r.push('/a');
    await settleAsync();
    window.scrollTo(0, 1200);
    await frame();
    await r.push('/b');
    await settleAsync();
    window.scrollTo(0, 800);
    await frame();

    expect(await traverse(() => r!.back())).toBe(1200);
    window.scrollTo(0, 300);
    await frame();
    expect(await traverse(() => r!.forward())).toBe(800);
    // Newer than the position /a kept in its history entry
    expect(await traverse(() => r!.back())).toBe(300);
  });
});

describe('browser history', () => {
  let history: History | undefined;

  afterEach(() => history?.destroy());

  it('follows real back and forward traversal', async () => {
    history = createBrowserHistory();
    history.push('/one');
    history.push('/two');

    let pop = popped();
    history.back();
    await pop;
    expect(history.location.value.path).toBe('/one');
    expect(location.pathname).toBe('/one');

    pop = popped();
    history.forward();
    await pop;
    expect(history.location.value.path).toBe('/two');
  });

  it('keeps the URL in place when a blocker rejects a back navigation', async () => {
    history = createBrowserHistory();
    history.push('/start');
    history.push('/form');
    history.block(() => {});

    const pop = popped();
    history.back();
    await pop;
    // The history undoes the blocked pop with another traversal
    await popped();

    expect(location.pathname).toBe('/form');
    expect(history.location.value.path).toBe('/form');
  });

  it('retries a blocked back navigation', async () => {
    history = createBrowserHistory();
    history.push('/start');
    history.push('/form');
    let retry: (() => void) | undefined;
    const unblock = history.block((_loc, _action, r) => (retry = r));

    const pop = popped();
    history.back();
    await pop;
    await popped();

    unblock();
    const retried = popped();
    retry!();
    await retried;
    expect(location.pathname).toBe('/start');
    expect(history.location.value.path).toBe('/start');
  });

  it('keeps the previous entry after a blocked back navigation', async () => {
    history = createBrowserHistory();
    history.push('/start');
    history.push('/form');
    const unblock = history.block(() => {});

    let pop = popped();
    history.back();
    await pop;
    await popped();
    unblock();

    pop = popped();
    history.back();
    await pop;
    expect(location.pathname).toBe('/start');
  });
});

describe('router guards on back and forward', () => {
  let r: Router | undefined;

  afterEach(() => r?.destroy());

  class Page extends Component {
    protected render(): RenderResult {
      return html`<p>page</p>`;
    }
  }

  it('runs a route guard on a real back traversal', async () => {
    let signedIn = true;
    history.replaceState(null, '', '/');
    r = createRouter({
      routes: [
        { path: '/', component: Page },
        { path: '/account', component: Page, guards: [() => signedIn || '/'] },
      ],
    });
    await r.push('/account');
    await r.push('/');

    signedIn = false;
    const pop = popped();
    history.back();
    await pop;
    // The redirect to the route on screen steps forward again
    const stepped = popped();
    await settleAsync();
    await stepped;

    expect(r.route.value.path).toBe('/');
    expect(location.pathname).toBe('/');
  });

  for (const mode of ['history', 'hash'] as const) {
    it(`keeps the entry left when a guard cancels back, ${mode} mode`, async () => {
      let allowed = true;
      history.replaceState(null, '', '/');
      r = createRouter({
        mode,
        routes: [
          { path: '/', component: Page },
          { path: '/account', component: Page, guards: [() => allowed] },
        ],
      });
      await settleAsync();
      await r.push('/account');
      await r.push('/');
      const length = history.length;

      allowed = false;
      let pop = popped();
      history.back();
      await pop;
      // The cancel steps forward again
      pop = popped();
      await settleAsync();
      await pop;
      await settleAsync();
      expect(r.route.value.path).toBe('/');
      expect(history.length).toBe(length);

      allowed = true;
      pop = popped();
      history.back();
      await pop;
      await settleAsync();
      expect(r.route.value.path).toBe('/account');
      expect(mode === 'hash' ? location.hash : location.pathname).toBe(
        mode === 'hash' ? '#/account' : '/account'
      );
    });
  }
});

describe('SVG in html templates', () => {
  it('draws shapes with a size', () => {
    const host = document.createElement('div');
    document.body.append(host);
    host.append(
      html`<svg width="40" height="40" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r="10" fill="red" />
      </svg>` as Node
    );
    const box = host.querySelector('circle')!.getBoundingClientRect();
    expect(box.width).toBe(20);
    expect(box.height).toBe(20);
    host.remove();
  });
});

describe('Shadow DOM', () => {
  it('applies component styles inside the shadow root only', async () => {
    class Styled extends Component {
      protected shadow = true;
      protected styles = 'p { color: rgb(255, 0, 89); }';
      protected render(): RenderResult {
        return html`<p>inside</p>`;
      }
    }

    const { root } = mount(
      () =>
        html`<div>
          <${Styled} />
          <p class="outside">outside</p>
        </div>`
    );
    await frame();
    const inside = root
      .querySelector('signy-styled')!
      .shadowRoot!.querySelector('p')!;
    const outside = root.querySelector('.outside')!;

    expect(getComputedStyle(inside).color).toBe('rgb(255, 0, 89)');
    expect(getComputedStyle(outside).color).not.toBe('rgb(255, 0, 89)');
  });

  it('lets composed events out of the shadow root', () => {
    let received: unknown;
    class Picker extends Component {
      protected shadow = true;
      protected render(): RenderResult {
        return html`<button
          onClick=${(e: Event) => emit(e.target as Element, 'pick', 7)}
        >
          pick
        </button>`;
      }
    }

    const { root } = mount(() => html`<div><${Picker} /></div>`);
    root.addEventListener(
      'pick',
      (e) => (received = (e as CustomEvent).detail)
    );
    root
      .querySelector('signy-picker')!
      .shadowRoot!.querySelector('button')!
      .click();
    expect(received).toBe(7);
  });
});

describe('HTML helpers do not run untrusted markup', () => {
  const probe = (name: string) =>
    `<img src="data:," onerror="window.${name}=1">`;
  const fired = (name: string) =>
    (window as unknown as Record<string, unknown>)[name];
  const wait = () => new Promise((resolve) => setTimeout(resolve, 100));

  it('stripHtml', async () => {
    stripHtml(probe('__stripHit'));
    await wait();
    expect(fired('__stripHit')).toBeUndefined();
  });

  it('sanitizeHtml', async () => {
    sanitizeHtml(probe('__sanitizeHit'), ['b']);
    await wait();
    expect(fired('__sanitizeHit')).toBeUndefined();
  });
});

describe('transitions', () => {
  it('paints isPending before the updates run', async () => {
    const [isPending, start] = useTransition();
    const result = new Signal('old');
    const { root } = mount(
      () =>
        html`<p>
          ${() => (isPending.value ? 'pending' : 'idle')} ${() => result.value}
        </p>`
    );
    await settleAsync();

    const done = start(() => (result.value = 'new'));
    // Frame callbacks run right before the paint
    await frame();
    expect(root.textContent).toBe('pending old');

    await done;
    await settleAsync();
    expect(root.textContent).toBe('idle new');
  });
});
