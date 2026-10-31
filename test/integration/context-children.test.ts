/**
 * A component passed as a child sees the context of the component it is
 * passed to, and belongs to it.
 */

import { describe, it, expect } from 'vitest';
import {
  Component,
  Signal,
  Show,
  createContext,
  h,
  html,
  onCleanup,
  type RenderResult,
} from '../../src';
import { mount } from '../support/mount';
import { settle } from '../support/tick';

const Theme = createContext('default', 'Theme');

class Provider extends Component<{ children?: unknown }> {
  protected setup(): void {
    Theme.provide(this, 'dark');
  }
  protected render(): RenderResult {
    return html`<section>${this.props.children}</section>`;
  }
}

let cleanups = 0;

class Consumer extends Component {
  protected setup(): void {
    onCleanup(() => cleanups++);
  }
  protected render(): RenderResult {
    return html`<p>${Theme.inject(this)}</p>`;
  }
}

describe('context through children', () => {
  it('reaches a component child in html', () => {
    const { root } = mount(
      () => html`<${Provider}><${Consumer} /></${Provider}>`
    );
    expect(root.textContent).toBe('dark');
  });

  it('reaches a component nested in an element child in html', () => {
    const { root } = mount(
      () =>
        html`<div>
          <${Provider}><div><${Consumer} /></div></${Provider}>
        </div>`
    );
    expect(root.querySelector('section p')!.textContent).toBe('dark');
  });

  it('reaches a function child of h()', () => {
    const { root } = mount(() => h(Provider, null, () => h(Consumer, null)));
    expect(root.textContent).toBe('dark');
  });

  it('keeps a reactive child of a component in html', () => {
    const label = new Signal('a');
    const { root } = mount(
      () => html`<${Provider}><i>${() => label.value}</i></${Provider}>`
    );
    label.value = 'b';
    settle();
    expect(root.textContent).toBe('b');
  });

  it('disposes the child with the component it was passed to', () => {
    cleanups = 0;
    const show = new Signal(true);
    mount(
      () =>
        html`<div>
          ${Show({
            when: () => show.value,
            children: () =>
              html`<${Provider}><${Consumer} /></${Provider}>` as Node,
          })}
        </div>`
    );
    show.value = false;
    settle();
    expect(cleanups).toBe(1);
  });
});
