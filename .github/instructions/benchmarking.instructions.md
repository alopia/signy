---
applyTo: "src/**,bench/**"
---

# Benchmarking

`bench/` measures Signy from the shell. Use it before and after any change that can affect runtime, so every change comes with a before and after.

## The loop

1. **Before changing anything in `src/`**, with no uncommitted changes in `src/` or `bench/`, save a baseline:

   ```sh
   npm run bench -- --save before-<topic>
   ```

   It takes about 3 minutes, more with the browser tier, which `--save`
   includes whenever Playwright's Chromium is installed
   (`npx playwright install chromium`). Note the commit it prints.

   A change to rendering code (`views/`, `component/`, `jsx/`, `router/`
   components) needs that browser baseline: the node tier has no DOM.

   Skip this only when the change cannot affect runtime: docs, tests, comments, types only.
2. **Run it alone, in the foreground.** No tests, builds, watchers or other benchmarks at the same time. Do not run it in the background while doing other work.
3. **Implement the change.** Get `npm test` passing first. A benchmark of broken code is useless.
4. **Run it again, saved and compared:**

   ```sh
   npm run bench -- --save after-<topic> --compare before-<topic>
   ```

   Exit code 1 means a regression was found, 2 means the tool itself failed.
5. **Read every verdict that is not `same`:**
   - `faster`, `better`, `smaller`: report them.
   - `slower`: rerun that case on its own with `npm run bench -- --filter "<case id>" --compare before-<topic>`. If it is still `slower`, confirm with an interleaved run against the baseline commit: `npm run bench -- --ab <baseline sha> --filter "<case id>"`. If that confirms it, fix it or report it to the user with the number and the cause. Never leave a regression out of the report.
   - `noisy`: the median moved past the threshold but the worker processes overlap. Rerun with `--ab <baseline sha> --filter "<case id>"`. If it stays `noisy`, say so and do not quote its delta.
   - `worse` on a memory metric: treat it as a leak until explained.
   - `larger` on a bundle size: report the byte change. It is not a failure.
   - `new` or `removed`: a case was added or deleted since the baseline. Expected only if you changed `bench/` on purpose.
6. **Report** the comparison in the reply and in the PR description. Paste the table from `bench/results/after-<topic>.md`. When it is long, run `npm run bench:compare -- before-<topic> after-<topic> --md --changed-only` and paste that.

## Rules

- **Do not edit `bench/` between the baseline and the after run.** The compare warns when the benchmark sources changed. If a benchmark needs to change, commit that change first and take a new baseline.
- **Add the benchmark before the change.** When a feature or a performance fix has no case yet, add the case in its own commit, then take the baseline, so the before run measures it too.
- **Never commit `bench/results/`.** Numbers belong to one machine. It is git ignored.
- **Never use `--quick` for a baseline or an after run.** It runs one process with few samples and is only a smoke check while writing a benchmark.
- **Read the warnings in the report header.** Different CPU, Node or pinned CPU, or a baseline with uncommitted changes, make the comparison unreliable. Say so in the report.

## Commands

| Command | Does |
| --- | --- |
| `npm run bench` | Run every suite and print the report. |
| `npm run bench -- --save <name>` | Also write `bench/results/<name>.json` and `<name>.md`. Refuses to overwrite without `--force`. |
| `npm run bench -- --compare <base>` | Compare with a saved result. |
| `npm run bench -- --browser` | Also run the browser tier in headless Chromium. `--save` adds it on its own when Chromium is installed. |
| `npm run bench -- --ab <git ref>` | Build `src/` of the ref and run it interleaved with the working tree. The most reliable answer for one case. |
| `npm run bench -- --filter <text>` | Only cases whose `suite/case` id contains the text, for example `reactivity/` or `"list/mapByItem: swap"`. |
| `npm run bench -- --threshold <pct>` | Smallest median change that counts, default 5. |
| `npm run bench -- --json` | Print JSON instead of the report. |
| `npm run bench:solid` | Run the reactivity, store and list suites on Signy and on Solid through `bench/adapters/`, and save one table to `bench/results/solid-<date>.md`. A side by side, never a baseline and never used with `--compare`. Cases with no clean Solid equivalent are listed as skipped. |
| `npm run bench:compare -- <a> <b>` | Compare two saved results without running anything. `--md`, `--changed-only`, `--json`. |
| `npm run bench -- --help` | All options. |

`--cpu <n>` (or `BENCH_CPU`) picks the CPU to pin to, default 2. On a hybrid Intel CPU pick a performance core, the report says which kind it got.

## How it measures

- `bench/build.ts` bundles the working tree with esbuild and `__DEV__` set to false. Suites never import `src/` or `dist/` at runtime.
- Each suite runs in 5 fresh worker processes, pinned with `taskset`. One process cannot see its own JIT and CPU frequency luck, which on a desktop moves medians by 5 to 15%.
- A time case is `slower` or `faster` only when the median moved by at least 5% (`--threshold`), a Mann-Whitney test on the samples is significant, and every process on one side beat every process on the other.
- Memory cases each run in their own process. They report heap growth over a second batch of cycles after a first warm batch, plus counters such as effect runs after dispose. Microtasks run between cycles, as in an app: in one synchronous loop, the flush each cycle queues piles up and reads as a leak of about 30 B per cycle.
- Bundle sizes are esbuild minified and brotli compressed, so they track changes and do not match the published terser output exactly.

## Writing a case

Suites live in `bench/suites/*.bench.ts` and default export `defineSuite()` from `bench/suite.ts`. A case gets the bundled module as `s` and returns:

- **time cases**: `{ run, beforeEach?, teardown? }`. `run` must be repeatable. If it needs a reset, put the reset in `beforeEach`, which is not timed.
- **memory cases**: `{ cycle, cycles, probe?, teardown? }`. `probe` returns counters where a leak free build reports 0 or 1.

Keep the case name stable. It is the key used to match results across runs, so renaming a case shows up as `removed` plus `new`.

Suites with `tier: 'browser'` (`bench/suites/dom.bench.ts`) run in headless Chromium through Playwright: `bench/browser.ts` bundles the suite, the Signy build and `bench/measure.ts`, which also runs the node tier, into one page, so both tiers save the same result format and work with `--compare` and `--ab`.

- Each job gets a fresh browser, as a node job gets a fresh process. The page is served from a local origin with COOP and COEP, so it is cross origin isolated and `performance.now()` has 5µs resolution. Samples are 1ms long for that reason.
- Memory uses `performance.memory` with `--enable-precise-memory-info` and `gc()` from `--js-flags=--expose-gc`. Chromium does not tell a page when a GC ran, so an allocation count that went negative is retried.
- The browser is not pinned to a CPU, so expect more `noisy` verdicts than in the node tier.
- A case that awaits, like a navigation, sets `async: true`. It is timed one op per sample and gets no allocation count.

Router navigation, `reconcile`, DOM rendering and anything else that needs `window` or a DOM goes in the browser tier. `bench/suites/router.bench.ts` is node tier and covers route matching only, navigation waits for the browser tier.
