---
applyTo: "**/*.ts"
---

# Constants

Give a value with meaning a name instead of repeating a literal. Do it for event names, comment marker names, data attributes, states, log message ids and numbers with a meaning (limits, timeouts).

Inline literals are fine for a single use where the value says it all, for test data, and for presentational text.

## Where they go

- **`src/constants.ts`**: values shared across modules or part of the public API. Today: `VERSION`, `ENV`, `EVENTS`, `Markers` (comment marker names for control flow), `LazyStates`, `DATA_ATTR_SHADOW`, and the `isServer`, `isClient`, `isDev`, `isProd` flags.
- **Top of the module that owns it**: values one area uses, such as `SVG_NAMESPACE` in `src/views/hyperscript.ts`. Export one only when a sibling module needs it, as `html.ts` and `hyperscript.ts` share `DELEGATED_EVENTS` from `src/views/events.ts`.
- **`log-messages.ts` in each module**: log message ids (see `logging.instructions.md`).
- **Build time globals** from `src/globals.d.ts`: `__DEV__` and `__VERSION__`, replaced by tsup. Guard dev only code with `if (__DEV__)` so it drops out of production builds.

## Naming

- `UPPER_SNAKE_CASE` for single values: `DATA_ATTR_SHADOW`, `SVG_NAMESPACE`.
- `PascalCase` for a group of related values: `Markers`, `LazyStates`.
- Say what it means: `DEFAULT_ROUTER_MODE`, not `MODE`.

## Groups

Use an `as const` object, and derive the type from it:

```typescript
export const LazyStates = {
  IDLE: 'idle',
  LOADING: 'loading',
  READY: 'ready',
  ERROR: 'error',
} as const;

export type LazyState = (typeof LazyStates)[keyof typeof LazyStates];
```

New code uses `as const` objects, not TypeScript enums. The enums that exist (`AppStatus`, `NavigationFailureType`, and the `const enum`s `LogLevel` and `LogFormat`) stay as they are.

## Docs

Give each exported constant a one line JSDoc. Mark internal ones `@internal`.
