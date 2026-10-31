# AGENTS.md

Instructions for any AI tool or agent working on Signy. The full rules live in `.github/instructions/`. Read the ones listed below before you act.

## Always read

- `.github/instructions/project-identity.instructions.md`: framework name, package names, repos and paths.
- `.github/instructions/development-policy.instructions.md`: versioning, branches per major, and the rules for the next major versus a released one.
- `.github/instructions/general.instructions.md`: writing style for docs, comments and commits, development stage, module headers.
- `.github/instructions/framework-comparison.instructions.md`: how Signy relates to other frameworks.

## Read when editing TypeScript

- `.github/instructions/typescript-standards.instructions.md`: TypeScript standards.
- `.github/instructions/ts-class-order.instructions.md`: the order of members inside a class.
- `.github/instructions/module-structure.instructions.md`: module layout and import and export patterns.
- `.github/instructions/constants-usage.instructions.md`: where constants go.
- `.github/instructions/logging.instructions.md`: log messages and levels.

## Layout

Development needs Node 22.22.2+, 24.15+ or 26+, for jsdom 30. `.tool-versions` pins the version CI uses. The package itself needs no Node: it runs in browsers.

- `src/`: the framework source. `npm run build` writes `dist/`, `npm run build:all` adds the minified, legacy and global builds.
- `test/`: Vitest tests, mirroring `src/`. See Tests below.
- `bench/`: shell benchmarks with saved baselines and comparisons. See Benchmarks below.
- `ai/signy-usage.md`: how to write apps with Signy, for AI assistants. The website serves it as `/ai/signy-usage.md` and every site example follows it, so a change to public API or behavior needs a matching edit here.
- `.github/prompts/`: reusable prompts for fixing and improving tests.
- The docs, examples and site live in `alopia/signy.website`, checked out in `../signy.website`. It builds against this checkout, so a change to the public API needs a matching change there.
- The dev tools (`signy-dev`) live in `alopia/signy-dev`, checked out in `../signy-dev`. It builds against this checkout, so a change to log message ids or dev feature events needs a matching change there.

## Tests

Vitest projects, picked by path:

- `unit`: `test/**/*.test.ts` in jsdom. Unit tests mirror `src/`, `test/integration/` drives small apps through the public entry point, `test/properties/` holds fast-check property tests.
- `jsx`: `test/jsx/**/*.test.tsx`, compiled by babel-plugin-jsx-dom-expressions like user code.
- `types`: `test/types/**/*.test-d.ts`, type checked with `expectTypeOf`, never run.
- `browser`: `test/browser/**/*.browser.test.ts` in headless Chromium, Firefox and WebKit, for layout, scrolling, history traversal and Shadow DOM. `npm run test:browser`, needs `npx playwright install chromium firefox webkit` once, and `sudo npx playwright install-deps` for the WebKit system libraries. `SIGNY_BROWSERS=chromium,firefox` runs a subset.
- `package`: `test/package/`, against `dist/` after `npm run build:all`, including the script tag builds in headless Chromium. `npm run test:package` also runs publint and attw.

Helpers in `test/support/`:

- `mount(ComponentOrRenderFn, { plugins })` mounts through `application()` and unmounts after the test. `createTestRouter(routes, options)` gives a memory router destroyed after the test.
- `testRoot(fn)` runs reactive code in an owned root disposed after the test, for code without a component.
- `settle()` runs all pending notifications, effects and DOM updates synchronously (it calls `flushAll()`). `settleAsync()` waits for pending promises first, for loaders and lazy imports. `tick()` waits one macrotask, `microtask()` one microtask.
- Any `console.error` or `console.warn` fails the test. Claim expected output with `expectLogged('warn', 'reactivity:cleanup-error')`, or all of it with `ignoreLogged()`. Tests run at log level `warn`.
- A known bug gets an `it.fails` test with a comment, so the test flips once the bug is fixed.
- After each test, setup fails it when the scheduler is left stuck (open batch, running flush) or a disposed effect or unwatched computed is still subscribed to a source (`src/reactivity/testing.ts`), then resets the scheduler. `mount()` also fails when an effect created while its apps were mounted is still live after they unmount.

Mutation testing: `npm run test:mutation` runs Stryker over `reactivity/`, `views/reconcile.ts` and `router/route.ts`, about an hour, on demand in the `Mutation` workflow (`gh workflow run mutation.yml`). Narrow it while working: `npx stryker run --mutate "src/router/route.ts:500-560"`. The report lands in `reports/mutation/`.

Keep `npm run check` passing: ESLint, Prettier, typecheck, tests with coverage thresholds, the full build and the package checks. The `CI` workflow runs it and the browser tests, only when started by hand: `gh workflow run ci.yml`.

## Benchmarks

Read `.github/instructions/benchmarking.instructions.md` before changing anything in `src/` that can affect runtime.

- Before the change, with `src/` and `bench/` committed: `npm run bench -- --save before-<topic>`.
- After it, with tests passing: `npm run bench -- --save after-<topic> --compare before-<topic>`.
- Run it alone in the foreground. Confirm any `slower` or `noisy` case with `--ab <baseline sha> --filter "<case id>"`. Report every regression with its number.
- Paste the comparison into the reply and the PR. Never commit `bench/results/`.
