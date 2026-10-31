# Signy: rules for AI assistants

Read this before you write an app or a component with Signy. It covers the `html` tagged template, which needs no build step. JSX is at the end.

## How Signy works

- State lives in signals. `new Signal(0)` or `signal(0)`. Read with `.value`, write with `.value = x` or `.set(prev => next)`. `.peek()` reads without tracking.
- Derived state is `new Computed(() => ...)` or `computed(...)`. It is cached and read with `.value`, or `.peek()` without tracking, like a signal. When it recomputes to an equal value (`Object.is`, or the `equals` option), effects and bindings that read it do not re-run.
- A component is a class that extends `Component`. `render()` runs once. It never runs again when state changes.
- Only functions update. `${() => count.value}` is a live binding. `${count.value}` is the value at render time and stays frozen.
- The same rule holds for attributes: `class=${() => ...}`, `disabled=${() => ...}`, `style=${() => ({ ... })}`. A function inside a quoted value binds the whole value: `class="card ${() => tone.value}"`.
- `prop:name` sets a DOM property instead of an attribute: `prop:value=${() => ...}`, `prop:checked=${...}`. `attr:name` always writes a plain attribute, also for names Signy handles itself, such as `class` or `style`.
- `bind:value=${signal}` and `bind:checked=${signal}` keep a form control and a signal in sync both ways. A `type="number"` or `type="range"` input gives a number, or `null` while it is empty. It works on `input`, `textarea` and a single `select`. Radio groups and `<select multiple>` are not covered. A binding runs after the children and the other attributes, so a `select` finds its options and a `range` its limits whatever the order in the template, and a `select` also picks options that arrive later.
- `use:name=${directive}` runs a function `(element, accessor) => void` on the element, once, untracked. Pass an argument as `use:name=${[directive, arg]}`: the directive gets `accessor()` returning `arg`, or `arg` itself when it is a function, so `() => signal.value` stays live. Cleanups inside belong to the component.
- Events are `on` plus the event name: `onClick`, `onInput`, `onSubmit`, `onKeyDown`. The name is lowercased, so `onDblClick` listens to `dblclick`. Bubbling events like `click` and `input` are delegated to the document. `on:click` listens on the element itself, for a detached element or a custom event name kept as written. A handler that throws is reported, and the handlers above it still run, as with native listeners.
- Conditionals and lists use the control flow functions `Show`, `For`, `Index`, `Switch` and `Match`. Call them as functions inside `${}`, or use them as tags (`<${Show} when=${...}>...</${Show}>`). As tags, the content between them is built when the component reads it, as in JSX: `Show` builds a branch when it shows it and disposes it when it hides, `Suspense` and `ErrorBoundary` wrap what is inside. A function component that reads `props.children` twice builds it twice.
- Everything a component creates while rendering belongs to it: bindings, control flow, child components. Unmounting disposes all of it. There is nothing to clean up by hand.
- Updates apply in a microtask, not synchronously. `batch(() => ...)` groups several writes into one update.
- An app is `application(RootComponent).mount('#app')`. Plugins such as the router go in with `app.use(...)` before `mount`. `unmount()` removes only what the app added to its container, so nodes the page put around it stay. A root that throws in `setup()` or `render()` makes `mount()` dispose it and the plugins, then rethrow.

## Do not

- Do not write React. There is no `useState`, `useEffect`, `setState`, virtual DOM or re-render. Do not expect `render()` to run again.
- Do not interpolate a bare signal value where it must update. `${this.count.value}` renders once. Write `${() => this.count.value}`.
- A function child can return markup: `${() => ok ? html`<b>yes</b>` : null}`. It rebuilds the markup on every re-run, so for a condition prefer `Show`, which rebuilds only when the condition changes.
- Do not call `.map()` over a signal array in a template for a list that changes. It renders once. Use `For`.
- Do not bind `value=${() => ...}` on an input and expect it to reset the field. It sets the attribute, and the browser ignores the attribute once the user has typed. Use `bind:value=${signal}`, or bind the property with `prop:value=${() => ...}` and keep the signal in sync from `onInput`, or set `ref.current.value` through a ref. The same holds for `checked` and `selected`.
- Do not declare props with `interface`. `Component<Props>` needs a type that fits `Record<string, unknown>`, and an interface has no index signature, so TypeScript rejects it. Use `type Props = { ... }`.
- Do not call `component.mount()` yourself. Go through `application()`: pass the root class, or an instance when the root needs props, `application(new App({ title: 'Inbox' }))`.
- Write `class` and `onClick`. `className` and `onclick` also work, but keep to one style. `@click` does not exist.
- Do not rely on `flushSync()` in tests. It only delivers signal notifications and does not run effects or DOM updates. Call `flushAll()` instead, imported from `signy` (see Tests).
- Do not use `console.log` in framework code. App code may.

## Starter

With npm:

```bash
npm install signy
```

```typescript
import { Component, Signal, Computed, application, html } from 'signy';

class Counter extends Component {
  private count = new Signal(0);
  private double = new Computed(() => this.count.value * 2);

  protected render() {
    return html`
      <button onClick=${() => this.count.set((c) => c + 1)}>
        ${() => this.count.value} (double ${() => this.double.value})
      </button>
    `;
  }
}

application(Counter).mount('#app');
```

Without a build step, the global build defines `Signy`:

```html
<div id="app"></div>
<script src="https://unpkg.com/signy/dist/signy.global.prod.js"></script>
<script>
  const { Component, Signal, application, html } = Signy;

  class Hello extends Component {
    name = new Signal('world');
    render() {
      return html`<p>Hello ${() => this.name.value}</p>`;
    }
  }

  application(Hello).mount('#app');
</script>
```

`signy.core.global.prod.js` and `signy.web.global.prod.js` are smaller builds that also define `Signy`. `signy.store.global.prod.js` adds the store as `SignyStore` and shares their runtime, so load one of them before it.

## Imports

| Import | What you get |
|---|---|
| `signy` | Everything below, plus `flushAll` |
| `signy/core` | `Signal`, `signal`, `Computed`, `computed`, `effect`, `on`, `batch`, `untrack`, `onCleanup`, `createRoot`, `createSelector`. No DOM |
| `signy/web` | Core plus `html`, `h`, `Component`, `Show`, `For`, `Index`, `Switch`, `Match`, `Portal`, `Dynamic`, `bind`, `useHead`, `ErrorBoundary`, `Suspense`, `lazy`, `createContext`, `createRef`, DOM helpers, `resource`, `startTransition`, `useTransition`, `createDeferred` |
| `signy/store` | `store`, `ReactiveStore`, `ReactiveMap`, `ReactiveSet`, `produce`, `unwrap`, `replaceWith` |
| `signy/router` | `router`, `defineRoute`, `Link`, `NavLink`, `Outlet`, `lazyRoute`, `useRouter`, `useRoute`, `useParams`, `useQuery`, `useRouteData` |
| `signy/app` | `application`, `Application`, `defineElement` |
| `signy/jsx` | The functions compiled JSX calls, see JSX below |

## Patterns

Component with props, setup and lifecycle. `setup()` runs once before `render()`. `onMount` runs after the DOM exists and may return a cleanup. `onUnmount` runs before removal.

```typescript
type ClockProps = {
  label: string;
};

class Clock extends Component<ClockProps> {
  private now = new Signal(new Date());

  protected setup(): void {
    this.onMount(() => {
      const timer = setInterval(() => (this.now.value = new Date()), 1000);
      return () => clearInterval(timer);
    });
  }

  protected render() {
    return html`
      <p>${this.props.label}: ${() => this.now.value.toLocaleTimeString()}</p>
    `;
  }
}
```

Child components: use the class as a tag. Static props are plain values. For a prop that changes, pass a function and call it in the child. A component is built untracked: a signal read in its constructor, `setup()` or `render()` gives the value at that moment and never rebuilds it, also inside a binding, so read changing values inside bindings. Content between the tags arrives as `this.props.children`. It is built the first time the child reads it, under the child, so a component in it sees the child's context and is disposed with it. With `h()`, JavaScript builds `h(Consumer)` before the parent exists, so pass a function to keep that: `h(Provider, null, () => h(Consumer, null))`.

```typescript
class Card extends Component<{ title: () => string; children?: Node }> {
  protected render() {
    return html`
      <section class="card">
        <h2>${() => this.props.title()}</h2>
        ${this.props.children}
      </section>
    `;
  }
}

class Page extends Component {
  private title = new Signal('Inbox');

  protected render() {
    return html`
      <${Card} title=${() => this.title.value}>
        <p>3 unread</p>
      </${Card}>
    `;
  }
}
```

Conditional: `Show` with an accessor in `when`. The `children` function receives the truthy value. It runs once per branch, untracked: the branch is rebuilt only when the truthy value changes (a different object, or falsy to truthy), not when a signal read inside it changes. Bind those signals with `${() => ...}` like anywhere else. A node child is moved in and out, so it keeps its listeners.

```typescript
html`
  <div>
    ${Show({
      when: () => this.user.value,
      fallback: html`<p>Signed out</p>`,
      children: (user) => html`
        <p>Hi ${user.name}</p>
        <button onClick=${() => (this.user.value = null)}>Sign out</button>
      `,
    })}
  </div>
`;
```

Lists: `For` reuses rows when the array changes, matched by `keyBy` or `key`, or by the item itself without one. Give a key when items are recreated, for example after each fetch. `index` is an accessor. The item is a plain value, so a field that changes on an item with the same key does not re-render. Keep such fields in a `Signal` on the item, or use a store.

```typescript
interface Todo {
  id: number;
  text: string;
  done: Signal<boolean>;
}

class TodoList extends Component {
  private todos = new Signal<Todo[]>([]);

  private remove(id: number) {
    this.todos.set((list) => list.filter((t) => t.id !== id));
  }

  protected render() {
    return html`
      <ul>
        ${For({
          each: () => this.todos.value,
          keyBy: 'id',
          fallback: html`<li>Nothing to do</li>`,
          children: (todo, index) => html`
            <li class=${() => (todo.done.value ? 'done' : '')}>
              ${() => index() + 1}. ${todo.text}
              <input
                type="checkbox"
                onChange=${() => todo.done.set((d) => !d)}
              />
              <button onClick=${() => this.remove(todo.id)}>Delete</button>
            </li>
          `,
        })}
      </ul>
    `;
  }
}
```

`Index` is the other way round: the item is an accessor and the index is a number. Use it for lists of primitives edited in place. Rows are kept and only their item changes, so read `item()` inside a binding: `${() => item()}`, not `${item()}`.

Several branches: `Switch` with `Match` children, first match wins. `Switch` reads its children once, and only the `Match` that wins builds its content.

```typescript
html`
  ${Switch({
    fallback: html`<p>Idle</p>`,
    children: [
      Match({ when: () => this.status.value === 'loading', children: () => html`<p>Loading</p>` }),
      Match({ when: () => this.status.value === 'error', children: () => html`<p>Failed</p>` }),
    ],
  })}
`;
```

Forms: read input in the event, keep state in signals, use a ref to write to the field.

```typescript
class Search extends Component {
  private query = new Signal('');
  private input = createRef<HTMLInputElement>();

  private clear() {
    this.query.value = '';
    if (this.input.current) this.input.current.value = '';
  }

  protected render() {
    return html`
      <form onSubmit=${(e: SubmitEvent) => e.preventDefault()}>
        <input
          ref=${this.input}
          type="search"
          onInput=${(e: Event) =>
            (this.query.value = (e.currentTarget as HTMLInputElement).value)}
        />
        <button type="button" onClick=${() => this.clear()}>Clear</button>
        <p>Searching for ${() => this.query.value}</p>
      </form>
    `;
  }
}
```

`ref` also takes a callback: `ref=${(el) => ...}`.

Two way binding replaces the `prop:value` plus `onInput` pair:

```typescript
class Signup extends Component {
  private name = new Signal('');
  private agreed = new Signal(false);

  protected render() {
    return html`
      <input bind:value=${this.name} />
      <label><input type="checkbox" bind:checked=${this.agreed} /> I agree</label>
      <p>${() => this.name.value}</p>
    `;
  }
}
```

Dynamic renders a tag or component chosen at runtime. A function that is not a Component class is read as an accessor, so `component=${() => view.value}` follows a signal. A function component needs `() => MyFunction`. A development build warns when `component` resolves to something that is not a tag name or a function. Other props and the children go to what it renders.

```typescript
html`<${Dynamic} component=${() => this.view.value} user=${this.user} />`;
html`<${Dynamic} component=${() => (this.big.value ? 'h1' : 'h2')} class="title">Hello</${Dynamic}>`;
```

Document head: `useHead` sets the title and `<meta>` and `<link>` tags while its owner lives, so call it in `setup()`. Pass a function to follow signals. Calls stack: the latest wins per title and per tag, and removing it brings the previous one back, so a layout sets defaults and a page overrides them. `titleTemplate` takes `'%s - Site'` or a function. It runs in the browser only.

```typescript
protected setup(): void {
  useHead(() => ({
    title: `Inbox (${this.unread.value})`,
    meta: [{ name: 'description', content: 'Your messages' }],
  }));
}
```

Custom elements: `defineElement('x-counter', Counter, { props: { start: Number, label: String } })` from `signy/app` registers a tag that mounts the component when connected and unmounts it when removed. Props come from attributes (`String`, `Number`, `Boolean`, `maxItems` reads `max-items`) and from properties. A prop is a getter over a signal, so read it inside a binding: `${() => this.props.label}`. `emit()` fires on the element. A tag can be defined once. Removing the element removes only the component's output, so the children the page gave it stay. A prop cannot be named like a property every element has, such as `title`, `id` or `hidden`: `defineElement` throws `app:element-reserved-prop`.

Effects: `effect(fn)` reruns when a signal it read changes. Its first run is in a microtask. Call `onCleanup` inside to undo the previous run. `onCleanup` also works inside bindings and control flow children. Create effects in `setup()` so they are owned by the component and disposed on unmount. `on(dep, fn, { defer: true })` skips the first run and passes the previous value. Only `dep` is tracked, like Solid: signals `fn` reads do not rerun the effect.

```typescript
protected setup(): void {
  effect(() => {
    document.title = `${this.count.value} items`;
  });

  effect(
    on(() => this.page.value, (page, prev) => console.log(prev, '->', page), {
      defer: true,
    })
  );
}
```

Store: deep reactive state. Read through `.state`, write with a path in `.set()`. A function as the last argument receives the previous value. Reads are tracked per key: a write re-runs readers of that path and below, not of its parents. `update(fn)` replaces the state and drops keys the result leaves out. `merge(partial)` merges nested objects and keeps keys it leaves out. Assignments through `.state` (`cart.state.items[0].qty++`, `push()`, `delete`) also notify. The store copies the arrays and plain objects of its initial value and keeps a class instance as it is, methods included, and `unwrap()` returns it as it is too.

```typescript
import { store } from 'signy';

const cart = store({ items: [] as { id: number; qty: number }[], coupon: '' });

cart.set('coupon', 'SPRING');
cart.set('items', (items) => [...items, { id: 1, qty: 1 }]);
cart.set('items', 0, 'qty', (q) => q + 1);

html`<p>${() => cart.state.items.length} items</p>`;
```

A store does not see inside a `Map` or a `Set`. Use `ReactiveMap` and `ReactiveSet`, which extend them and track themselves: `get(key)` and `has(key)` re-run for that key only, `size` and `keys()` when a key is added or deleted, `values()`, `entries()` and iteration on any change. Read them inside a binding or effect. A store field can hold one: `store({ users: new ReactiveMap<number, User>() })`. A store used as a map of ids does not grow with the ids it has seen: a key's node is dropped once nobody reads it and the key is gone.

Async data: `resource`. `value`, `loading` and `error` are reactive. A source function refetches when it changes. The fetcher gets `info.signal`, aborted when a newer fetch starts, when the source turns `null`, `false` or `undefined`, when the owner unmounts and on `dispose()`. A falsy source fetches nothing and the value stays as it was.

```typescript
import { resource } from 'signy';

const user = resource(
  () => this.userId.value,
  async (id, { signal }) => (await fetch(`/api/users/${id}`, { signal })).json()
);

html`
  ${Show({ when: () => user.loading, children: () => html`<p>Loading</p>` })}
  ${Show({ when: () => user.value, children: (u) => html`<p>${u.name}</p>` })}
`;
```

Slow updates: `useTransition()` returns `[isPending, start]`. `start(fn)` runs the writes in `fn` after the next paint, in one batch, so an urgent write made before it (the input text) and `isPending` reach the screen first. It returns a promise that resolves when the writes ran, or rejects with the error `fn` threw. The other writes queued with it still run. `startTransition(fn)` does the same with one shared pending state. `createDeferred(() => source)` returns an accessor that lags behind `source` the same way.

```typescript
import { useTransition } from 'signy';

class Finder extends Component {
  private query = new Signal('');
  private results = new Signal<string[]>([]);
  private transition = useTransition();

  private search(text: string) {
    this.query.value = text;
    const [, start] = this.transition;
    start(() => (this.results.value = filterAll(text)));
  }

  protected render() {
    const [isPending] = this.transition;
    return html`
      <input onInput=${(e: Event) => this.search((e.currentTarget as HTMLInputElement).value)} />
      <ul class=${() => (isPending.value ? 'stale' : '')}>
        ${For({ each: () => this.results.value, children: (r) => html`<li>${r}</li>` })}
      </ul>
    `;
  }
}
```

Shared values down the tree: `createContext`. Provide in `setup()`, inject in a descendant. Provide a signal when the value changes.

```typescript
const ThemeContext = createContext<Signal<'light' | 'dark'>>(undefined, 'Theme');

class App extends Component {
  private theme = new Signal<'light' | 'dark'>('light');
  protected setup() {
    ThemeContext.provide(this, this.theme);
  }
}

class ThemeLabel extends Component {
  protected render() {
    const theme = ThemeContext.inject(this);
    return html`<span>${() => theme.value}</span>`;
  }
}
```

Router: define routes, `app.use(router)`, render `Outlet` where the page goes. `Link` sets `router-link-active` and `router-link-exact-active` on the active link, and `aria-current="page"` on the exact one (change it with `ariaCurrentValue`). `to`, `class` and `disabled` take a function to follow signals, ``to=${() => `/users/${id.value}`}``, and JSX props are read live. `useParams(this)`, `useQuery(this)` and `useRoute(this)` return signals.

```typescript
import { application, Component, html, router, Link, Outlet, useParams, useRouter } from 'signy';

class UserPage extends Component {
  protected render() {
    const params = useParams(this);
    const nav = useRouter(this);
    return html`
      <h1>User ${() => params.value.id}</h1>
      <button onClick=${() => nav.push('/')}>Home</button>
    `;
  }
}

class Layout extends Component {
  protected render() {
    return html`
      <nav>
        <${Link} to="/">Home</${Link}>
        <${Link} to="/users/42">User 42</${Link}>
      </nav>
      <main><${Outlet} /></main>
    `;
  }
}

const appRouter = router({
  routes: [
    { path: '/', component: HomePage },
    { path: '/users/:id', component: UserPage },
    { path: '*', component: NotFound },
  ],
});

application(Layout).use(appRouter).mount('#app');
```

Guards: `appRouter.beforeEach(({ to }) => ...)` or `guards: [...]` on a route. Return `false` to cancel, a path to redirect, nothing to go on. They run on every navigation, the first one and back and forward included, and a route with guards, a redirect or a loader shows nothing until its first navigation is done. A cancelled back or forward steps back to the route on screen, so no history entry is lost. `history.listen((location, action, delta) => ...)` gets how many entries a pop moved.

`appRouter.afterEach((to, from, failure) => ...)` runs after each navigation. When a guard cancels one or a newer one aborts it, the hook still runs and gets a third `failure` argument: compare `failure.type` with `NavigationFailureType.CANCELLED` or `ABORTED`.

Loaders: `loader: async ({ params, query, signal }) => data`, read with `useRouteData(this)`. The old page waits for the loader and a failure is only logged, unless the route names pages for it: `pending: Loading` commits the route at once and shows it while the loader runs, `error: Failed` shows when it throws and gets `error` and `retry()`. Only the deepest route swaps. `appRouter.loaderState` and `appRouter.loaderError` are signals. `appRouter.revalidate()` runs the current loader again without navigating. A navigation that changes only the hash runs the guards and scrolls, but keeps the page and its data: the loader does not run again.

Prefetch: `<${Link} to="/reports" prefetch>` or `appRouter.prefetch(to)` loads the lazy components and starts the loader, and the next navigation to that path takes the result once (dropped after 30 seconds, guards do not run).

Route `alias: '/old'` (or an array) adds paths for the same route, and `name` and `Link` still build the main one. In TypeScript, `defineRoute({ path: '/users/:id', loader: ({ params }) => ... })` types `params` from the path, and `useParams<'/users/:id'>(this)` types the signal. A named target for a wildcard route fills it: `{ name: 'files', params: { path: 'a b/c' } }` gives `/files/a%20b/c`. A `disabled` `Link` is out of the tab order, ignores clicks and does not call `onClick`. A path has one spelling: `/caf%C3%A9` and `/café` match the same route, compare equal for `Link`, and a param is decoded once. `%`, `/`, `?` and `#` stay encoded.

Nested routes use `children` on a route and an `Outlet` in the parent component. `lazyRoute(() => import('./page'))` splits a route into its own chunk. `mode: 'hash'` or `mode: 'memory'` change the history.

SVG: write it in the template as in HTML. `svg`, `circle`, `path` and the other SVG tags are created in the SVG namespace. `a`, `title`, `style` and `script` inside an `svg` of the same template are SVG too. At the root of a component's template, or with `h()`, which builds a child before its parent, they need `xmlns="http://www.w3.org/2000/svg"`.

Code splitting: `lazy(() => import('./chart'))` takes a module whose default export is a component class or a function component. Render it inside `Suspense`, which shows its fallback while it loads. Reading a `resource`'s `value` inside `Suspense` also shows the fallback, during its first fetch only. A refetch keeps the old value, show its `loading` with `Show`. `Suspense` renders its children once. While something is pending they wait off screen with their effects running, and move back in when it settles.

Shadow DOM: set `protected shadow = true` and `protected styles = '...'` on the component for isolated CSS. `this.emit('rate', detail)` fires a composed event on the host, and an `onRate` prop on the tag listens to it, in `html` and JSX. A standard event prop such as `onClick` stays a plain prop for the component to use.

## Tests

Templates and control flow render synchronously, so the DOM is complete right after `mount()`. Updates after a signal write apply in a microtask. In tests, call `flushAll()` after a write. It runs pending notifications, effects and DOM updates until nothing is left:

```typescript
import { flushAll } from 'signy';

count.value = 2;
flushAll();
expect(root.textContent).toBe('2');
```

For async work such as route loaders and lazy imports, await a task first, then call `flushAll()`.

Attach the root to `document` before you click in a test: delegated events such as `onClick` listen on the document, so a detached root gets none. Dev builds, which tests use, log warnings such as `view:lazy-outside-suspense` by default. Production builds log errors only.

## JSX

JSX is compiled by `babel-plugin-jsx-dom-expressions`, the same compiler Solid uses. Calling `jsx()` at runtime throws, so `jsxImportSource` alone is not enough.

```javascript
// babel.config.js
module.exports = {
  plugins: [
    ['babel-plugin-jsx-dom-expressions', {
      moduleName: 'signy/jsx',
      effectWrapper: 'createRenderEffect',
      generate: 'dom',
      delegateEvents: true,
      wrapConditionals: true,
    }],
  ],
};
```

JSX has no `bind:`. Use the `bind` directive: `<input use:bind={name} />`, `<input type="checkbox" use:bind={done} />`, or `use:bind={[done, 'checked']}` to pick the property. The compiler calls a `use:` directive by name, so the identifier must be in scope and TypeScript with `noUnusedLocals` calls it unused. Reference it once, for example `void bind;`.

Attribute namespaces: `on:click` and `oncapture:click` listen on the element, `prop:`, `attr:` and `bool:` pick how a value is written, `class:active={on}` toggles one class and `style:color={c}` sets one property. They mix with `class` and `style`: a change to those keeps the classes and properties set this way. They also work in a spread, so a component can forward them with `{...props}`. A spread can change its keys, `{...(open.value ? a : b)}` adds and removes them. A spread writes `value`, `checked`, `selected`, `muted`, `indeterminate`, `innerHTML`, `textContent` and `innerText` as properties, as the compiler does, `htmlFor` as `for`, and the props of a custom element as properties. `innerHTML` is not sanitized, there or anywhere else.

With the compiler, `{count.value}` in JSX is reactive because the compiler wraps it. The other rules above still hold: `render()` runs once and lists go through `For`.
