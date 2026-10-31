---
applyTo: "**"
---

# Library development guidelines

## Writing style

These rules cover documentation, code comments, log messages, commit messages, PR titles and descriptions, and issues.

- **No em dashes (`—`).** Use a hyphen, comma, colon, period or parentheses. Rewrite the sentence if needed.
- **Plain, conversational tone.** Explain it as you would to a teammate in chat.
- **No filler.** Skip "It's worth noting", "In essence", "leverage", "robust", "seamless", "comprehensive" and tricolons used for flourish.
- **Be specific.** "Fetch time went from 800 ms to 120 ms" beats "significantly faster".
- **One idea per sentence.**
- **Avoid hyphenated compounds.** Write `malformed input`, not `malformed-input`. Keep the hyphen only when the sentence breaks without it, as in `fine-grained`.
- **American English** (`color`, not `colour`) and **active voice**.
- **Sentence case headings.** Capitalize only the first word, plus proper nouns, acronyms and code (`TC39`, `JavaScript`, `flushAll()`).
- **No AI attribution** in commits, PRs, comments or docs.

### Code comments

- One line where one line does, two at most.
- Say why, not what. The code already says what.
- Delete comments that restate the name.
- Background, alternatives and measurements go in the commit message or the PR, not the source.
- Use JSDoc for public APIs, with an `@example` where it helps.

### Emoji

- None in `.ts` files, comments or log messages.
- None in `.md` prose. A table that summarizes features may use them.
- Fine in example HTML that shows UI.

A little fun in comments and docs is welcome when it stays clear.

## Development stage

Signy is released. What a change may break depends on the branch it targets, see `development-policy.instructions.md`.

## Module documentation

Each module opens with a JSDoc block that says what it does and lists its known limitations, or says "None":

```typescript
/**
 * Keyed list reconciliation.
 *
 * Known limitations:
 * - Moving a row across two lists recreates it.
 */
```

Keep it current. When a fix removes a limitation, remove the line. Bug history goes in the commit message, not the header.

## Renaming, moving and deleting modules

1. Update every import to the new location. Do not leave a re-export behind.
2. Rename or delete the matching test files in `test/`.
3. Update or remove related docs, here, in `ai/signy-usage.md` and in `../signy.website`.

## Files and tests

- Write tests as test files, not `node -e "..."` one liners.
- Prefer your file writing tool over shell heredocs. If you use a heredoc, quote the delimiter so `${var}` is not expanded.
- Name test files after the module they cover.

## Brand colors

For CSS, pages and any visual material across the Signy ecosystem (website, docs, examples, dev tools):

- **Yellow** `#FFD648`: primary accent, highlights.
- **Red** `#FF0059`: errors, warnings, destructive actions.
- **Green** `#00CF68`: success, confirmations.

## When in doubt

Look at how similar code in `src/` does it and match that. The other files in `.github/instructions/` cover constants, logging, TypeScript, class order, module structure, framework comparison and benchmarks.
