/**
 * One contract for every way to render a list: For keyed by `key`, by
 * `keyBy` or by item, and mapByItem and mapByIndex underneath.
 */

import { describe, it, expect } from 'vitest';
import { For } from '../../src/views/control-flow';
import { html } from '../../src/views/html';
import { Signal, effect, mapByItem, mapByIndex } from '../../src/reactivity';
import type { Accessor } from '../../src/reactivity';
import { mount } from '../support/mount';
import { settle } from '../support/tick';
import { testRoot } from '../support/root';

interface Item {
  id: number;
  label: string;
}

const item = (id: number): Item => ({ id, label: `item ${id}` });

type ForVariant = Pick<Parameters<typeof For<Item>>[0], 'key' | 'keyBy'>;

const forVariants: Array<[string, ForVariant]> = [
  ['key', { key: (i) => i.id }],
  ['keyBy', { keyBy: 'id' }],
  ['item identity', {}],
];

describe.each(forVariants)('For keyed by %s', (_name, keying) => {
  function setup(initial: Item[]) {
    const items = new Signal(initial);
    const { root } = mount(() =>
      For<Item>({
        each: () => items.value,
        ...keying,
        fallback: html`<p>empty</p>` as Node,
        children: (it, index) =>
          html`<li>${() => index()}:${it.label}</li>` as Node,
      })
    );
    const rows = () => Array.from(root.querySelectorAll('li'));
    const text = () => rows().map((li) => li.textContent);
    return { items, root, rows, text };
  }

  it('renders the items in order with their index', () => {
    const { text } = setup([item(1), item(2)]);
    expect(text()).toEqual(['0:item 1', '1:item 2']);
  });

  it('keeps the rows of items that stay, through append, remove and reorder', () => {
    const a = item(1);
    const b = item(2);
    const c = item(3);
    const { items, rows, text } = setup([a, b]);
    const [rowA, rowB] = rows();

    items.value = [a, b, c];
    settle();
    expect(rows()[0]).toBe(rowA);
    expect(rows()[1]).toBe(rowB);

    items.value = [c, a];
    settle();
    expect(text()).toEqual(['0:item 3', '1:item 1']);
    expect(rows()[1]).toBe(rowA);
  });

  it('shows the fallback when empty, and rows again after', () => {
    const { items, root, text } = setup([item(1)]);
    items.value = [];
    settle();
    expect(root.textContent).toBe('empty');

    items.value = [item(4)];
    settle();
    expect(text()).toEqual(['0:item 4']);
    expect(root.querySelector('p')).toBeNull();
  });
});

/** Rows are label readers: mapByIndex keeps a row per position and swaps its item */
type Mapper = (
  list: Accessor<readonly Item[]>
) => Accessor<Array<() => string>>;

const mappers: Array<[string, Mapper]> = [
  ['mapByItem', (list) => mapByItem(list, (i) => () => i.label)],
  ['mapByIndex', (list) => mapByIndex(list, (i) => () => i().label)],
];

describe.each(mappers)('%s contract', (_name, map) => {
  it('maps the current list through any sequence of changes', () => {
    const list = new Signal<Item[]>([item(1), item(2)]);
    let latest: string[] = [];
    testRoot(() => {
      const mapped = map(() => list.value);
      effect(() => {
        latest = mapped().map((row) => row());
      });
    });
    settle();
    expect(latest).toEqual(['item 1', 'item 2']);

    const changes: Item[][] = [
      [item(1), item(2), item(3)],
      [item(3), item(1)],
      [],
      [item(5)],
    ];
    for (const next of changes) {
      list.value = next;
      settle();
      expect(latest).toEqual(next.map((i) => i.label));
    }
  });
});
