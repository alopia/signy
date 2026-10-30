import { defineSuite, shuffled, type Signy } from '../suite.ts';

/** A fresh container in the page, removed by the returned function */
function container(): [HTMLElement, () => void] {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return [el, () => el.remove()];
}

/** Renders inside an owned root, so the case can dispose its bindings */
function rendered(s: Signy, render: () => unknown): [HTMLElement, () => void] {
  const [el, remove] = container();
  const dispose = s.createRoot((dispose) => {
    s.insert(el, render());
    return dispose;
  });
  return [
    el,
    () => {
      dispose();
      remove();
    },
  ];
}

interface Row {
  id: number;
  label: { value: string };
}

const ADJECTIVES = ['pretty', 'large', 'big', 'small', 'tall', 'short'];
const NOUNS = ['table', 'chair', 'house', 'bbq', 'desk', 'car', 'pony'];
let nextId = 1;

function buildRows(s: Signy, count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: nextId++,
    label: s.signal(
      `${ADJECTIVES[i % ADJECTIVES.length]} ${NOUNS[i % NOUNS.length]}`
    ),
  }));
}

/**
 * The js-framework-benchmark table: keyed rows, a selected row, row labels as
 * signals. Same bindings and handlers as the website compare page.
 */
function table(s: Signy, initial: number) {
  const rows = s.signal<Row[]>(buildRows(s, initial));
  const selected = s.signal(0);
  // createSelector, as the website compare page does
  let isSelected!: (id: number) => { value: boolean };
  const [el, dispose] = rendered(s, () => {
    isSelected = s.createSelector(() => selected.value);
    return s.html`<table><tbody>
      <${s.For} each=${() => rows.value} keyBy="id">
        ${(
          row: Row
        ) => s.html`<tr class=${() => (isSelected(row.id).value ? 'danger' : '')}>
          <td>${row.id}</td>
          <td><a href="#" onClick=${(e: Event) => (e.preventDefault(), (selected.value = row.id))}>${() => row.label.value}</a></td>
          <td><button aria-label=${`Remove row ${row.id}`} onClick=${() => (rows.value = rows.value.filter((r) => r !== row))}>x</button></td>
        </tr>`}
      </${s.For}>
    </tbody></table>`;
  });
  return { rows, selected, el, dispose };
}

/** Clears a full table to empty, refilled before each run */
function clearRows(s: Signy, count: number) {
  const t = table(s, 0);
  const full = buildRows(s, count);
  return {
    beforeEach: () => {
      t.rows.value = full;
      s.flushAll();
    },
    run: () => {
      t.rows.value = [];
      s.flushAll();
    },
    teardown: t.dispose,
  };
}

export default defineSuite({
  name: 'dom',
  tier: 'browser',
  time: {
    'html: first render of a card, then dispose': (s) => {
      const count = s.signal(0);
      return {
        run: () => {
          const [, dispose] = rendered(
            s,
            () => s.html`<div class="card">
              <h2>Title</h2>
              <p>${() => count.value}</p>
              <button onClick=${() => count.value++}>add</button>
            </div>`
          );
          dispose();
        },
      };
    },
    'html: re-render one binding': (s) => {
      const count = s.signal(0);
      const [, dispose] = rendered(
        s,
        () => s.html`<p>${() => count.value}</p>`
      );
      return {
        run: () => {
          count.value++;
          s.flushAll();
        },
        teardown: dispose,
      };
    },
    'html: render an SVG icon': (s) => ({
      run: () =>
        s.html`<svg viewBox="0 0 24 24" width="24" height="24">
          <circle cx="12" cy="12" r="10" />
          <path d="M8 12h8M12 8v8" stroke="black" />
        </svg>`,
    }),
    'h(): render an SVG icon': (s) => ({
      run: () =>
        s.h(
          'svg',
          { viewBox: '0 0 24 24', width: '24', height: '24' },
          s.h('circle', { cx: '12', cy: '12', r: '10' }),
          s.h('path', { d: 'M8 12h8M12 8v8', stroke: 'black' })
        ),
    }),
    'Show: toggle 1000 times': (s) => {
      const on = s.signal(false);
      const [, dispose] = rendered(s, () =>
        s.Show({
          when: () => on.value,
          fallback: s.html`<i>off</i>` as Node,
          children: () => s.html`<b>on</b>` as Node,
        })
      );
      return {
        run: () => {
          for (let i = 0; i < 1000; i++) {
            on.value = !on.value;
            s.flushAll();
          }
        },
        teardown: dispose,
      };
    },
    'For: keyed reverse of 1k rows': (s) => {
      const t = table(s, 1000);
      return {
        run: () => {
          t.rows.value = [...t.rows.value].reverse();
          s.flushAll();
        },
        teardown: t.dispose,
      };
    },
    'For tag: render 1k rows, then dispose': (s) => {
      const items = Array.from({ length: 1000 }, (_, i) => i);
      return {
        run: () => {
          const [, dispose] = rendered(
            s,
            () =>
              s.html`<ul><${s.For} each=${items}>${(n: number) =>
                s.html`<li>${n}</li>`}</${s.For}></ul>`
          );
          dispose();
        },
      };
    },
    'Index tag: update every 10th of 1k': (s) => {
      const items = s.signal(Array.from({ length: 1000 }, (_, i) => i));
      const [, dispose] = rendered(
        s,
        () =>
          s.html`<ul><${s.Index} each=${() => items.value}>${(
            n: () => number
          ) => s.html`<li>${n}</li>`}</${s.Index}></ul>`
      );
      let round = 0;
      return {
        run: () => {
          round++;
          items.value = items.value.map((n, i) =>
            i % 10 === 0 ? n + round : n
          );
          s.flushAll();
        },
        teardown: dispose,
      };
    },
    'component: mount and unmount': (s) => {
      class Card extends s.Component {
        private count = s.signal(0);
        protected render() {
          return s.html`<div class="card"><p>${() => this.count.value}</p></div>`;
        }
      }
      return {
        run: () => {
          const [el, remove] = container();
          const app = s.application(Card);
          app.mount(el);
          app.unmount();
          remove();
        },
      };
    },
    'jsfb: create 1k rows': (s) => ({
      run: () => {
        const t = table(s, 1000);
        t.dispose();
      },
    }),
    'jsfb: replace all 1k rows': (s) => {
      const t = table(s, 1000);
      return {
        run: () => {
          t.rows.value = buildRows(s, 1000);
          s.flushAll();
        },
        teardown: t.dispose,
      };
    },
    'jsfb: replace all 10k rows': (s) => {
      const t = table(s, 10000);
      return {
        run: () => {
          t.rows.value = buildRows(s, 10000);
          s.flushAll();
        },
        teardown: t.dispose,
      };
    },
    'jsfb: clear 1k rows': (s) => clearRows(s, 1000),
    'jsfb: clear 10k rows': (s) => clearRows(s, 10000),
    'jsfb: update every 10th of 1k rows': (s) => {
      const t = table(s, 1000);
      return {
        run: () => {
          const rows = t.rows.value;
          for (let i = 0; i < rows.length; i += 10) {
            const label = rows[i]!.label;
            label.value = `${label.value} !!!`;
          }
          s.flushAll();
        },
        teardown: t.dispose,
      };
    },
    'jsfb: select a row': (s) => {
      const t = table(s, 1000);
      let i = 0;
      return {
        run: () => {
          t.selected.value = t.rows.value[i++ % 1000]!.id;
          s.flushAll();
        },
        teardown: t.dispose,
      };
    },
    'jsfb: swap rows 2 and 999': (s) => {
      const t = table(s, 1000);
      return {
        run: () => {
          const rows = [...t.rows.value];
          [rows[1], rows[998]] = [rows[998]!, rows[1]!];
          t.rows.value = rows;
          s.flushAll();
        },
        teardown: t.dispose,
      };
    },
    'jsfb: remove a row, then add it back': (s) => {
      const t = table(s, 1000);
      return {
        run: () => {
          const rows = t.rows.value;
          const removed = rows[500]!;
          t.rows.value = rows.filter((r) => r !== removed);
          s.flushAll();
          t.rows.value = [
            ...t.rows.value.slice(0, 500),
            removed,
            ...t.rows.value.slice(500),
          ];
          s.flushAll();
        },
        teardown: t.dispose,
      };
    },
    'jsfb: append 1k to 1k rows, then clear': (s) => {
      const t = table(s, 1000);
      const first = t.rows.value;
      return {
        run: () => {
          t.rows.value = [...first, ...buildRows(s, 1000)];
          s.flushAll();
          t.rows.value = first;
          s.flushAll();
        },
        teardown: t.dispose,
      };
    },
    'reconcile: 1k keyed rows, shuffled': (s) => {
      const parent = document.createElement('div');
      const end = parent.appendChild(document.createComment('end'));
      const keys = Array.from({ length: 1000 }, (_, i) => i);
      const orders = [shuffled(keys, 1), shuffled(keys, 2)];
      const render = (n: number) => {
        const li = document.createElement('li');
        li.textContent = String(n);
        return li;
      };
      let items = s.createRoot(
        () => s.reconcile(parent, [], keys, (n) => n, render, end, null).items
      );
      let i = 0;
      return {
        run: () => {
          items = s.reconcile(
            parent,
            items,
            orders[i++ % 2]!,
            (n) => n,
            render,
            end,
            null
          ).items;
        },
      };
    },
    'router: push and back with loaders': (s) => {
      class Page extends s.Component {
        protected render() {
          return s.html`<p>page</p>`;
        }
      }
      const router = s.memoryRouter({
        routes: [
          { path: '/', component: Page },
          {
            path: '/a/:id',
            component: Page,
            loader: ({ params }) => params['id'],
          },
        ],
        initialEntries: ['/'],
      });
      class Root extends s.Component {
        protected render() {
          return s.html`<main><${s.Outlet} /></main>`;
        }
      }
      const [el, remove] = container();
      const app = s.application(Root).use(router);
      app.mount(el);
      let i = 0;
      return {
        async: true,
        run: async () => {
          await router.push(`/a/${i++}`);
          s.flushAll();
          await router.push('/');
          s.flushAll();
        },
        teardown: () => {
          app.unmount();
          router.destroy();
          remove();
        },
      };
    },
    'Link: active state of 100 links on navigation': (s) => {
      class Page extends s.Component {
        protected render() {
          return null;
        }
      }
      const router = s.memoryRouter({
        routes: [{ path: '/item/:id', component: Page }],
        initialEntries: ['/item/0'],
      });
      const ids = Array.from({ length: 100 }, (_, i) => i);
      class Nav extends s.Component {
        protected render() {
          return s.html`<nav>${ids.map(
            (id) => s.html`<${s.Link} to=${`/item/${id}`}>${id}</${s.Link}>`
          )}</nav>`;
        }
      }
      const [el, remove] = container();
      const app = s.application(Nav).use(router);
      app.mount(el);
      let i = 0;
      return {
        async: true,
        run: async () => {
          await router.push(`/item/${++i % 100}`);
          s.flushAll();
        },
        teardown: () => {
          app.unmount();
          router.destroy();
          remove();
        },
      };
    },
  },
  memory: {
    'component: 1000 mount and unmount cycles': (s) => {
      class Card extends s.Component {
        private count = s.signal(0);
        protected render() {
          return s.html`<div><p>${() => this.count.value}</p><button>+</button></div>`;
        }
      }
      const [el, remove] = container();
      return {
        cycles: 1000,
        cycle: () => {
          const app = s.application(Card);
          app.mount(el);
          app.unmount();
        },
        teardown: remove,
      };
    },
  },
});
