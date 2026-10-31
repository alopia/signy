---
applyTo: "**"
---

# Framework comparison

Compare with other frameworks before you design a public API, name a class, method or option, or pick an architecture. Signy's own philosophy is in `project-identity.instructions.md`.

## Frameworks to compare

Pick at least five that have a real counterpart to the feature.

- **Primary:** React, Vue, Svelte, Solid, Angular.
- **Secondary, when relevant:** Preact, Lit, Qwik, Alpine.js, Mithril.

Solid is the closest relative: same fine-grained model, and Signy compiles JSX with the same `babel-plugin-jsx-dom-expressions`. Vue Router is the model for most router names (`beforeEach`, `afterEach`, `router-link-active`).

## Table format

| Framework | API | Pros | Cons |
|---|---|---|---|
| React | `createContext()` + `useContext()` | Well known | Needs a provider component |
| Vue | `provide()` / `inject()` | Simple | Untyped unless you use `InjectionKey` |
| Svelte | `setContext()` / `getContext()` | Little code | Only during component init |
| Solid | `createContext()` + `useContext()` | Reactive | Needs a provider component |
| Angular | Dependency injection | Typed, powerful | Heavy for small cases |
| **Signy** | `createContext()` + `ThemeContext.provide(this, value)` / `ThemeContext.inject(this)` | Typed, no wrapper component | Needs the component instance |

After the table, state:

- **Why** Signy picks this approach.
- **How it fits** Signy's philosophy.
- **Where it differs** from the others and what that buys.

## Rules

- Present facts, with strengths and weaknesses for each.
- Compare only frameworks with a real counterpart. Do not fill the table for the sake of it.
- Adapt, don't clone. Fit the idea to Signy's classes and signals.
- Justify every difference from the closest framework.

## Naming

A good name is:

1. **Clear** on its own: `Signal`, `Computed`, `effect`.
2. **Consistent** with Signy: a class and a lowercase factory where both make sense (`new Signal()` and `signal()`, `new Router()` and `router()`).
3. **Discoverable**: related APIs share a prefix so autocomplete groups them (`createRoot`, `createContext`, `createSelector`).
4. **Short**, without dropping meaning.
5. **Familiar** where a common name exists, but not copied blindly from one framework.
