---
agent: agent
---

# Fix tests

Fix the failing or outdated tests in the folder given with this prompt (for example `test/router`). Fix tests only, do not add new ones.

Read the Tests section of `AGENTS.md` first. It lists the Vitest projects and the helpers in `test/support/`.

When a test calls a function that no longer exists, ask before writing a replacement.

## Steps

1. Run `npx vitest run <folder>` and note every failure and every unexpected console output.
2. For each failing test, read the source it covers and decide which side is wrong.
   - The test is wrong: update it to the current API.
   - The source is wrong: say so, and fix it only if the fix is small and clear. Otherwise mark the test `it.fails` with a one line comment naming the bug.
3. Replace local flush helpers with `settle()` or `settleAsync()`, manual mounting with `mount()`, and hand made `createRoot()` wrappers with `testRoot()`.
4. Claim expected warnings and errors with `expectLogged()` instead of silencing the console.
5. Delete tests for removed features and duplicates. Say why in the summary.
6. Run `npm run typecheck` and `npx vitest run <folder>` until both pass.

## Report

- Tests fixed, removed and marked `it.fails`, with the reason for each removal.
- Source bugs found, fixed or not.
- Anything left open.
