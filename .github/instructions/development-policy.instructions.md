---
applyTo: "**"
---

# Development Policy

Signy follows [semantic versioning](https://semver.org). Every major has its own branch, and the rules for a change depend on the branch it targets: the next major favors the best design, a released major favors compatibility.

## Versions

The public API is everything the entry points export (`signy`, `signy/core`, `signy/web`, `signy/app`, `signy/router`, `signy/store`, `signy/jsx`, `signy/jsx-runtime`), the behavior that `ai/signy-usage.md` and the website docs describe, the `data-signy-*` attributes, the global names `Signy` and `SignyStore`, and the file names in `dist`. Internals, `@internal` exports, comments, tests and `bench/` are not part of it.

- **Patch** (`1.0.1`): bug fixes that keep the API. A fix may change behavior when the old behavior was the bug.
- **Minor** (`1.1.0`): new exports, options and behavior. Nothing existing is renamed, removed or changes meaning.
- **Major** (`2.0.0`): anything that breaks the API, such as a renamed export, a removed option or a changed default.

## Branches

- **One branch per major, named `{major}.x`**: `1.x`, `2.x` and so on, for every past, current and future major.
- **`main` holds the latest released major.** It only moves forward by merging from that major's branch.
- **Work lands on the major branch first.** A minor or patch is merged into `{major}.x`. Once it is decided to release it, `{major}.x` is merged into `main` and the release is tagged there.
- **The next major gets its branch when work on it starts**, at the latest when its first tag is created. That branch keeps living after the release, for the minors and patches of that major.
- **A new major cuts `main` off from older majors.** Once `2.x` is merged into `main` and `2.0.0` is tagged, nothing from `1.x` reaches `main` again.
- **Older majors release from their own branch.** A minor or patch that keeps an older major supported, such as `1.4.2` after `2.0.0`, is tagged on `1.x`, never on `main`.

Tags are the plain version, such as `1.0.0`, with no `v` prefix. Each release gets release notes on GitHub: what was added, what was fixed and, for a major, what broke.

A fix needed in several majors is made on each branch on its own terms. Do not merge an older major branch into a newer one, or the other way around.

## Next major branch: the best design wins

The branch of a major that has no release yet. Its rules favor big improvements.

- **Breaking changes are allowed.** Rename, move, merge or delete exports, options, files and docs when it gives a better design.
- **Size of the change does not matter.** If the right fix touches 40 files, touch 40 files. Do not settle for a local patch when the real problem is the structure around it.
- **Fix the cause, not the symptom.** When you find a design flaw while working on something else, say so and propose the proper fix.
- **No aliases, shims or deprecations.** Rename or remove cleanly. The release notes list every break.
- **Remove dead code.** Do not comment it out or leave it "just in case".

## Released major branches: compatibility wins

The branch of the current major and of every older major still supported. Its rules favor stability for the apps already using that version.

- **Never break the API.** A minor only adds, a patch only fixes. If the right fix needs a break, say so and propose it for the next major branch instead.
- **Keep the change as small as the fix allows.** Prefer a local fix that leaves everything else as it is over a restructure. A restructure waits for the next major.
- **Existing apps must behave the same,** except for the bug being fixed. A behavior change needs a reason in the commit.
- **Fix the cause where it is safe.** When the proper fix would break something, ship the safe fix here and propose the proper one for the next major.
- **Remove dead code only when it is not part of the API.** Unused public exports stay until the next major.
- **New features are additive and marked.** A feature added in a minor release gets an "Added in" badge in the website docs.
- **Log ids and dev feature events are a contract with `signy-dev`.** Keep them, or change them together with a matching release of `signy-dev`.

## On every branch

- Update everything the change affects. Source, tests, `ai/signy-usage.md`, the website docs and examples (`../signy.website`) and `signy-dev` (`../signy-dev`) must match the new state in the same change.
- A release is documented in one website PR: it sets the pin, updates the pages and adds the version page entry. See `docs-versioning.instructions.md` in the website repo.
- Follow the rules in the other instruction files (style, TypeScript, class order, module structure, constants, logging).
- Keep `npm run check` passing, and add a benchmark comparison for any change that can affect runtime (see `benchmarking.instructions.md`).
- If two good options trade off against each other, explain the tradeoff briefly and recommend one instead of picking silently.
- When it is not clear which branch a change targets, ask before you start.
