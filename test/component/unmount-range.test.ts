/**
 * Unmounting removes what the component added to its container, and nothing
 * the page put in or around it.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  Component,
  Dynamic,
  ErrorBoundary,
  For,
  Match,
  Show,
  Signal,
  Switch,
  application,
  html,
  type RenderResult,
} from '../../src';
import { settle } from '../support/tick';

let container: HTMLDivElement;

/** A template with several roots, as the Node a control flow child takes */
const many = (nodes: unknown): Node => nodes as Node;

function around(): { before: HTMLElement; after: HTMLElement } {
  const before = document.createElement('p');
  before.id = 'before';
  const after = document.createElement('p');
  after.id = 'after';
  return { before, after };
}

/** Mounts `Root` between two nodes of the page and returns what is left after unmount */
function mountAndUnmount(
  Root: new () => Component,
  between?: () => void
): string {
  const { before, after } = around();
  container.append(before);
  const app = application(Root).mount(container);
  container.append(after);
  between?.();
  settle();
  app.unmount();
  return container.innerHTML;
}

const KEPT = '<p id="before"></p><p id="after"></p>';

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
});

describe('unmount', () => {
  it('keeps the nodes around the component', () => {
    class Root extends Component {
      protected render(): RenderResult {
        return html`<div class="root">hello</div>`;
      }
    }
    expect(mountAndUnmount(Root)).toBe(KEPT);
  });

  it('adds nothing to the container when the root ends in an element', () => {
    class Root extends Component {
      protected render(): RenderResult {
        return html`<div class="root">hello</div>`;
      }
    }
    const { before } = around();
    container.append(before);
    application(Root).mount(container);
    expect(container.innerHTML).toBe(
      '<p id="before"></p><div class="root">hello</div>'
    );
  });

  it('removes several top level nodes', () => {
    class Root extends Component {
      protected render(): RenderResult {
        return html`<h1>a</h1>
          <p>b</p>
          text<i>c</i>`;
      }
    }
    expect(mountAndUnmount(Root)).toBe(KEPT);
  });

  it('leaves a container alone when the component renders nothing', () => {
    class Root extends Component {
      protected render(): RenderResult {
        return null;
      }
    }
    expect(mountAndUnmount(Root)).toBe(KEPT);
  });

  it('removes rows that For puts between its markers at the top level', () => {
    const rows = new Signal([1, 2, 3]);
    class Root extends Component {
      protected render(): RenderResult {
        return html`<h1>list</h1>
          ${For({
            each: () => rows.value,
            children: (n) => many(html`<i>${n}</i>`),
          })}`;
      }
    }
    expect(mountAndUnmount(Root, () => (rows.value = [1, 2, 3, 4, 5]))).toBe(
      KEPT
    );
  });

  describe('a root that ends in a single marker, whose nodes come after it', () => {
    it('Show', () => {
      const on = new Signal(false);
      class Root extends Component {
        protected render(): RenderResult {
          return html`<h1>t</h1>
            ${Show({
              when: () => on.value,
              children: many(html`<b>one</b><b>two</b>`),
            })}`;
        }
      }
      expect(mountAndUnmount(Root, () => (on.value = true))).toBe(KEPT);
    });

    it('Switch', () => {
      const which = new Signal('a');
      class Root extends Component {
        protected render(): RenderResult {
          return html`${Switch({
            children: [
              Match({
                when: () => which.value === 'a',
                children: many(html`<b>a</b>`),
              }),
              Match({
                when: () => which.value === 'b',
                children: many(html`<i>b</i><i>b</i>`),
              }),
            ],
          })}`;
        }
      }
      expect(mountAndUnmount(Root, () => (which.value = 'b'))).toBe(KEPT);
    });

    it('Dynamic', () => {
      const tag = new Signal('p');
      class Root extends Component {
        protected render(): RenderResult {
          return html`<h1>t</h1>
            ${Dynamic({ component: () => tag.value, children: ['x'] })}`;
        }
      }
      expect(mountAndUnmount(Root, () => (tag.value = 'section'))).toBe(KEPT);
    });

    it('ErrorBoundary', () => {
      class Root extends Component {
        protected render(): RenderResult {
          return html`${ErrorBoundary({
            fallback: () => many(html`<u>failed</u>`),
            children: many(html`<b>fine</b><b>fine</b>`),
          })}`;
        }
      }
      expect(mountAndUnmount(Root)).toBe(KEPT);
    });

    it('closes the range with one comment, only when the root ends in a marker', () => {
      const on = new Signal(true);
      class Root extends Component {
        protected render(): RenderResult {
          return html`${Show({ when: () => on.value, children: many(html`<b>x</b>`) })}`;
        }
      }
      application(Root).mount(container);
      expect(container.innerHTML.match(/<!--component:end-->/g)).toHaveLength(
        1
      );
    });
  });

  it('removes what a function child of the root shows', () => {
    const on = new Signal(false);
    class Root extends Component {
      protected render(): RenderResult {
        return html`<h1>t</h1>
          ${() => (on.value ? html`<b>shown</b>` : null)}`;
      }
    }
    expect(mountAndUnmount(Root, () => (on.value = true))).toBe(KEPT);
  });

  it('stops at a top level node that was moved out of the container', () => {
    const elsewhere = document.createElement('section');
    document.body.appendChild(elsewhere);
    class Root extends Component {
      protected render(): RenderResult {
        const moved = document.createElement('i');
        moved.id = 'moved';
        queueMicrotask(() => elsewhere.appendChild(moved));
        return html`${moved}<b>stays until unmount</b>`;
      }
    }
    const { before, after } = around();
    container.append(before);
    const app = application(Root).mount(container);
    container.append(after);
    return Promise.resolve().then(() => {
      expect(() => app.unmount()).not.toThrow();
      // The first node left the container, so nothing after it is guessed at
      expect(container.querySelector('#before')).not.toBeNull();
      expect(container.querySelector('#after')).not.toBeNull();
      expect(elsewhere.querySelector('#moved')).not.toBeNull();
      elsewhere.remove();
    });
  });

  it('removes the component from a container the page already filled, wherever it ended up', () => {
    class Root extends Component {
      protected render(): RenderResult {
        return html`<div class="root">hello</div>`;
      }
    }
    container.innerHTML = '<p id="before"></p><p id="after"></p>';
    const app = application(Root).mount(container);
    expect(container.lastElementChild!.className).toBe('root');
    app.unmount();
    expect(container.innerHTML).toBe(KEPT);
  });
});

describe('update', () => {
  it('re-renders in place and keeps the nodes around the component', () => {
    const label = { text: 'one' };
    class Root extends Component {
      protected render(): RenderResult {
        return html`<div class="root">${label.text}</div>`;
      }
    }
    const { before, after } = around();
    container.append(before);
    const root = new Root();
    const app = application(root).mount(container);
    container.append(after);
    label.text = 'two';
    root.update();
    expect(container.innerHTML).toBe(
      '<p id="before"></p><div class="root">two</div><p id="after"></p>'
    );
    app.unmount();
    expect(container.innerHTML).toBe(KEPT);
  });
});

describe('a component with a shadow root', () => {
  it('removes its shadow content and keeps the children of the host', () => {
    class Root extends Component {
      protected shadow = true;
      protected render(): RenderResult {
        return html`<slot></slot>`;
      }
    }
    const host = document.createElement('div');
    host.innerHTML = '<b>mine</b>';
    document.body.appendChild(host);
    const app = application(Root).mount(host);
    expect(host.shadowRoot!.querySelector('slot')).not.toBeNull();
    app.unmount();
    expect(host.innerHTML).toBe('<b>mine</b>');
    expect(host.shadowRoot!.childNodes).toHaveLength(0);
    host.remove();
  });
});
