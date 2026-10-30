/**
 * Control flow used as tags in html: the children wait for the component that
 * shows them, as JSX getters do.
 */

import { describe, it, expect } from 'vitest';
import {
  Component,
  Dynamic,
  ErrorBoundary,
  Match,
  Show,
  Signal,
  Suspense,
  Switch,
  createContext,
  html,
  lazy,
  onCleanup,
  type RenderResult,
} from '../../src';
import { mount } from '../support/mount';
import { settle, settleAsync } from '../support/tick';

let built = 0;
let disposed = 0;

class Heavy extends Component {
  protected setup(): void {
    built++;
    onCleanup(() => disposed++);
  }
  protected render(): RenderResult {
    return html`<p>heavy</p>`;
  }
}

describe('control flow tags in html', () => {
  it('Show builds its children when it shows them, and disposes them', () => {
    built = 0;
    disposed = 0;
    const open = new Signal(false);
    const { root } = mount(
      () =>
        html`<div><${Show} when=${() => open.value}><${Heavy} /></${Show}></div>`
    );
    expect(built).toBe(0);

    open.value = true;
    settle();
    expect(root.textContent).toBe('heavy');
    open.value = false;
    settle();
    expect(disposed).toBe(1);
    open.value = true;
    settle();
    expect(built).toBe(2);
  });

  it('Match builds only the winning branch', () => {
    built = 0;
    const { root } = mount(
      () =>
        html`<div><${Switch}>
          <${Match} when=${() => true}><i>a</i></${Match}>
          <${Match} when=${() => true}><${Heavy} /></${Match}>
        </${Switch}></div>`
    );
    expect(root.textContent?.trim()).toBe('a');
    expect(built).toBe(0);
  });

  it('Suspense shows its fallback for a lazy child', async () => {
    class Page extends Component {
      protected render(): RenderResult {
        return html`<p>page</p>`;
      }
    }
    let resolve!: (module: { default: typeof Page }) => void;
    const LazyPage = lazy(
      () => new Promise<{ default: typeof Page }>((r) => (resolve = r))
    );
    const { root } = mount(
      () =>
        html`<div><${Suspense} fallback=${document.createTextNode('wait')}><${LazyPage} /></${Suspense}></div>`
    );
    expect(root.textContent).toBe('wait');

    resolve({ default: Page });
    await settleAsync();
    expect(root.textContent).toBe('page');
  });

  it('ErrorBoundary catches a child that throws while rendering', () => {
    class Broken extends Component {
      protected render(): RenderResult {
        throw new Error('broken');
      }
    }
    const { root } = mount(
      () =>
        html`<div><${ErrorBoundary} fallback=${() => document.createTextNode('failed')}><${Broken} /></${ErrorBoundary}></div>`
    );
    expect(root.textContent).toBe('failed');
  });

  it('Dynamic gives its children the context of the component it renders', () => {
    const Theme = createContext('default');
    class Provider extends Component<{ children?: unknown }> {
      protected setup(): void {
        Theme.provide(this, 'dark');
      }
      protected render(): RenderResult {
        return html`<section>${this.props.children}</section>`;
      }
    }
    class Consumer extends Component {
      protected render(): RenderResult {
        return html`<p>${Theme.inject(this)}</p>`;
      }
    }
    const { root } = mount(
      () =>
        html`<div><${Dynamic} component=${Provider}><${Consumer} /></${Dynamic}></div>`
    );
    expect(root.textContent).toBe('dark');
  });

  it('keeps a children prop when the tag has no children', () => {
    const { root } = mount(
      () =>
        html`<div>
          <${Show} when=${() => true} children=${() => html`<b>x</b>`} />
        </div>`
    );
    expect(root.textContent).toBe('x');
  });
});
