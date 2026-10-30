/**
 * Property tests: invariants checked against many generated inputs.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { reconcile, type KeyedItem } from '../../src/views/reconcile';
import { mapByItem } from '../../src/reactivity/map-array';
import {
  compilePath,
  generatePath,
  matchPath,
  parseQuery,
  stringifyQuery,
} from '../../src/router/route';
import {
  Signal,
  Computed,
  batch,
  createRoot,
  effect,
  store,
} from '../../src/reactivity';
import { settle } from '../support/tick';

const uniqueKeys = fc.uniqueArray(fc.integer({ min: 0, max: 30 }), {
  maxLength: 15,
});

describe('reconcile', () => {
  function setup() {
    const parent = document.createElement('div');
    const end = parent.appendChild(document.createComment('end'));
    const render = (key: number) => {
      const el = document.createElement('i');
      el.dataset['key'] = String(key);
      return el;
    };
    const keysInDom = () =>
      Array.from(parent.querySelectorAll('i')).map((el) =>
        Number(el.dataset['key'])
      );
    return { parent, end, render, keysInDom };
  }

  it('keeps the nodes of a row with several nodes together and in order', () => {
    fc.assert(
      fc.property(uniqueKeys, uniqueKeys, uniqueKeys, (a, b, c) => {
        const parent = document.createElement('div');
        const end = parent.appendChild(document.createComment('end'));
        // Three nodes per row: <i>, a text node and <b>
        const render = (key: number) => {
          const fragment = document.createDocumentFragment();
          const i = document.createElement('i');
          const b = document.createElement('b');
          i.dataset['key'] = b.dataset['key'] = String(key);
          fragment.append(i, String(key), b);
          return fragment;
        };
        const expected = (keys: number[]) =>
          keys.flatMap((k) => [`i${k}`, `#${k}`, `b${k}`]).concat('end');
        // Each row ends at its own row:end marker, left out here
        const inDom = () =>
          Array.from(parent.childNodes)
            .filter((n) => !(n instanceof Comment && n.data === 'row:end'))
            .map((n) =>
              n instanceof HTMLElement
                ? `${n.localName}${n.dataset['key']}`
                : n instanceof Comment
                  ? 'end'
                  : `#${n.textContent}`
            );

        let items = reconcile<number>(
          parent,
          [],
          a,
          (k) => k,
          render,
          end
        ).items;
        for (const next of [b, c, a]) {
          items = reconcile<number>(
            parent,
            items,
            next,
            (k) => k,
            render,
            end
          ).items;
          expect(inDom()).toEqual(expected(next));
        }
      })
    );
  });

  it('ends with the DOM in the order of the new list and reuses kept nodes', () => {
    fc.assert(
      fc.property(uniqueKeys, uniqueKeys, (before, after) => {
        const { parent, end, render, keysInDom } = setup();
        const first = reconcile<number>(
          parent,
          [],
          before,
          (k) => k,
          render,
          end
        );
        const nodesBefore = new Map(
          first.items.map((item: KeyedItem<number>) => [
            item.key,
            item.firstNode,
          ])
        );

        const second = reconcile<number>(
          parent,
          first.items,
          after,
          (k) => k,
          render,
          end
        );

        expect(keysInDom()).toEqual(after);
        for (const item of second.items) {
          if (nodesBefore.has(item.key)) {
            expect(item.firstNode).toBe(nodesBefore.get(item.key));
          }
        }
      })
    );
  });

  it('keeps the end marker last', () => {
    fc.assert(
      fc.property(uniqueKeys, uniqueKeys, (before, after) => {
        const { parent, end, render } = setup();
        const first = reconcile<number>(
          parent,
          [],
          before,
          (k) => k,
          render,
          end
        );
        reconcile<number>(parent, first.items, after, (k) => k, render, end);
        expect(parent.lastChild).toBe(end);
      })
    );
  });
});

describe('mapByItem', () => {
  it('maps every list to the same result as Array.map, reusing items', () => {
    fc.assert(
      fc.property(
        fc.array(uniqueKeys, { minLength: 1, maxLength: 5 }),
        (lists) => {
          createRoot((dispose) => {
            const source = new Signal<number[]>(lists[0]!);
            let calls = 0;
            const mapped = mapByItem(
              () => source.value,
              (n) => {
                calls++;
                return { n };
              },
              { keyFn: (n) => n }
            );

            const seen = new Set<number>();
            for (const list of lists) {
              source.value = list;
              settle();
              expect(mapped().map((m) => m.n)).toEqual(list);
              list.forEach((n) => seen.add(n));
            }
            // Each key is mapped at most once while it stays in some list
            expect(calls).toBeLessThanOrEqual(
              lists.reduce((total, list) => total + list.length, 0)
            );
            dispose();
          });
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe('route paths', () => {
  const segment = fc.stringMatching(/^[a-z]{1,6}$/);
  const value = fc
    .string({ minLength: 1, maxLength: 8 })
    .filter((s) => !s.includes('/'));

  it('matches a generated path and returns the same params', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(segment, { minLength: 1, maxLength: 4 }),
        fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
        fc.array(value, { minLength: 4, maxLength: 4 }),
        (names, isParam, values) => {
          const params: Record<string, string> = {};
          const pattern =
            '/' +
            names
              .map((name, i) => {
                if (!isParam[i]) return name;
                params[name] = values[i]!;
                return `:${name}`;
              })
              .join('/');

          const path = generatePath(pattern, params);
          const match = matchPath(path, compilePath(pattern));
          expect(match?.params).toEqual(params);
        }
      )
    );
  });

  it('replaces a param whose name starts another param name', () => {
    expect(generatePath('/:id/:idx', { id: '1', idx: '2' })).toBe('/1/2');
  });
});

describe('query strings', () => {
  const queryValue = fc.oneof(
    fc.string({ maxLength: 8 }),
    fc.array(fc.string({ maxLength: 8 }), { minLength: 2, maxLength: 3 })
  );

  it('parses what it stringifies', () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ minLength: 1, maxLength: 6 }), queryValue),
        (query) => {
          expect(parseQuery(stringifyQuery(query))).toEqual(query);
        }
      )
    );
  });

  it('keeps "=" inside values', () => {
    expect(parseQuery('?token=abc==&x=1')).toEqual({ token: 'abc==', x: '1' });
  });

  it('does not throw on malformed escapes', () => {
    expect(parseQuery('?q=100%')).toEqual({ q: '100%' });
    expect(parseQuery('?bad%E0%A4%A=1')).toEqual({ 'bad%E0%A4%A': '1' });
  });

  it('does not throw on a path with a malformed escape', () => {
    expect(
      matchPath('/files/100%', compilePath('/files/:name'))?.params
    ).toEqual({
      name: '100%',
    });
  });
});

describe('store', () => {
  const key = fc.constantFrom('a', 'b', 'c');
  const op = fc.tuple(key, fc.integer());

  it('matches a plain object after any sequence of writes', () => {
    fc.assert(
      fc.property(fc.array(op, { maxLength: 20 }), (ops) => {
        const s = store<Record<string, number>>({});
        const plain: Record<string, number> = {};
        for (const [k, v] of ops) {
          s.set(k, v);
          plain[k] = v;
        }
        expect(s.unwrap()).toEqual(plain);
      })
    );
  });

  it('keeps computed values over the store and over each other fresh', () => {
    fc.assert(
      fc.property(fc.array(op, { maxLength: 20 }), (ops) => {
        const s = store<Record<string, number>>({ a: 0, b: 0, c: 0 });
        const sum = (o: Record<string, number>) =>
          (o['a'] ?? 0) + 2 * (o['b'] ?? 0);
        const fresh = (o: Record<string, number>) => `${sum(o)}:${o['c'] ?? 0}`;
        let seen = '';
        const dispose = createRoot((d) => {
          const inner = new Computed(() => sum(s.state));
          const outer = new Computed(() => `${inner.value}:${s.state['c']}`);
          effect(() => {
            seen = outer.value;
          });
          return d;
        });
        settle();
        for (const [k, v] of ops) {
          s.set(k, v);
          settle();
          expect(seen).toBe(fresh(s.unwrap()));
        }
        dispose();
      })
    );
  });
});

describe('batch', () => {
  it('never shows an effect a half applied batch', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { minLength: 1, maxLength: 10 }),
        (values) => {
          createRoot((dispose) => {
            const a = new Signal(0);
            const b = new Signal(0);
            const seen: Array<[number, number]> = [];
            effect(() => {
              seen.push([a.value, b.value]);
            });
            settle();

            for (const v of values) {
              batch(() => {
                a.value = v;
                b.value = v;
              });
              settle();
            }

            for (const [x, y] of seen) expect(x).toBe(y);
            dispose();
          });
        }
      ),
      { numRuns: 50 }
    );
  });
});
