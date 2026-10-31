---
applyTo: "**/*.ts"
---

# TypeScript standards

Write current TypeScript. The main build targets ES2022, and tsup writes the ES2017 and ES5 builds, so do not hand write legacy patterns.

## What the compiler and linter enforce

`tsconfig.json` runs `strict` plus:

- `noUncheckedIndexedAccess`: an indexed read can be `undefined`. Check it, do not cast it away.
- `noPropertyAccessFromIndexSignature`: read index signatures with brackets, `env['NODE_ENV']`.
- `verbatimModuleSyntax`: type only imports use `import type` (ESLint `consistent-type-imports` agrees).
- `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`. Prefix an unused parameter with `_`.

ESLint forbids `any`. Use `unknown` and narrow it, or a generic.

## Classes

- **Private members** use the `private` keyword and an `_` prefix: `private _value: T`. Do not use `#` fields. They are slower to downlevel and the codebase has none.
- **Getters and setters** for simple state: `signal.value`, `component.isMounted`. Methods for anything with parameters, real work, async or side effects.
- **Boolean getters** start with `is`, `has`, `can` or `should`.
- **Methods** are regular methods, not arrow function class fields.
- Initialize fields at the declaration when they do not need a constructor argument.
- Use `readonly` for fields set once.
- Always write `protected` and `private`. Write `public` only in a class that mixes visibilities, where it helps.
- Member order: see `ts-class-order.instructions.md`.

## Types

- Explicit return types on public APIs. Let inference handle locals.
- Prefer type guards to `as` casts. When a cast is needed, use `as`, never `<T>value`.
- Check `null` and `undefined` precisely (`value === null`, `value !== undefined`, `??`, `?.`). A loose `if (!value)` also catches `0`, `''` and `false`.

## Performance

Hot paths are `reactivity/`, `views/` (especially `reconcile.ts`, `insert.ts`, `control-flow.ts`) and `router/route.ts`. There:

- Plain `for` loops beat `map`, `filter` and `forEach`, and avoid closures. Use them.
- Avoid allocating per call: no spread copies, temporary arrays or objects in a loop.
- Measure before and after any change (see `benchmarking.instructions.md`).

Elsewhere, array methods, spread and destructuring are fine and read better.

## Async

Prefer `async`/`await` to `.then()` chains. Respect `AbortSignal` where an API takes one, as resources and router loaders do.

## Naming

- Classes, interfaces, types: `PascalCase`.
- Functions, methods, variables: `camelCase`.
- Constants: see `constants-usage.instructions.md`.
- Type parameters: `T`, or `TKey`, `TValue` when there are several.
