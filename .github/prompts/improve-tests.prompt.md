---
agent: agent
---

# Improve tests

Improve the tests for the source folder given with this prompt (for example `src/router`). Fix what is broken, then close the gaps that matter most.

Read the Tests section of `AGENTS.md` first. It lists the Vitest projects and the helpers in `test/support/`.

When a test calls a function that no longer exists, ask before writing a replacement.

## Steps

1. Run `npm run test:coverage` and note the coverage of each file in the folder.
2. Read the source and list what a user can do with it. Compare with the tests and find:
   - behavior with no test,
   - tests that only check that something exists (`toBeDefined()`, `typeof x === 'function'`),
   - tests that reach into private members instead of the public API,
   - tests that mock so much they would pass with a broken implementation.
3. Fix the existing tests first (see `fix-tests.prompt.md`).
4. Add tests for the gaps, most used behavior first. Prefer the public entry point, `mount()` and Testing Library queries over internals. Reactive code without a component goes in `testRoot()`.
   - Rendering in jsdom: `unit`. JSX: `test/jsx/`. Types: `test/types/`. Layout, scrolling, history traversal, Shadow DOM: `test/browser/`.
   - A large input space (lists, paths, query strings): add a fast-check property in `test/properties/`.
5. When a new test finds a bug, fix it if the fix is small and clear. Otherwise mark it `it.fails` with a one line comment and report it.
6. Run `npm run check` until it passes. Raise the coverage thresholds in `vitest.config.ts` if coverage went up.

## Report

- Tests added, fixed and removed.
- Coverage before and after for the folder.
- Source bugs found, fixed or not.
- Anything left open.
