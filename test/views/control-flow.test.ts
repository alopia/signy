/**
 * Tests for control flow primitives
 */

import { describe, it, expect, vi } from 'vitest';
import { within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import {
  Show,
  For,
  Index,
  Portal,
  ErrorBoundary,
  Switch,
  Match,
  Dynamic,
  type DynamicProps,
} from '../../src/views/control-flow';
import { Signal, createRoot, onCleanup } from '../../src/reactivity';
import { createRenderEffect } from '../../src/reactivity/render';
import { scheduleTask } from '../../src/reactivity/signal/internal';
import { html } from '../../src/views/html';
import { insert } from '../../src/views/insert';
import { mount } from '../support/mount';
import { settle } from '../support/tick';
import { expectLogged } from '../support/console';
import { testRoot } from '../support/root';
import { Component } from '../../src/component/component';
import type { RenderResult } from '../../src/types';

describe('Control Flow Primitives', () => {
  describe('Show', () => {
    it('should create a DocumentFragment', () => {
      const result = Show({
        when: true,
        children: document.createElement('div'),
      });
      expect(result).toBeInstanceOf(DocumentFragment);
    });

    it('should contain a comment marker', () => {
      const result = Show({
        when: true,
        children: document.createElement('div'),
      });
      expect(result.firstChild).toBeInstanceOf(Comment);
    });

    it('should accept accessor for when prop', () => {
      const show = new Signal(true);
      const result = Show({
        when: () => show.value,
        children: document.createElement('div'),
      });
      expect(result).toBeInstanceOf(DocumentFragment);
    });

    it('should accept fallback prop', () => {
      const fallback = document.createElement('span');
      fallback.textContent = 'Loading...';

      const result = Show({
        when: false,
        fallback,
        children: document.createElement('div'),
      });
      expect(result).toBeInstanceOf(DocumentFragment);
    });
  });

  describe('For', () => {
    it('should create a DocumentFragment', () => {
      const result = For({
        each: ['a', 'b', 'c'],
        children: (item) => {
          const li = document.createElement('li');
          li.textContent = item;
          return li;
        },
      });
      expect(result).toBeInstanceOf(DocumentFragment);
    });

    it('should contain start and end markers', () => {
      const result = For({
        each: ['a', 'b', 'c'],
        children: () => document.createElement('li'),
      });
      const children = Array.from(result.childNodes);
      expect(children[0]).toBeInstanceOf(Comment);
      expect(children[children.length - 1]).toBeInstanceOf(Comment);
    });

    it('should accept accessor for each prop', () => {
      const items = new Signal(['a', 'b', 'c']);
      const result = For({
        each: () => items.value,
        children: (item) => {
          const li = document.createElement('li');
          li.textContent = item;
          return li;
        },
      });
      expect(result).toBeInstanceOf(DocumentFragment);
    });

    it('should provide index accessor to children', async () => {
      const indices: number[] = [];
      const container = document.createElement('div');

      const fragment = For({
        each: ['a', 'b', 'c'],
        children: (_item, index) => {
          indices.push(index());
          return document.createElement('li');
        },
      });

      container.appendChild(fragment);

      // Wait for microtask to run the render effect
      settle();

      expect(indices).toEqual([0, 1, 2]);
    });

    describe('keyed reconciliation', () => {
      it('should accept key function', () => {
        const items = [
          { id: 1, name: 'A' },
          { id: 2, name: 'B' },
        ];

        const result = For({
          each: items,
          key: (item) => item.id,
          children: (item) => {
            const li = document.createElement('li');
            li.textContent = item.name;
            return li;
          },
        });

        expect(result).toBeInstanceOf(DocumentFragment);
      });

      it('should accept keyBy shorthand', () => {
        const items = [
          { id: 1, name: 'A' },
          { id: 2, name: 'B' },
        ];

        const result = For({
          each: items,
          keyBy: 'id',
          children: (item) => {
            const li = document.createElement('li');
            li.textContent = item.name;
            return li;
          },
        });

        expect(result).toBeInstanceOf(DocumentFragment);
      });

      it('should reuse DOM nodes on reorder with key', async () => {
        const container = document.createElement('div');
        const items = new Signal([
          { id: 1, name: 'A' },
          { id: 2, name: 'B' },
          { id: 3, name: 'C' },
        ]);

        const fragment = For({
          each: () => items.value,
          key: (item) => item.id,
          children: (item) => {
            const li = document.createElement('li');
            li.textContent = item.name;
            li.dataset['id'] = String(item.id);
            return li;
          },
        });

        container.appendChild(fragment);

        // Wait for initial render
        settle();

        // Get original nodes
        const originalNodes = Array.from(container.querySelectorAll('li'));
        const originalNodeById = new Map(
          originalNodes.map((n) => [n.dataset['id'], n])
        );

        expect(originalNodes.length).toBe(3);

        // Reorder items
        items.value = [
          { id: 3, name: 'C' },
          { id: 1, name: 'A' },
          { id: 2, name: 'B' },
        ];

        // Wait for re-render
        settle();

        const newNodes = Array.from(container.querySelectorAll('li'));
        expect(newNodes.length).toBe(3);

        // Nodes should be reused (same instances, just reordered)
        expect(newNodes[0]).toBe(originalNodeById.get('3'));
        expect(newNodes[1]).toBe(originalNodeById.get('1'));
        expect(newNodes[2]).toBe(originalNodeById.get('2'));
      });

      it('should update reactive index on reorder', async () => {
        const container = document.createElement('div');
        const indexValues: Map<number, number[]> = new Map();

        const items = new Signal([
          { id: 1, name: 'A' },
          { id: 2, name: 'B' },
          { id: 3, name: 'C' },
        ]);

        const fragment = For({
          each: () => items.value,
          key: (item) => item.id,
          children: (item, index) => {
            // Track all index values for this item
            if (!indexValues.has(item.id)) {
              indexValues.set(item.id, []);
            }
            indexValues.get(item.id)!.push(index());

            const li = document.createElement('li');
            li.textContent = `${item.name}: ${index()}`;
            return li;
          },
        });

        container.appendChild(fragment);

        // Wait for initial render
        settle();

        // Initial indices
        expect(indexValues.get(1)).toContain(0);
        expect(indexValues.get(2)).toContain(1);
        expect(indexValues.get(3)).toContain(2);
      });

      it('should handle add and remove with key', async () => {
        const container = document.createElement('div');
        const items = new Signal([
          { id: 1, name: 'A' },
          { id: 2, name: 'B' },
        ]);

        const fragment = For({
          each: () => items.value,
          key: (item) => item.id,
          children: (item) => {
            const li = document.createElement('li');
            li.textContent = item.name;
            li.dataset['id'] = String(item.id);
            return li;
          },
        });

        container.appendChild(fragment);

        // Wait for initial render
        settle();

        expect(container.querySelectorAll('li').length).toBe(2);

        // Add item
        items.value = [
          { id: 1, name: 'A' },
          { id: 2, name: 'B' },
          { id: 3, name: 'C' },
        ];

        settle();

        expect(container.querySelectorAll('li').length).toBe(3);

        // Remove item
        items.value = [
          { id: 1, name: 'A' },
          { id: 3, name: 'C' },
        ];

        settle();

        const finalNodes = Array.from(container.querySelectorAll('li'));
        expect(finalNodes.length).toBe(2);
        expect(finalNodes.map((n) => n.dataset['id'])).toEqual(['1', '3']);
      });

      it('should show fallback when list becomes empty with key', async () => {
        const container = document.createElement('div');
        const items = new Signal([{ id: 1, name: 'A' }]);
        const fallback = document.createElement('p');
        fallback.textContent = 'No items';
        fallback.className = 'fallback';

        const fragment = For({
          each: () => items.value,
          key: (item) => item.id,
          fallback,
          children: (item) => {
            const li = document.createElement('li');
            li.textContent = item.name;
            return li;
          },
        });

        container.appendChild(fragment);

        settle();

        expect(container.querySelectorAll('li').length).toBe(1);
        expect(container.querySelector('.fallback')).toBeNull();

        // Empty the list
        items.value = [];

        settle();

        expect(container.querySelectorAll('li').length).toBe(0);
        expect(container.querySelector('.fallback')).not.toBeNull();
      });
    });
  });

  describe('Index', () => {
    it('should create a DocumentFragment', () => {
      const result = Index({
        each: ['a', 'b', 'c'],
        children: (item, index) => {
          const li = document.createElement('li');
          li.textContent = `${index}: ${item()}`;
          return li;
        },
      });
      expect(result).toBeInstanceOf(DocumentFragment);
    });

    it('should provide item accessor to children', async () => {
      const items: string[] = [];
      const container = document.createElement('div');

      const fragment = Index({
        each: ['a', 'b', 'c'],
        children: (item, _index) => {
          items.push(item());
          return document.createElement('li');
        },
      });

      container.appendChild(fragment);

      // Wait for microtask to run the render effect
      settle();

      expect(items).toEqual(['a', 'b', 'c']);
    });
  });

  describe('Portal', () => {
    it('should return a comment marker', () => {
      const content = document.createElement('div');
      content.textContent = 'Portal content';

      const result = testRoot(() =>
        Portal({
          children: content,
        })
      );

      expect(result).toBeInstanceOf(Comment);
    });

    it('should append content to mount target', () => {
      const container = document.createElement('div');
      const content = document.createElement('span');
      content.textContent = 'Portal content';

      testRoot(() =>
        Portal({
          mount: container,
          children: content,
        })
      );

      expect(container.children.length).toBe(1);
      expect(container.firstChild?.textContent).toBe('Portal content');
    });

    it('warns outside an owner, where nothing would remove the content', () => {
      const container = document.createElement('div');
      Portal({ mount: container, children: document.createElement('b') });
      expectLogged('warn', 'reactivity:cleanup-unowned');
    });
  });

  describe('ErrorBoundary', () => {
    it('should create a DocumentFragment', () => {
      const result = ErrorBoundary({
        fallback: (error) => {
          const div = document.createElement('div');
          div.textContent = error.message;
          return div;
        },
        children: document.createElement('div'),
      });
      expect(result).toBeInstanceOf(DocumentFragment);
    });

    it('should contain a comment marker', () => {
      const result = ErrorBoundary({
        fallback: () => document.createElement('div'),
        children: document.createElement('div'),
      });
      expect(result.firstChild).toBeInstanceOf(Comment);
    });

    it('should accept function children', () => {
      const result = ErrorBoundary({
        fallback: () => document.createElement('div'),
        children: () => document.createElement('span'),
      });
      expect(result).toBeInstanceOf(DocumentFragment);
    });
  });
});

describe('Control flow in the DOM', () => {
  const el = (tag: string, text = ''): HTMLElement => {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
  };

  describe('Show', () => {
    it('switches between children and fallback', () => {
      const on = new Signal(false);
      const { root } = mount(
        () =>
          html`<div>
            ${Show({ when: () => on.value, fallback: el('i', 'off'), children: () => el('b', 'on') })}
          </div>`
      );
      expect(root.textContent).toBe('off');

      on.value = true;
      settle();
      expect(root.textContent).toBe('on');

      on.value = false;
      settle();
      expect(root.textContent).toBe('off');
    });

    it('passes the truthy value to a function child', () => {
      const user = new Signal<{ name: string } | null>(null);
      const { root } = mount(
        () =>
          html`<div>
            ${Show({ when: () => user.value, children: (u) => el('b', u.name) })}
          </div>`
      );
      expect(root.textContent).toBe('');

      user.value = { name: 'Ada' };
      settle();
      expect(root.textContent).toBe('Ada');
    });

    it('keeps its place between siblings', () => {
      const on = new Signal(true);
      const { root } = mount(
        () =>
          html`<p>
            a${Show({ when: () => on.value, children: () => el('b', 'X') })}z
          </p>`
      );
      expect(root.textContent).toBe('aXz');

      on.value = false;
      settle();
      on.value = true;
      settle();
      expect(root.textContent).toBe('aXz');
    });
  });

  describe('Switch and Match', () => {
    const status = new Signal<'idle' | 'loading' | 'done'>('idle');
    const render = () =>
      mount(
        () =>
          html`<div>
            ${Switch({
              fallback: el('i', 'idle'),
              children: [
                Match({
                  when: () => status.value === 'loading',
                  children: el('b', 'loading'),
                }),
                Match({
                  when: () => status.value !== 'idle',
                  children: () => el('b', 'done'),
                }),
              ],
            })}
          </div>`
      );

    it('renders the first matching case', () => {
      status.value = 'loading';
      const { root } = render();
      expect(root.textContent).toBe('loading');
    });

    it('falls back when nothing matches, and follows changes', () => {
      status.value = 'idle';
      const { root } = render();
      expect(root.textContent).toBe('idle');

      status.value = 'done';
      settle();
      expect(root.textContent).toBe('done');
    });

    it('passes the matched value to a function child', () => {
      const count = new Signal(0);
      const { root } = mount(
        () =>
          html`<div>
            ${Switch({
              children: [
                Match({
                  when: () => count.value,
                  children: (n) => el('b', `n=${n}`),
                }),
              ],
            })}
          </div>`
      );
      expect(root.textContent).toBe('');

      count.value = 3;
      settle();
      expect(root.textContent).toBe('n=3');
    });
  });

  describe('For', () => {
    it('replaces the fallback when items arrive and restores it when empty', () => {
      const items = new Signal<string[]>([]);
      const { root } = mount(
        () =>
          html`<ul>
            ${For({ each: () => items.value, fallback: el('li', 'none'), children: (i) => el('li', i) })}
          </ul>`
      );
      expect(root.textContent).toBe('none');

      items.value = ['a', 'b'];
      settle();
      expect(root.textContent).toBe('ab');

      items.value = [];
      settle();
      expect(root.textContent).toBe('none');
    });

    it('removes a fallback whose content changed while it was shown', () => {
      const items = new Signal<string[]>([]);
      const ready = new Signal(false);
      const { root } = mount(
        () =>
          html`<ul>
            ${For({
              each: () => items.value,
              fallback: Show({
                when: () => ready.value,
                children: () => el('li', 'none'),
              }),
              children: (i) => el('li', i),
            })}
          </ul>`
      );
      ready.value = true;
      settle();
      expect(root.textContent?.trim()).toBe('none');

      items.value = ['a'];
      settle();
      expect(root.textContent?.trim()).toBe('a');

      items.value = [];
      settle();
      expect(root.textContent?.trim()).toBe('none');
    });

    it.each([
      ['keyed', (i: number) => i],
      ['unkeyed', undefined],
    ])('keeps %s rows live after the list changes', (_name, key) => {
      const items = new Signal([1, 2]);
      const label = new Signal('a');
      const { root } = mount(
        () =>
          html`<ul>
            ${For({
              each: () => items.value,
              ...(key ? { key } : {}),
              children: (i: number) =>
                el('li', '').appendChild(
                  html`<span>${() => `${i}${label.value}`}</span>` as Node
                ).parentNode as HTMLElement,
            })}
          </ul>`
      );

      items.value = [1, 2, 3];
      settle();
      label.value = 'b';
      settle();
      expect(root.textContent).toBe('1b2b3b');
    });

    it('renders a static array', () => {
      const { root } = mount(
        () =>
          html`<ul>
            ${For({ each: ['x', 'y'], children: (i, index) => el('li', `${index()}${i}`) })}
          </ul>`
      );
      expect(root.textContent).toBe('0x1y');
    });
  });

  describe('Index', () => {
    it('renders by position and shows the fallback for an empty list', () => {
      const items = new Signal(['a', 'b']);
      const { root } = mount(
        () =>
          html`<ul>
            ${Index({
              each: () => items.value,
              fallback: el('li', 'none'),
              children: (item, i) =>
                html`<li>${() => `${i}:${item()}`}</li>` as Node,
            })}
          </ul>`
      );
      expect(root.textContent).toBe('0:a1:b');

      items.value = ['c'];
      settle();
      expect(root.textContent).toBe('0:c');

      items.value = [];
      settle();
      expect(root.textContent).toBe('none');
    });
  });

  describe('Portal', () => {
    it('renders into the target', () => {
      const target = document.createElement('div');
      document.body.appendChild(target);

      const { root } = mount(
        () =>
          html`<div>
            ${Portal({ mount: target, children: el('b', 'portal') })}
          </div>`
      );
      expect(target.textContent).toBe('portal');
      expect(root.textContent).toBe('');
    });

    it('removes the content on unmount', () => {
      const target = document.createElement('div');
      document.body.appendChild(target);

      const { root, unmount } = mount(
        () =>
          html`<div>
            ${Portal({ mount: target, children: el('b', 'portal') })}
          </div>`
      );
      expect(target.textContent).toBe('portal');
      expect(root.textContent).toBe('');

      unmount();
      expect(target.textContent).toBe('');
    });

    it('removes the nodes its content added after it rendered', () => {
      const target = document.createElement('div');
      document.body.appendChild(target);
      const open = new Signal(true);
      const items = new Signal<string[]>([]);

      mount(
        () =>
          html`<div>
            ${Show({
              when: () => open.value,
              children: () =>
                Portal({
                  mount: target,
                  children: For({
                    each: () => items.value,
                    children: (i: string) => el('p', i),
                  }),
                }) as unknown as Node,
            })}
          </div>`
      );
      items.value = ['a', 'b'];
      settle();
      expect(target.textContent).toBe('ab');

      open.value = false;
      settle();
      expect(target.childNodes).toHaveLength(0);
    });
  });

  describe('ErrorBoundary', () => {
    it('shows the fallback with the error, and reset renders again', async () => {
      let fail = true;
      const { root } = mount(
        () =>
          html`<div>
            ${ErrorBoundary({
              fallback: (error, reset) => {
                const button = el('button', `failed: ${error.message}`);
                button.addEventListener('click', reset);
                return button;
              },
              children: () => {
                if (fail) throw new Error('boom');
                return el('b', 'ok');
              },
            })}
          </div>`
      );
      expect(root.textContent).toBe('failed: boom');

      fail = false;
      await userEvent.click(within(root).getByRole('button'));
      expect(root.textContent).toBe('ok');
    });

    it('wraps non-Error throws', () => {
      const { root } = mount(
        () =>
          html`<div>
            ${ErrorBoundary({
              fallback: (error) =>
                el('i', `${error instanceof Error}:${error.message}`),
              children: () => {
                throw 'plain';
              },
            })}
          </div>`
      );
      expect(root.textContent).toBe('true:plain');
    });
  });
});

describe('Control flow branches', () => {
  const node = (r: unknown) => (Array.isArray(r) ? r[0] : r) as Node;
  const el = (tag: string, text = ''): HTMLElement => {
    const n = document.createElement(tag);
    n.textContent = text;
    return n;
  };

  it('Show keeps the same DOM while the truthy value is the same', () => {
    const count = new Signal(1);
    let renders = 0;
    const { root } = mount(
      () =>
        html`<div>
          ${Show({
            when: () => count.value > 0,
            children: () => {
              renders++;
              return document.createElement('input');
            },
          })}
        </div>`
    );
    const input = root.querySelector('input');

    count.value = 2;
    settle();
    count.value = 3;
    settle();

    expect(renders).toBe(1);
    expect(root.querySelector('input')).toBe(input);
  });

  it('Show renders children untracked, bindings inside still update', () => {
    const label = new Signal('a');
    let renders = 0;
    const { root } = mount(
      () =>
        html`<div>
          ${Show({
            when: true,
            children: () => {
              renders++;
              void label.value;
              return node(html`<b>${() => label.value}</b>`);
            },
          })}
        </div>`
    );

    label.value = 'b';
    settle();
    expect(renders).toBe(1);
    expect(root.textContent).toBe('b');
  });

  it('Show re-renders when the truthy value changes identity', () => {
    const user = new Signal({ name: 'Ada' });
    const { root } = mount(
      () =>
        html`<div>
          ${Show({
            when: () => user.value,
            children: (u: { name: string }) => node(html`<b>${u.name}</b>`),
          })}
        </div>`
    );

    user.value = { name: 'Grace' };
    settle();
    expect(root.textContent).toBe('Grace');
  });

  it('Show reuses a node child after hiding it, with its listeners', async () => {
    const on = new Signal(true);
    const onClick = vi.fn();
    const button = node(html`<button onClick=${onClick}>x</button>`);
    const { root } = mount(
      () => html`<div>${Show({ when: () => on.value, children: button })}</div>`
    );

    on.value = false;
    settle();
    expect(root.querySelector('button')).toBeNull();

    on.value = true;
    settle();
    expect(root.querySelector('button')).toBe(button);
    await userEvent.click(button as Element);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('Show shows a fragment fallback again after hiding it', () => {
    const on = new Signal(false);
    const fallback = document.createDocumentFragment();
    fallback.append(el('i', 'a'), el('i', 'b'));
    const { root } = mount(
      () =>
        html`<div>
          ${Show({ when: () => on.value, fallback, children: () => el('b') })}
        </div>`
    );

    on.value = true;
    settle();
    on.value = false;
    settle();
    expect(root.textContent).toBe('ab');
  });

  it('Switch keeps the branch while the same case matches', () => {
    const count = new Signal(1);
    let renders = 0;
    mount(
      () =>
        html`<div>
          ${Switch({
            children: [
              Match({
                when: () => count.value > 0,
                children: () => {
                  renders++;
                  return el('b');
                },
              }),
            ],
          })}
        </div>`
    );

    count.value = 5;
    settle();
    expect(renders).toBe(1);
  });

  it('Index keeps its rows and updates the item binding', () => {
    const items = new Signal(['a', 'b']);
    let renders = 0;
    const { root } = mount(
      () =>
        html`<ul>
          ${Index({
            each: () => items.value,
            children: (item: () => string) => {
              renders++;
              return node(html`<li>${() => item()}</li>`);
            },
          })}
        </ul>`
    );
    const firstRow = root.querySelector('li');

    items.value = ['c', 'b', 'd'];
    settle();

    expect(root.textContent).toBe('cbd');
    expect(root.querySelector('li')).toBe(firstRow);
    expect(renders).toBe(3);
  });

  it('ErrorBoundary disposes the failed branch on reset', () => {
    const label = new Signal('x');
    let fail = true;
    let reset!: () => void;
    mount(
      () =>
        html`<div>
          ${ErrorBoundary({
            fallback: (_e, r) => {
              reset = r;
              return node(html`<i>${() => label.value}</i>`);
            },
            children: () => {
              if (fail) throw new Error('boom');
              return el('b');
            },
          })}
        </div>`
    );
    expect(label.subscriberCount).toBe(1);

    fail = false;
    reset();
    expect(label.subscriberCount).toBe(0);
  });

  it('renders synchronously, no settle needed after mount', () => {
    const { root } = mount(
      () =>
        html`<div>
          ${Show({ when: true, children: () => el('b', 'now') })}
          <ul>
            ${For({ each: [1, 2], children: (i: number) => el('li', String(i)) })}
          </ul>
        </div>`
    );
    expect(root.textContent).toBe('now12');
  });
});

describe('For keys', () => {
  it('keys rows by item without a key, so appending builds one row', () => {
    const items = new Signal(['a', 'b']);
    let renders = 0;
    const { root } = mount(() =>
      For({
        each: () => items.value,
        children: (item) => {
          renders++;
          return html`<li>${item}</li>` as Node;
        },
      })
    );
    expect(renders).toBe(2);

    items.value = [...items.value, 'c'];
    settle();
    expect(renders).toBe(3);
    expect(root.textContent).toBe('abc');
  });

  it('places rows correctly around a row that renders nothing', () => {
    const items = new Signal([1, 2]);
    const { root } = mount(() =>
      For({
        each: () => items.value,
        children: (n) =>
          n === 1
            ? document.createDocumentFragment()
            : (html`<i>${n}</i>` as Node),
      })
    );

    items.value = [1, 3, 2];
    settle();
    expect(root.textContent).toBe('32');
  });

  it('renders duplicate keys in their own rows and warns', () => {
    const items = new Signal([
      { id: 1, t: 'a' },
      { id: 2, t: 'b' },
    ]);
    const { root } = mount(() =>
      For({
        each: () => items.value,
        key: (item) => item.id,
        children: (item) => html`<i>${item.t}</i>` as Node,
      })
    );

    items.value = [
      { id: 2, t: 'b' },
      { id: 1, t: 'a' },
      { id: 1, t: 'c' },
    ];
    settle();
    expectLogged('warn', 'view:duplicate-key');
    expect(root.querySelectorAll('i').length).toBe(3);
  });

  it('renders duplicate items without a key', () => {
    const items = new Signal(['x', 'y']);
    const { root } = mount(() =>
      For({
        each: () => items.value,
        children: (item) => html`<i>${item}</i>` as Node,
      })
    );
    items.value = ['y', 'x', 'x', 'y'];
    settle();
    expect(root.textContent).toBe('yxxy');
  });
});

describe('ErrorBoundary after the first render', () => {
  it('skips a scheduled fallback once the boundary is disposed', () => {
    const value = new Signal(1);
    const fallback = vi.fn(() => document.createTextNode('failed'));
    const dispose = createRoot((d) => {
      ErrorBoundary({
        fallback,
        children: () =>
          html`<p>
            ${() => {
              if (value.value === 2) throw new Error('two');
              return value.value;
            }}
          </p>` as Node,
      });
      return d;
    });

    value.value = 2;
    // Runs after the failing binding, before the fallback it schedules
    scheduleTask(dispose);
    settle();
    expect(fallback).not.toHaveBeenCalled();
  });

  it('shows the fallback when a binding throws later, and reset recovers', () => {
    const value = new Signal(1);
    const { root } = mount(() =>
      ErrorBoundary({
        fallback: (error, reset) => {
          const button = document.createElement('button');
          button.textContent = `failed: ${error.message}`;
          button.addEventListener('click', () => {
            value.value = 3;
            reset();
          });
          return button;
        },
        children: () =>
          html`<p>
            ${() => {
              if (value.value === 2) throw new Error('two');
              return value.value;
            }}
          </p>` as Node,
      })
    );
    expect(root.textContent).toBe('1');

    value.value = 2;
    settle();
    expect(root.textContent).toBe('failed: two');

    root.querySelector('button')!.click();
    settle();
    expect(root.textContent).toBe('3');
  });

  it('catches a later error inside a child component', () => {
    const value = new Signal(1);

    class Risky extends Component {
      protected render(): RenderResult {
        return html`<i
          >${() => {
            if (value.value === 2) throw new Error('inner');
            return value.value;
          }}</i
        >` as RenderResult;
      }
    }

    const { root } = mount(() =>
      ErrorBoundary({
        fallback: (error) => document.createTextNode(`caught ${error.message}`),
        children: () => html`<${Risky} />` as Node,
      })
    );

    value.value = 2;
    settle();
    expect(root.textContent).toBe('caught inner');
  });
});

describe('For rows and their owner', () => {
  it('disposes every row on unmount and keeps the other children of the owner', () => {
    const items = new Signal([1, 2, 3]);
    const label = new Signal('a');
    let siblingRuns = 0;
    let rowRuns = 0;
    const dispose = createRoot((dispose) => {
      createRenderEffect(() => {
        siblingRuns++;
        return label.value;
      });
      const parent = document.createElement('ul');
      parent.appendChild(
        For({
          each: () => items.value,
          children: (i: number) =>
            html`<li>${() => (rowRuns++, `${i}${label.value}`)}</li>` as Node,
        })
      );
      document.body.appendChild(parent);
      settle();
      return () => {
        dispose();
        parent.remove();
      };
    });

    items.value = [1, 2];
    settle();
    siblingRuns = 0;
    rowRuns = 0;
    label.value = 'b';
    settle();
    expect(siblingRuns).toBe(1);
    expect(rowRuns).toBe(2);

    dispose();
    rowRuns = 0;
    label.value = 'c';
    settle();
    expect(rowRuns).toBe(0);
  });

  it('clears a list that owns its parent and renders into it again', () => {
    const items = new Signal([1, 2, 3]);
    const label = new Signal('a');
    let rowRuns = 0;
    const { root } = mount(
      () =>
        html`<ul>
          ${For({
            each: () => items.value,
            children: (i: number) =>
              html`<li>${() => (rowRuns++, `${i}${label.value}`)}</li>` as Node,
          })}
        </ul>`
    );

    items.value = [];
    settle();
    expect(root.querySelectorAll('li')).toHaveLength(0);
    rowRuns = 0;
    label.value = 'b';
    settle();
    expect(rowRuns).toBe(0);

    items.value = [4, 5];
    settle();
    expect(root.textContent).toBe('4b5b');
  });

  it('clears a list that shares its parent without touching the siblings', () => {
    const items = new Signal([1, 2]);
    const { root } = mount(
      () =>
        html`<ul>
          <li>first</li>
          ${For({
            each: () => items.value,
            children: (i: number) => html`<li>${i}</li>` as Node,
          })}
          <li>last</li>
        </ul>`
    );

    items.value = [];
    settle();
    expect(root.textContent).toBe('firstlast');
  });

  it('replaces every row of a list that owns its parent, disposing the old ones', () => {
    const items = new Signal([1, 2, 3]);
    const label = new Signal('a');
    const disposed: number[] = [];
    let rowRuns = 0;
    const { root } = mount(
      () =>
        html`<ul>
          ${For({
            each: () => items.value,
            children: (i: number) => {
              onCleanup(() => disposed.push(i));
              return html`<li>
                ${() => (rowRuns++, `${i}${label.value}`)}
              </li>` as Node;
            },
          })}
        </ul>`
    );

    items.value = [4, 5];
    settle();
    expect(root.textContent).toBe('4a5a');
    expect(disposed).toEqual([1, 2, 3]);

    rowRuns = 0;
    label.value = 'b';
    settle();
    expect(rowRuns).toBe(2);

    // The markers survive, so the list still updates in place
    items.value = [6, 4, 5];
    settle();
    expect(root.textContent).toBe('6b4b5b');
    expect(root.querySelectorAll('li')).toHaveLength(3);
  });

  it('replaces every row of a list that shares its parent without touching the siblings', () => {
    const items = new Signal([1, 2]);
    const { root } = mount(
      () =>
        html`<ul>
          <li>first</li>
          ${For({
            each: () => items.value,
            children: (i: number) => html`<li>${i}</li>` as Node,
          })}
          <li>last</li>
        </ul>`
    );

    items.value = [3, 4];
    settle();
    expect(root.textContent).toBe('first34last');
  });

  it('keeps a row that stays in a list where every other row is replaced', () => {
    const items = new Signal([1, 2, 3]);
    const { root } = mount(
      () =>
        html`<ul>
          ${For({
            each: () => items.value,
            children: (i: number) => html`<li>${i}</li>` as Node,
          })}
        </ul>`
    );
    const two = root.querySelectorAll('li')[1];

    items.value = [4, 2, 5];
    settle();
    expect(root.textContent).toBe('425');
    expect(root.querySelectorAll('li')[1]).toBe(two);
  });
});

describe('For rows made of several nodes', () => {
  const rowsOf = (items: Signal<string[]>, row: (label: string) => unknown) =>
    mount(
      () =>
        html`<ul>
          ${For({ each: () => items.value, children: row as never })}
        </ul>`
    ).root.querySelector('ul')!;

  it('moves and removes what a Show inserted after its marker', () => {
    const items = new Signal(['a', 'b']);
    const flag = new Signal(false);
    const ul = rowsOf(items, (label) => {
      const fragment = document.createDocumentFragment();
      fragment.append(label);
      fragment.append(
        Show({
          when: () => flag.value,
          children: () => document.createTextNode(`${label}!`),
        })
      );
      return fragment;
    });

    flag.value = true;
    settle();
    expect(ul.textContent!.replace(/\s/g, '')).toBe('aa!bb!');

    items.value = ['b', 'a'];
    settle();
    expect(ul.textContent!.replace(/\s/g, '')).toBe('bb!aa!');

    items.value = ['a'];
    settle();
    expect(ul.textContent!.replace(/\s/g, '')).toBe('aa!');
  });

  it('renders a row that is an html template with several roots', () => {
    const items = new Signal(['a', 'b']);
    const ul = rowsOf(items, (label) => html`<b>${label}</b><i>-</i>`);
    expect(ul.innerHTML.replace(/<!--[^>]*-->|\s/g, '')).toBe(
      '<b>a</b><i>-</i><b>b</b><i>-</i>'
    );
    items.value = ['b'];
    settle();
    expect(ul.innerHTML.replace(/<!--[^>]*-->|\s/g, '')).toBe(
      '<b>b</b><i>-</i>'
    );
  });

  describe('Dynamic', () => {
    class Greeting extends Component<{ name: string }> {
      protected render(): RenderResult {
        return html`<p>Hi ${this.props.name}</p>`;
      }
    }

    class Farewell extends Component<{ name: string }> {
      protected render(): RenderResult {
        return html`<p>Bye ${this.props.name}</p>`;
      }
    }

    const show = (component: unknown, props: Record<string, unknown> = {}) =>
      mount(
        () => Dynamic({ component, ...props } as DynamicProps) as RenderResult
      ).root;

    it('renders a tag with props and children', () => {
      const root = show('h2', { class: 'title', children: ['Hello'] });
      expect(root.querySelector('h2.title')!.textContent).toBe('Hello');
    });

    it('renders a component class with props', () => {
      const root = show(Greeting, { name: 'Ada' });
      expect(root.textContent).toBe('Hi Ada');
    });

    it('does not read a component class as an accessor', () => {
      const constructed = vi.fn();
      class Probe extends Component {
        constructor(...args: ConstructorParameters<typeof Component>) {
          super(...args);
          constructed();
        }
        protected render(): RenderResult {
          return html`<i>probe</i>`;
        }
      }
      show(Probe);
      expect(constructed).toHaveBeenCalledOnce();
    });

    it('swaps when the accessor changes', () => {
      const view = new Signal<unknown>(Greeting);
      const root = show(() => view.value, { name: 'Ada' });
      expect(root.textContent).toBe('Hi Ada');
      view.value = Farewell;
      settle();
      expect(root.textContent).toBe('Bye Ada');
      view.value = 'section';
      settle();
      expect(root.querySelector('section')).not.toBeNull();
      expect(root.querySelector('p')).toBeNull();
    });

    it('renders nothing for null and shows it again later', () => {
      const view = new Signal<unknown>(null);
      const root = show(() => view.value, { name: 'Ada' });
      expect(root.textContent).toBe('');
      view.value = Greeting;
      settle();
      expect(root.textContent).toBe('Hi Ada');
      view.value = undefined;
      settle();
      expect(root.textContent).toBe('');
    });

    it('keeps the same node when the accessor returns the same target', () => {
      const tick = new Signal(0);
      const root = show(() => (tick.value >= 0 ? 'b' : 'i'));
      const first = root.querySelector('b');
      tick.value = 1;
      settle();
      expect(root.querySelector('b')).toBe(first);
    });

    it('renders a function component returned by an accessor', () => {
      const Plain = (props: { children?: unknown }) =>
        html`<em>${props.children as string}</em>`;
      const root = show(() => Plain, { children: ['plain'] });
      expect(root.querySelector('em')!.textContent).toBe('plain');
    });

    it('disposes the old branch when it swaps', () => {
      const cleaned = vi.fn();
      class Tracked extends Component {
        protected setup(): void {
          this.onUnmount(cleaned);
        }
        protected render(): RenderResult {
          return html`<b>tracked</b>`;
        }
      }
      const view = new Signal<unknown>(Tracked);
      show(() => view.value);
      view.value = 'span';
      settle();
      expect(cleaned).toHaveBeenCalledOnce();
    });

    it('keeps reactive function props reactive on a tag', () => {
      const label = new Signal('a');
      const root = show('p', { title: () => label.value });
      expect(root.querySelector('p')!.title).toBe('a');
      label.value = 'b';
      settle();
      expect(root.querySelector('p')!.title).toBe('b');
    });

    it('recognizes a class from another copy of signy by its render method', () => {
      const constructed = vi.fn();
      class Foreign {
        constructor() {
          constructed();
        }
        render(): Node {
          return document.createElement('u');
        }
        _renderAsChild(): Node {
          return this.render();
        }
      }
      const root = show(Foreign);
      expect(constructed).toHaveBeenCalledOnce();
      expect(root.querySelector('u')).not.toBeNull();
    });

    it('warns and renders nothing when the component is not a tag or a function', () => {
      const root = show(() => document.createElement('em'));
      expect(root.querySelector('em')).toBeNull();
      expectLogged('warn', 'view:invalid-dynamic');
    });

    it('works as a tag in html', () => {
      const view = new Signal<unknown>('h3');
      const root = mount(
        () =>
          html`<${Dynamic} component=${() => view.value} class="x">Hi</${Dynamic}>` as RenderResult
      ).root;
      expect(root.querySelector('h3.x')!.textContent).toBe('Hi');
      view.value = 'h4';
      settle();
      expect(root.querySelector('h4.x')!.textContent).toBe('Hi');
      expect(root.querySelector('h3')).toBeNull();
    });
  });
});

describe('Control flow with a value at the top of an html template', () => {
  it('renders it in a For row and keeps it reactive', () => {
    const label = new Signal('a');
    const { root } = mount(
      () =>
        html`<ul>
          ${For({
            each: () => [1],
            children: (i) => html`<i>${i}</i>${() => label.value}` as Node,
          })}
        </ul>`
    );
    expect(root.textContent?.trim()).toBe('1a');

    label.value = 'b';
    settle();
    expect(root.textContent?.trim()).toBe('1b');
  });

  it('renders it in Show, Switch, Index and ErrorBoundary', () => {
    const tail = () => html`<i>x</i>${() => 'y'}` as Node;
    const { root } = mount(
      () =>
        html`<div>
          ${Show({ when: () => true, children: tail })}
          ${Switch({ children: [Match({ when: () => true, children: tail })] })}
          ${Index({ each: () => [1], children: tail })}
          ${ErrorBoundary({ fallback: () => html`<p>err</p>` as Node, children: tail })}
        </div>`
    );
    expect(root.textContent?.replace(/\s/g, '')).toBe('xyxyxyxy');
  });

  it('renders it in a Portal', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const { unmount } = mount(
      () =>
        html`<div>
          ${Portal({ mount: target, children: html`<i>x</i>${() => 'y'}` as Node })}
        </div>`
    );
    expect(target.textContent).toBe('xy');
    unmount();
    expect(target.textContent).toBe('');
    target.remove();
  });
});

describe('Control flow branches whose top level changes', () => {
  /** A fragment whose only node is a binding that swaps an element */
  const swapping = (on: Signal<boolean>) => (): Node => {
    const fragment = document.createDocumentFragment();
    insert(fragment, () => (on.value ? html`<i>a</i>` : html`<b>b</b>`));
    return fragment;
  };

  it('Show removes what the branch swapped in', () => {
    const show = new Signal(true);
    const on = new Signal(true);
    const { root } = mount(
      () =>
        html`<div>
          ${Show({ when: () => show.value, children: swapping(on) })}
        </div>`
    );
    on.value = false;
    settle();
    expect(root.textContent).toBe('b');

    show.value = false;
    settle();
    expect(root.textContent).toBe('');
  });

  it('Switch and Index remove it too', () => {
    const on = new Signal(true);
    const when = new Signal(true);
    const items = new Signal([1, 2]);
    const { root } = mount(
      () =>
        html`<div>
          <p>
            ${Switch({ children: [Match({ when: () => when.value, children: swapping(on) })] })}
          </p>
          <ul>
            ${Index({ each: () => items.value, children: swapping(on) })}
          </ul>
        </div>`
    );
    on.value = false;
    settle();
    expect(root.querySelector('p')!.textContent).toBe('b');
    expect(root.querySelector('ul')!.textContent).toBe('bb');

    when.value = false;
    items.value = [];
    settle();
    expect(root.querySelector('p')!.textContent).toBe('');
    expect(root.querySelector('ul')!.textContent).toBe('');
  });

  it('shows a static fragment again with what it holds now', () => {
    const show = new Signal(true);
    const on = new Signal(true);
    const fragment = swapping(on)();
    const { root } = mount(
      () =>
        html`<div>${Show({ when: () => show.value, children: fragment })}</div>`
    );
    show.value = false;
    settle();
    show.value = true;
    settle();
    expect(root.textContent).toBe('a');
  });
});

describe('Show with static content of several roots', () => {
  it('keeps a nested Show working when the branch renders again', () => {
    const count = new Signal(1);
    const bad = new Signal(false);
    const { root } = mount(
      () =>
        html`<div>
          ${Show({
            when: () => count.value,
            children: html`<p>cart</p>
              ${Show({ when: () => bad.value, children: html`<i>warning</i>` as Node })}` as Node,
          })}
        </div>`
    );
    count.value = 2;
    settle();
    bad.value = true;
    settle();
    expect(root.querySelector('i')?.textContent).toBe('warning');
  });
});
