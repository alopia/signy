---
applyTo: "**/*.ts"
---

# Module structure, imports and exports

## Layout

Each area of `src/` is a directory with an `index.ts` barrel: `reactivity/`, `views/`, `component/`, `context/`, `dom/`, `router/`, `app/`, `jsx/`, `log/`, `utils/`, `types/`. A directory may also hold:

- `log-messages.ts`: its log message ids,
- `types.ts`: shared types, when there are enough of them,
- one file per feature: `reconcile.ts`, `control-flow.ts`, `history.ts`.

Tests do not live in `src/`. They mirror it under `test/`: `src/router/route.ts` is tested in `test/router/route.test.ts`.

File names are lowercase kebab case: `map-array.ts`, `suspense-boundary.ts`, `log-messages.ts`.

## Imports inside `src/`

- Import a public API from the area's barrel: `import { logger } from '../log'`, `import { effect } from '../reactivity'`.
- Import straight from the file for internals the barrel does not export, or to break an import cycle: `import { trackSource } from '../reactivity/signal/internal'`.
- Use `import type` for type only imports. `verbatimModuleSyntax` requires it.
- Relative paths only. The only `tsconfig.json` paths are `signy/jsx` and `signy/jsx-runtime`, for JSX types.
- Order: external packages, other areas (`../`), same directory (`./`), with a blank line between groups.

Avoid import cycles. Move the shared piece into its own file, or pass it in, rather than importing back and forth.

## Exports

- Named exports only, no `export default`.
- Area barrels use `export *` from their files, plus `export type *` for type files. Leave out what is internal: `views/index.ts` exports only the types from `reconcile.ts`.
- Entry points (`src/core/index.ts`, `src/web/index.ts`) list their exports by name. They decide what each subpath ships, so adding an API to `signy/core` or `signy/web` is a deliberate edit there.
- No code in an `index.ts`, only re-exports. `src/core/index.ts` re-binds a few internals for the store global build, that is the exception.
- Mark exports users should not touch with `/** @internal */`, or do not export them.

## Package imports

Users import from `signy` or one of its subpaths (`signy/core`, `signy/web`, `signy/router`, `signy/store`, `signy/app`, `signy/jsx`). There is no deep import into `src/` paths such as `signy/reactivity`.

Dev tools live in the separate `signy-dev` package, so none of their code reaches a production bundle:

```typescript
import { enableDevTools, Profiler, Inspector } from 'signy-dev';
```

## Side effects

`package.json` sets `"sideEffects": false`. Keep modules free of top level side effects (no global writes, no logging at import time) so bundlers can drop what is not used.

## Renaming and deleting

See `general.instructions.md`: update every import, move or delete the matching tests, leave no re-export behind.
