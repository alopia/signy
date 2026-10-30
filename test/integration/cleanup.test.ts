/**
 * After unmount, nothing a component created should keep running.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  Component,
  Signal,
  Show,
  For,
  effect,
  onCleanup,
  html,
  type RenderResult,
} from '../../src';
import { mount } from '../support/mount';
import { settle } from '../support/tick';

describe('cleanup on unmount', () => {
  it('disposes effects created in setup', () => {
    const count = new Signal(0);
    const run = vi.fn();
    class Watcher extends Component {
      protected setup(): void {
        effect(() => run(count.value));
      }
      protected render(): RenderResult {
        return null;
      }
    }

    const { unmount } = mount(Watcher);
    settle();
    run.mockClear();

    unmount();
    count.value = 1;
    settle();
    expect(run).not.toHaveBeenCalled();
  });

  it('runs onCleanup of nested children', () => {
    const cleaned: string[] = [];
    class Leaf extends Component<{ name: string }> {
      protected setup(): void {
        onCleanup(() => cleaned.push(this.props.name));
      }
      protected render(): RenderResult {
        return html`<i>${this.props.name}</i>`;
      }
    }
    class Branch extends Component {
      protected render(): RenderResult {
        return html`<div><${Leaf} name="a" /><${Leaf} name="b" /></div>`;
      }
    }

    const { unmount } = mount(() => html`<section><${Branch} /></section>`);
    unmount();
    expect(cleaned.sort()).toEqual(['a', 'b']);
  });

  it('stops template bindings and control flow', () => {
    const count = new Signal(0);
    const calls = { text: 0, show: 0, list: 0 };
    const { unmount } = mount(
      () =>
        html`<div>
          <p>
            ${() => {
              calls.text++;
              return count.value;
            }}
          </p>
          ${Show({
            when: () => {
              calls.show++;
              return count.value >= 0;
            },
            children: () => document.createElement('b'),
          })}
          <ul>
            ${For({
              each: () => {
                calls.list++;
                return [count.value];
              },
              children: () => document.createElement('li'),
            })}
          </ul>
        </div>`
    );
    const before = { ...calls };

    unmount();
    count.value = 1;
    settle();
    expect(calls).toEqual(before);
  });
});
