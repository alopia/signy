/**
 * Every binding belongs to an owner, so unmounting or re-running releases it.
 * After unmount, every signal a component used has no subscribers left.
 */

import { describe, it, expect } from 'vitest';
import {
  Component,
  Signal,
  Show,
  Switch,
  Match,
  For,
  Index,
  Portal,
  Outlet,
  html,
  createRenderEffect,
  createRoot,
  type RenderResult,
} from '../../src';
import { mount } from '../support/mount';
import { createTestRouter } from '../support/router';
import { settle, settleAsync } from '../support/tick';

const el = (tag: string, text = '') => {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
};

const node = (result: unknown) =>
  (Array.isArray(result) ? result[0] : result) as Node;

function expectReleased(...signals: { subscriberCount: number }[]) {
  expect(signals.map((s) => s.subscriberCount)).toEqual(signals.map(() => 0));
}

describe('ownership: unmount releases every binding', () => {
  it('text, attribute, class and style bindings', () => {
    const text = new Signal('a');
    const title = new Signal('t');
    const cls = new Signal('c');
    const color = new Signal('red');
    const { unmount } = mount(
      () =>
        html`<p
          title=${() => title.value}
          class=${() => cls.value}
          style=${() => ({ color: color.value })}
        >
          ${() => text.value}
        </p>`
    );
    unmount();
    expectReleased(text, title, cls, color);
  });

  it('Show, Switch, For and Index', () => {
    const on = new Signal(true);
    const inner = new Signal('x');
    const mode = new Signal<'a' | 'b'>('a');
    const items = new Signal([1, 2, 3]);
    const { unmount } = mount(
      () =>
        html`<div>
          ${Show({ when: () => on.value, children: () => node(html`<i>${() => inner.value}</i>`) })}
          ${Switch({
            children: [
              Match({
                when: () => mode.value === 'a',
                children: () => el('u'),
              }),
            ],
          })}
          <ul>
            ${For({ each: () => items.value, children: (i: number) => node(html`<li>${() => `${i}${inner.value}`}</li>`) })}
          </ul>
          <ol>
            ${Index({ each: () => items.value, children: (i: () => number) => node(html`<li>${() => i()}</li>`) })}
          </ol>
        </div>`
    );
    unmount();
    expectReleased(on, inner, mode, items);
  });

  it('Portal content is removed', () => {
    const target = document.body.appendChild(document.createElement('div'));
    const text = new Signal('p');
    const { unmount } = mount(
      () =>
        html`<div>
          ${Portal({ mount: target, children: node(html`<b>${() => text.value}</b>`) })}
        </div>`
    );
    unmount();
    expect(target.childNodes).toHaveLength(0);
    expectReleased(text);
  });

  it('nested child components', () => {
    const count = new Signal(0);
    class Leaf extends Component {
      protected render(): RenderResult {
        return html`<i>${() => count.value}</i>`;
      }
    }
    class Branch extends Component {
      protected render(): RenderResult {
        return html`<div><${Leaf} /><${Leaf} /></div>`;
      }
    }
    const { unmount } = mount(() => html`<section><${Branch} /></section>`);
    unmount();
    expectReleased(count);
  });

  it('child components inside a Show branch', () => {
    const on = new Signal(true);
    const count = new Signal(0);
    class Leaf extends Component {
      protected render(): RenderResult {
        return html`<i>${() => count.value}</i>`;
      }
    }
    const { unmount } = mount(
      () =>
        html`<div>
          ${Show({ when: () => on.value, children: () => node(html`<${Leaf} />`) })}
        </div>`
    );
    unmount();
    expectReleased(on, count);
  });

  it('routed components on navigation and unmount', async () => {
    const count = new Signal(0);
    class Page extends Component {
      protected render(): RenderResult {
        return html`<p>${() => count.value}</p>`;
      }
    }
    class Other extends Component {
      protected render(): RenderResult {
        return html`<p>other</p>`;
      }
    }
    class Root extends Component {
      protected render(): RenderResult {
        return html`<div><${Outlet} /></div>`;
      }
    }
    const router = createTestRouter([
      { path: '/', component: Page },
      { path: '/other', component: Other },
    ]);
    const { unmount } = mount(Root, { plugins: [router] });
    await settleAsync();
    expect(count.subscriberCount).toBe(1);

    await router.push('/other');
    await settleAsync();
    expect(count.subscriberCount).toBe(0);

    unmount();
    expectReleased(router.route);
  });
});

describe('ownership: re-running releases the previous run', () => {
  it('an outer binding re-run N times keeps one inner subscription', () => {
    const outer = new Signal(0);
    const x = new Signal(0);
    let runs = 0;
    createRoot((dispose) => {
      createRenderEffect(() => {
        void outer.value;
        createRenderEffect(() => {
          void x.value;
          runs++;
        });
      });
      for (let i = 0; i < 5; i++) {
        outer.value++;
        settle();
      }
      expect(x.subscriberCount).toBe(1);

      runs = 0;
      x.value++;
      settle();
      expect(runs).toBe(1);

      dispose();
    });
    expect(x.subscriberCount).toBe(0);
  });

  it('switching a Show branch releases the old branch', () => {
    const on = new Signal(true);
    const a = new Signal('a');
    const b = new Signal('b');
    mount(
      () =>
        html`<div>
          ${Show({
            when: () => on.value,
            fallback: node(html`<i>${() => b.value}</i>`),
            children: () => node(html`<b>${() => a.value}</b>`),
          })}
        </div>`
    );
    expect(a.subscriberCount).toBe(1);

    on.value = false;
    settle();
    expect(a.subscriberCount).toBe(0);
  });

  it('removing a For item releases its bindings', () => {
    const items = new Signal([1, 2, 3]);
    const label = new Signal('x');
    mount(
      () =>
        html`<ul>
          ${For({
            each: () => items.value,
            key: (i: number) => i,
            children: (i: number) =>
              node(html`<li>${() => `${i}${label.value}`}</li>`),
          })}
        </ul>`
    );
    expect(label.subscriberCount).toBe(3);

    items.value = [1];
    settle();
    expect(label.subscriberCount).toBe(1);
  });

  it('a disposed render effect leaves its signals', () => {
    const x = new Signal(0);
    createRoot((dispose) => {
      createRenderEffect(() => void x.value);
      expect(x.subscriberCount).toBe(1);
      dispose();
    });
    expect(x.subscriberCount).toBe(0);
  });

  it('dropped dependencies are released on re-run', () => {
    const useA = new Signal(true);
    const a = new Signal(1);
    const b = new Signal(2);
    createRoot((dispose) => {
      createRenderEffect(() => void (useA.value ? a.value : b.value));
      useA.value = false;
      settle();
      expect(a.subscriberCount).toBe(0);
      expect(b.subscriberCount).toBe(1);
      dispose();
    });
  });
});
