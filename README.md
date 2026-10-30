# Signy

A modern UI JS framework built on signals. Fine-grained reactivity, no virtual DOM, written in TypeScript.

Docs and examples: [signy.dev](https://signy.dev).

## Install

```bash
npm install signy
```

## Quick start

```typescript
import { Signal, Component, application, html } from 'signy';

class Counter extends Component {
  private count = new Signal(0);

  protected render() {
    return html`
      <button onClick=${() => this.count.set((c) => c + 1)}>
        Clicked ${() => this.count.value} times
      </button>
    `;
  }
}

application(Counter).mount('#app');
```

`render()` runs once. Only functions such as `${() => this.count.value}` update.

`html` works without a build step. JSX needs `babel-plugin-jsx-dom-expressions` with `moduleName: 'signy/jsx'`, see [JSX and TypeScript](https://signy.dev/documentation/1/overview/jsx-and-typescript/).

## Entry points

| Import | What you get |
|---|---|
| `signy` | Everything, plus `flushAll` for tests |
| `signy/core` | Reactivity primitives: `Signal`, `Computed`, `effect`, `batch`, `createRoot`. No DOM |
| `signy/web` | Core plus `html`, `h`, control flow, `Component`, context, DOM helpers, resources and transitions |
| `signy/router` | Router |
| `signy/store` | Deep reactive store |
| `signy/app` | `application()` and plugins |
| `signy/jsx` | The runtime compiled JSX calls |
| `signy/jsx-runtime` | JSX types for `jsxImportSource` |

## Script tag builds

`dist/signy.global.prod.js` defines a `Signy` global. `signy.core.global.prod.js` and `signy.web.global.prod.js` are smaller builds of the same global. `signy.store.global.prod.js` adds `SignyStore` on top of one of them, so load it after.

```html
<script src="https://unpkg.com/signy/dist/signy.global.prod.js"></script>
```

## Browser support

The main builds target ES2022 and use class fields and `??=`, so they run in Chrome 85, Firefox 79, Safari 14.1 and newer. For older browsers the package ships ES2017 and ES5 builds, such as `dist/signy.es2017.js` and `dist/signy.global.es5.prod.js`. They change the syntax only, the browser still needs `Proxy`, `Promise`, `Map`, `Set` and `queueMicrotask`.

## Lifecycle hooks

```typescript
class Clock extends Component {
  private now = new Signal(new Date());

  protected setup(): void {
    this.onMount(() => {
      const timer = setInterval(() => (this.now.value = new Date()), 1000);
      // Runs on unmount
      return () => clearInterval(timer);
    });
  }

  protected render() {
    return html`<p>${() => this.now.value.toLocaleTimeString()}</p>`;
  }
}
```

`onMount(callback)` runs after mount and may return a cleanup function. `onUnmount(callback)` runs before cleanup.

## For AI assistants

[`ai/signy-usage.md`](ai/signy-usage.md) is a short guide to writing Signy code, with the mistakes to avoid. It is also served at [signy.dev/ai/signy-usage.md](https://signy.dev/ai/signy-usage.md).

## Dev tools

[`signy-dev`](https://github.com/alopia/signy-dev) adds a profiler, an inspector, an event logger and readable log messages. Import it in development only.

## Development

```bash
npm install
npm test               # unit, JSX and type tests
npm run test:browser   # Chromium, Firefox and WebKit, needs Playwright browsers
npm run build          # modern ESM build and types
npm run build:all      # every build
npm run test:package   # the built package, after build:all
npm run bench          # benchmarks, see .github/instructions/benchmarking.instructions.md
npm run check          # lint, format check, typecheck, tests, full build, package checks
```

Contributor and AI agent rules are in [`AGENTS.md`](AGENTS.md).

## License

[MIT](LICENSE.md)
