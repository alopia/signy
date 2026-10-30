/**
 * One contract for the three ways to write a template: `html`, `h()` and
 * compiled JSX. The same UI written each way renders the same markup and
 * updates the same way.
 */

import { describe, it, expect } from 'vitest';
import { Component, Signal, h, html, type RenderResult } from '../../src';
import { mount } from '../support/mount';
import { settle } from '../support/tick';

class Badge extends Component<{ label: string }> {
  protected render(): RenderResult {
    return html`<b>${this.props.label}</b>` as RenderResult;
  }
}

interface State {
  count: Signal<number>;
  show: Signal<boolean>;
  clicks: number[];
}

type Template = (state: State) => unknown;

/** A counter with a reactive attribute, text, conditional markup and a component */
const templates: Array<[string, Template]> = [
  [
    'html',
    (s) => html`
      <div class=${() => (s.count.value > 1 ? 'many' : 'one')}>
        <button onClick=${() => s.clicks.push(s.count.value)}>add</button>
        <span>${() => s.count.value}</span>
        ${() => (s.show.value ? html`<em>shown</em>` : null)}
        <${Badge} label="new" />
      </div>
    `,
  ],
  [
    'h()',
    (s) =>
      h(
        'div',
        { class: () => (s.count.value > 1 ? 'many' : 'one') },
        h('button', { onClick: () => s.clicks.push(s.count.value) }, 'add'),
        h('span', null, () => s.count.value),
        () => (s.show.value ? h('em', null, 'shown') : null),
        h(Badge, { label: 'new' })
      ),
  ],
  [
    'JSX',
    (s) => (
      <div class={s.count.value > 1 ? 'many' : 'one'}>
        <button onClick={() => s.clicks.push(s.count.value)}>add</button>
        <span>{s.count.value}</span>
        {s.show.value ? <em>shown</em> : null}
        <Badge label="new" />
      </div>
    ),
  ],
];

describe.each(templates)('%s template contract', (_name, template) => {
  function setup() {
    const state: State = {
      count: new Signal(1),
      show: new Signal(false),
      clicks: [],
    };
    const { root } = mount(() => template(state) as RenderResult);
    const div = root.querySelector('div')!;
    return { state, root, div };
  }

  it('renders the same structure', () => {
    const { div } = setup();
    expect(div.className).toBe('one');
    expect(div.querySelector('span')!.textContent).toBe('1');
    expect(div.querySelector('em')).toBeNull();
    expect(div.querySelector('b')!.textContent).toBe('new');
  });

  it('updates attributes, text and conditional markup', () => {
    const { state, div } = setup();
    const span = div.querySelector('span')!;

    state.count.value = 2;
    state.show.value = true;
    settle();
    expect(div.className).toBe('many');
    expect(span.textContent).toBe('2');
    expect(div.querySelector('em')!.textContent).toBe('shown');

    state.show.value = false;
    settle();
    expect(div.querySelector('em')).toBeNull();
  });

  it('calls event handlers', () => {
    const { state, div } = setup();
    div.querySelector('button')!.click();
    state.count.value = 5;
    div.querySelector('button')!.click();
    expect(state.clicks).toEqual([1, 5]);
  });
});
