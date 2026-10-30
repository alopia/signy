---
applyTo: "**"
---

# Project identity and naming

All project specific names, repos and paths live here. When renaming the project, only this file needs to change.

## Names

- **Framework name:** Signy (capital S) in prose, README text and comments that describe the framework.
- **Package namespace:** `signy` (lowercase) in package names, imports, file paths and directory names.

```typescript
// Signy provides fine-grained reactivity
import { Signal } from 'signy';
```

Correct inconsistent casing when you find it.

### Packages

- `signy`: the framework.
- `signy-dev`: dev tools (profiler, inspector, event logger, readable log messages).
- `signy-ui`: UI components. Planned, no repo yet.

### Repos and paths

- **Framework repo:** `alopia/signy`, published to npm as `signy`. Holds the framework only.
- **Source:** `src/`, tests in `test/` mirroring `src/`.
- **Framework constants:** `src/constants.ts`.
- **Usage rules for AI assistants:** `ai/signy-usage.md`. The website serves it as `/ai/signy-usage.md`.
- **Website repo:** `alopia/signy.website`, checked out in `../signy.website`. Holds the docs, examples and site, built against this checkout.
- **Dev tools repo:** `alopia/signy-dev`, checked out in `../signy-dev`. Holds `signy-dev`, built against this checkout.

### Entry points

| Import | Source | What it holds |
|---|---|---|
| `signy` | `src/index.ts` | Everything |
| `signy/core` | `src/core/index.ts` | Reactivity primitives, logging, dev feature hooks. No DOM |
| `signy/web` | `src/web/index.ts` | Core plus DOM, views, components, context, transitions, resources |
| `signy/app` | `src/app/index.ts` | `application()` and plugins |
| `signy/router` | `src/router/index.ts` | Router |
| `signy/store` | `src/reactivity/store.ts` | Deep reactive store |
| `signy/jsx` | `src/jsx/index.ts` | Functions compiled JSX calls |
| `signy/jsx-runtime`, `signy/jsx-dev-runtime` | `src/jsx/jsx-runtime.ts` | JSX types for `jsxImportSource` |

Script tag builds define globals: `signy.global.prod.js` defines `Signy`, with `core` and `web` variants. The store global (`SignyStore`) shares the runtime of a core or web global, so one of those loads first. `npm run build:all` also writes ES2017 and ES5 builds.

## Philosophy

Signy is a reactive TypeScript UI framework under active development:

- **Fine-grained reactivity** with no virtual DOM. `render()` runs once, bindings update.
- **Modern first:** current ECMAScript and strict TypeScript. Legacy browsers get separate builds.
- **Performance by default:** runtime changes come with a benchmark (see `benchmarking.instructions.md`).
- **Type safety and little boilerplate,** no magic.
- **Classes where they fit:** `Component`, `Signal`, `Computed`, `Router`. Factory functions (`signal()`, `router()`) sit next to them.
- **Client side only for now.** No server side rendering, hydration, streaming or meta framework. Do not add them or design APIs around them unless the maintainer says the scope changed. Keep code safe to import in Node, so tests and a later SSR step stay possible.
- **Adapt, don't clone.** Signy borrows from Solid, Vue and others but keeps its own API. Justify each difference.

## Data attributes

Data attributes use the `data-signy-*` namespace:

- `data-signy-shadow` (`DATA_ATTR_SHADOW`), set on shadow DOM hosts.
- `data-signy-head` (`DATA_ATTR_HEAD`), set on the head tags `useHead()` creates.
