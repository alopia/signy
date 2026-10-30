---
applyTo: "**/*.ts"
---

# Logging

## Rules

- Never call `console.*` in `src/`, except inside `src/log/` where the logger writes. JSDoc `@example` blocks may show it.
- Log through `logger` (or a scoped logger) from `src/log`.
- Use a message id constant from the module's `log-messages.ts`, not a free text string.
- Keep logging out of hot paths. Use a lazy message when building the text costs something.

## Levels

From most to least severe:

| Method | Use for |
|---|---|
| `logger.error()` | A failure the framework recovered from, or the user must fix |
| `logger.warn()` | A likely mistake that does not stop the app |
| `logger.info()` | Normal operation worth noting |
| `logger.debug()` | Details for debugging |
| `logger.trace()` | Most verbose, adds a stack trace |

Dev builds (`__DEV__`) log at `warn` and above by default, production builds at `error` only. Users change it with `globalConfig.configure({ logLevel: 'info' })`. `shouldLog(LogLevel.DEBUG)` tells whether a level is on.

To stop execution, throw instead of logging. `panic()`, `assert()` and `createError()` from `src/log/error.ts` take the same parameters as the logger and build a `SignyError`:

```typescript
panic(ComponentLogMessages.MOUNT_FAILED, { target });
assert(router !== undefined, RouterLogMessages.NOT_INSTALLED);
```

## Logger API

Each method takes up to two parameters, `logger.warn(p1?, p2?)`. Each is one of:

- a message id, a string with `:` such as `'reactivity:effect-error'`,
- a plain message, a string without `:`,
- a context object, `{ error, path }`,
- a lazy message, a function returning a string.

```typescript
logger.error(AppLogMessages.NOT_MOUNTED);
logger.warn(ReactiveLogMessages.CLEANUP_ERROR, { error });
logger.debug(() => `State: ${JSON.stringify(state)}`);
```

Scoped loggers prefix their output: `createLogger('Router')` prints `[signy:Router]`, and `.child('Guards')` prints `[signy:Router:Guards]`.

## Message ids

Ids are `module:kebab-case`, lowercase: `reactivity:effect-error`, `router:no-match`, `view:lazy-outside-suspense`.

Each module keeps its ids in a `log-messages.ts` that exports an `as const` object, one JSDoc line per id:

```typescript
// src/component/log-messages.ts
export const ComponentLogMessages = {
  /** Failed to mount component. Target element not found or invalid */
  MOUNT_FAILED: 'component:mount-failed',
} as const;
```

The files today: `app/log-messages.ts` (`AppLogMessages`), `app/installable-log-messages.ts` (`InstallableLogMessages`), `component/` (`ComponentLogMessages`), `context/` (`ContextLogMessages`), `core/` (`CoreLogMessages`, `FeatureLogMessages`), `reactivity/` (`ReactiveLogMessages`), `reactivity/signal/` (`SignalLogMessages`), `router/` (`RouterLogMessages`), `views/` (`ViewLogMessages`).

### Adding an id

1. Add the constant to the module's `log-messages.ts`.
2. Add its readable text to `LOG_MESSAGES` in `../signy-dev/src/log-messages.ts`. The `signy-dev` tests fail when an id has no text. Production output shows the id only, dev tools resolve it to the text through `getLogMessage()`.
3. Renaming or removing an id also needs that matching change in `signy-dev`.

## Tests

The console guard in `test/support/` fails a test on any `console.warn` or `console.error` it does not claim. Claim expected output with `expectLogged('warn', 'reactivity:cleanup-error')`, or `ignoreLogged()` when the exact output does not matter. Do not mock or silence the console.
