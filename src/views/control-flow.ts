/**
 * Control Flow Primitives
 *
 * Provides reactive control flow components for conditional rendering,
 * list rendering, and multi-branch conditionals. These primitives
 * automatically update when their reactive dependencies change.
 *
 * Inspired by Solid.js control flow components.
 *
 * @module views/control-flow
 *
 * @example
 * ```typescript
 * import { Show, For, Switch, Match, html, Signal } from 'signy';
 *
 * const count = new Signal(0);
 * const users = new Signal([{ id: 1, name: 'Ada' }]);
 * const tags = new Signal(['a', 'b', 'c']);
 *
 * // Conditional rendering
 * html`<${Show} when=${() => count.value > 0} fallback=${html`<p>No count</p>`}>
 *   <p>Count is ${() => count.value}</p>
 * </${Show}>`;
 *
 * // List rendering with keyed reconciliation
 * html`<${For} each=${() => users.value} key=${(user) => user.id}>
 *   ${(user, index) => html`<li>${() => index()}: ${user.name}</li>`}
 * </${For}>`;
 *
 * // Without a key, rows are keyed by item
 * html`<${For} each=${() => tags.value}>
 *   ${(tag, index) => html`<li>${() => index()}: ${tag}</li>`}
 * </${For}>`;
 * ```
 *
 * ## Known limitations
 *
 * None.
 */

import { createRenderEffect } from '../reactivity/render';
import { untrack } from '../reactivity/signal/subtle';
import {
  catchError,
  createRoot,
  getOwner,
  onCleanup,
  runWithOwner,
  type Owner,
} from '../reactivity/effect';
import { scheduleTask } from '../reactivity/signal/internal';
import { Signal } from '../reactivity/signal';
import type { Accessor } from '../reactivity/render';
import { Component } from '../component/component';
import type { ComponentClass } from '../types';
import { Markers } from '../constants';
import { logger } from '../log';
import { ViewLogMessages } from './log-messages';
import { hLazy } from './hyperscript';
import { spread } from './attributes';
import { isLiveProps, liveProps } from './live-props';
import { contentFragment } from './insert';
import {
  reconcile,
  type KeyedItem,
  type KeyFunction,
  type ReconcileKey,
} from './reconcile';

//=============================================
// Internal Helpers
//=============================================

/**
 * What a control flow is showing: its nodes and the root that owns the
 * bindings created while rendering them. A branch of several nodes ends at a
 * marker, so the nodes its bindings swap in later go with it.
 */
interface Branch {
  nodes: Node[];
  dispose: () => void;
  /** The node before the branch when it was inserted */
  start: Node | null;
  end: Node | null;
}

const EMPTY_BRANCH: Branch = {
  nodes: [],
  dispose: () => {},
  start: null,
  end: null,
};

/** Key of a branch that shows the fallback. */
const FALLBACK = Symbol('fallback');

/** No error caught yet, as an error can be any value, undefined included. */
const NO_ERROR = Symbol('no-error');

/**
 * Remembers the nodes of node content. A DocumentFragment is empty after its
 * first insert, so its children are kept to show them again, with an end
 * marker. Only the last content is kept, so fresh content (JSX getters) does
 * not pile up.
 */
class NodeCache {
  private _content: Node | Node[] | null = null;
  nodes: Node[] = [];
  end: Node | null = null;

  /**
   * Keyed by the content as given: a static array is turned into a fragment
   * once, since a fragment in it is empty after the first insert. Call it
   * under the branch's owner, so the bindings of an array belong to it.
   */
  update(given: Node | Node[]): void {
    if (given === this._content) return;
    this._content = given;
    const content = Array.isArray(given) ? contentFragment(given) : given;
    if (content instanceof DocumentFragment) {
      this.end = document.createComment(Markers.BRANCH_END);
      content.appendChild(this.end);
      this.nodes = Array.from(content.childNodes);
    } else {
      this.end = null;
      this.nodes = [content];
    }
  }
}

/**
 * The render function of For and Index. Used as a tag in `html`, h() passes
 * the function child inside an array.
 */
function childFunction<F extends (...args: never[]) => unknown>(
  children: F | F[]
): F {
  return Array.isArray(children) ? (children[0] as F) : children;
}

/**
 * Renders a branch in its own root under `owner`, untracked, so the effect
 * that picks the branch does not depend on what the branch reads and does not
 * dispose it when it re-runs. Node content is moved, never cloned, so it keeps
 * its listeners.
 */
function renderBranch(
  owner: Owner | null,
  cache: NodeCache,
  render: () => Node | Node[] | null | undefined
): Branch {
  let dispose!: () => void;
  const content = runWithOwner(owner, () =>
    createRoot((d) => {
      dispose = d;
      try {
        const given = untrack(render);
        if (given) cache.update(given);
        return given;
      } catch (error) {
        d();
        throw error;
      }
    })
  );
  if (!content) return { nodes: [], dispose, start: null, end: null };
  return { nodes: cache.nodes, dispose, start: null, end: cache.end };
}

/**
 * Disposes a branch and takes its nodes out of the DOM: everything from its
 * start to its end marker when both are in place. The nodes list is updated
 * in place, so a cached fragment shows what it holds now.
 */
function removeBranch(branch: Branch): void {
  branch.dispose();
  const { start, end, nodes } = branch;
  const parent = end?.parentNode;
  if (end && parent && start?.parentNode === parent) {
    nodes.length = 0;
    let node = start.nextSibling;
    while (node) {
      const next: ChildNode | null = node.nextSibling;
      parent.removeChild(node);
      nodes.push(node);
      if (node === end) break;
      node = next;
    }
    return;
  }
  for (const node of nodes) {
    node.parentNode?.removeChild(node);
  }
}

/** Inserts a branch right after `marker`, in order. */
function insertAfter(marker: Node, branch: Branch): void {
  const parent = marker.parentNode;
  if (!parent) return;
  branch.start = marker;
  const anchor = marker.nextSibling;
  for (const node of branch.nodes) {
    parent.insertBefore(node, anchor);
  }
}

/** Inserts a branch right before `marker`, in order. */
function insertBefore(marker: Node, branch: Branch): void {
  const parent = marker.parentNode;
  if (!parent) return;
  branch.start = marker.previousSibling;
  for (const node of branch.nodes) {
    parent.insertBefore(node, marker);
  }
}

//=============================================
// Types
//=============================================

/**
 * Props for the Show component
 */
export interface ShowProps<T> {
  /** Condition to evaluate (can be accessor or value) */
  when: T | Accessor<T>;
  /** Content to show when condition is falsy */
  fallback?: Node | null;
  /** Children to show when condition is truthy */
  children?: Node | ((value: NonNullable<T>) => Node);
}

/**
 * Props for the For component
 */
export interface ForProps<T> {
  /** Array to iterate over (can be accessor or value) */
  each: T[] | Accessor<T[]>;
  /** Fallback content when array is empty */
  fallback?: Node | null;
  /** Render function for each item */
  children: (item: T, index: Accessor<number>) => Node;
  /**
   * Key extraction function for reconciliation. Without it, each item is its
   * own key, which suits lists of objects that keep their identity. Use a key
   * when the items are recreated, for example after each fetch.
   *
   * @example
   * ```typescript
   * For({
   *   each: items,
   *   key: (item) => item.id,
   *   children: (item) => html`<li>${item.name}</li>`
   * });
   * ```
   */
  key?: KeyFunction<T>;
  /**
   * Property name to use as key (shorthand for key={item => item[keyBy]}).
   *
   * @example
   * ```typescript
   * For({
   *   each: items,
   *   keyBy: 'id',
   *   children: (item) => html`<li>${item.name}</li>`
   * });
   * ```
   */
  keyBy?: keyof T;
}

/**
 * Props for the Switch component
 */
export interface SwitchProps {
  /** Fallback content when no Match matches */
  fallback?: Node | null;
  /** Match children */
  children: Node | Node[];
}

/**
 * Props for the Match component
 */
export interface MatchProps<T> {
  /** Condition to evaluate */
  when: T | Accessor<T>;
  /** Content to show when condition is truthy */
  children?: Node | ((value: NonNullable<T>) => Node);
}

//=============================================
// Show Component
//=============================================

/**
 * Conditionally renders content based on a reactive condition.
 *
 * The `when` prop can be a value or accessor. When truthy, renders
 * children; when falsy, renders the fallback.
 *
 * @example
 * ```typescript
 * const isLoggedIn = new Signal(false);
 *
 * // With fallback
 * Show({
 *   when: () => isLoggedIn.value,
 *   fallback: html`<button onClick=${login}>Login</button>`,
 *   children: html`<p>Welcome back!</p>`
 * });
 *
 * // With accessor function for children (receives truthy value)
 * Show({
 *   when: () => user.value,
 *   children: (user) => html`<p>Hello, ${user.name}!</p>`
 * });
 * ```
 */
export function Show<T>(props: ShowProps<T>): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const marker = document.createComment(Markers.SHOW);
  fragment.appendChild(marker);

  const owner = getOwner();
  const childCache = new NodeCache();
  const fallbackCache = new NodeCache();
  let branch = EMPTY_BRANCH;
  let shownKey: unknown = undefined;
  let first = true;

  // Tracks only the condition. The branch is replaced only when the truthy
  // value changes, so the same truthy value keeps the same DOM.
  createRenderEffect(() => {
    const when = props.when;
    const value = typeof when === 'function' ? (when as Accessor<T>)() : when;
    const key = value ? value : FALLBACK;
    if (!first && Object.is(key, shownKey)) return;
    first = false;
    shownKey = key;

    removeBranch(branch);
    branch = value
      ? renderBranch(owner, childCache, () => {
          const children = props.children;
          return typeof children === 'function'
            ? children(value as NonNullable<T>)
            : children;
        })
      : renderBranch(owner, fallbackCache, () => props.fallback);
    insertAfter(marker, branch);
  });

  return fragment;
}

//=============================================
// For Component
//=============================================

/**
 * Renders a list of items reactively.
 *
 * Rows are reconciled by key (ivi algorithm), so they are reused and
 * reordered, not rebuilt. The key is `key`, `keyBy`, or the item itself.
 *
 * Each item render function receives the item and a reactive index accessor.
 * The index accessor updates automatically when items are reordered.
 *
 * @example
 * ```typescript
 * const todos = new Signal([
 *   { id: 1, text: 'Learn Signy' },
 *   { id: 2, text: 'Build app' }
 * ]);
 *
 * // With keyed reconciliation (recommended for dynamic lists)
 * For({
 *   each: () => todos.value,
 *   key: (todo) => todo.id,
 *   fallback: html`<p>No todos yet!</p>`,
 *   children: (todo, index) => html`
 *     <li>${index() + 1}. ${todo.text}</li>
 *   `
 * });
 *
 * // With keyBy shorthand
 * For({
 *   each: () => todos.value,
 *   keyBy: 'id',
 *   children: (todo) => html`<li>${todo.text}</li>`
 * });
 *
 * // Without key: keyed by the items themselves
 * For({
 *   each: () => ['a', 'b', 'c'],
 *   children: (item, index) => html`<li>${index()}: ${item}</li>`
 * });
 * ```
 */
export function For<T>(props: ForProps<T>): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const startMarker = document.createComment(Markers.FOR_START);
  const endMarker = document.createComment(Markers.FOR_END);
  fragment.appendChild(startMarker);
  fragment.appendChild(endMarker);

  // Without a key, an item is its own key, so a row lives as long as its item
  // Read once: the key function runs per item on every update
  const keyBy = props.keyBy;
  const userKey: KeyFunction<T> | null = props.key
    ? props.key
    : keyBy
      ? (item: T) => item[keyBy] as ReconcileKey
      : null;
  const keyFn: KeyFunction<T> = userKey ?? ((item: T) => item);

  let keyedItems: KeyedItem<T>[] = [];

  // Item roots belong to the owner For was created under, not to its effect
  const owner = getOwner();
  const renderItem = childFunction(props.children);
  const fallbackCache = new NodeCache();
  let fallback = EMPTY_BRANCH;
  let fallbackShown = false;

  createRenderEffect(() => {
    const parent = startMarker.parentNode;
    if (!parent) return;

    const each = props.each;
    const items =
      (typeof each === 'function' ? (each as Accessor<T[]>)() : each) ?? [];

    // As a branch, so what control flow in it added later goes too
    if (fallbackShown && items.length > 0) {
      removeBranch(fallback);
      fallbackShown = false;
    }

    if (__DEV__ && userKey) warnDuplicateKeys(items, userKey);

    // The list owns its parent, so one textContent write clears it
    const ownsParent =
      parent.firstChild === startMarker && parent.lastChild === endMarker;
    const clearAll = () => {
      parent.textContent = '';
      parent.appendChild(startMarker);
      parent.appendChild(endMarker);
    };

    if (items.length === 0 && keyedItems.length > 0 && ownsParent) {
      for (const row of keyedItems) row.dispose();
      clearAll();
      keyedItems = [];
    } else {
      keyedItems = reconcile(
        parent,
        keyedItems,
        items,
        keyFn,
        renderItem,
        endMarker,
        owner,
        ownsParent ? clearAll : undefined
      ).items;
    }

    if (items.length === 0 && !fallbackShown && props.fallback) {
      fallback = renderBranch(owner, fallbackCache, () => props.fallback);
      insertBefore(endMarker, fallback);
      fallbackShown = true;
    }
  });

  return fragment;
}

/**
 * Warns when a key function returns the same key twice. Duplicates still
 * render, each in its own row, but keep their rows only by position.
 */
function warnDuplicateKeys<T>(items: readonly T[], key: KeyFunction<T>): void {
  const seen = new Set<ReconcileKey>();
  for (let i = 0; i < items.length; i++) {
    const k = key(items[i] as T, i);
    if (seen.has(k)) {
      logger.warn(ViewLogMessages.DUPLICATE_KEY, { key: k, index: i });
      return;
    }
    seen.add(k);
  }
}

//=============================================
// Switch / Match Components
//=============================================

/**
 * Internal match result type
 */
interface MatchResult {
  /** Readers, so a JSX getter runs only when Switch asks for it */
  condition: () => unknown;
  content: () => Node | ((value: unknown) => Node) | undefined;
}

/** The match behind each Match marker, read by Switch */
const matchResults = new WeakMap<object, MatchResult>();

/**
 * Multi-branch conditional rendering.
 *
 * Evaluates Match children in order and renders the first one
 * whose `when` condition is truthy. If none match, renders fallback.
 *
 * @example
 * ```typescript
 * const status = new Signal('loading');
 *
 * Switch({
 *   fallback: html`<p>Unknown status</p>`,
 *   children: [
 *     Match({ when: () => status.value === 'loading', children: html`<${Spinner} />` }),
 *     Match({ when: () => status.value === 'error', children: html`<${ErrorMessage} />` }),
 *     Match({ when: () => status.value === 'success', children: html`<${Content} />` })
 *   ]
 * });
 * ```
 */
export function Switch(props: SwitchProps): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const marker = document.createComment(Markers.SWITCH);
  fragment.appendChild(marker);

  const owner = getOwner();
  const caches: NodeCache[] = [];
  const fallbackCache = new NodeCache();
  let branch = EMPTY_BRANCH;
  let shownIndex = -2;
  let shownValue: unknown = undefined;

  // Read once: in JSX, children is a getter that builds every Match again
  const read = untrack(() => props.children);
  const children = Array.isArray(read) ? read : read ? [read] : [];

  // Tracks only the Match conditions. The branch is replaced only when the
  // matching case or its value changes.
  createRenderEffect(() => {
    let index = -1;
    let value: unknown = undefined;
    let content: MatchResult['content'] | null = null;
    for (let i = 0; i < children.length; i++) {
      const match = matchResults.get(children[i] as object);
      if (!match) continue;
      const when = match.condition();
      const condition =
        typeof when === 'function' ? (when as Accessor<unknown>)() : when;
      if (condition) {
        index = i;
        value = condition;
        content = match.content;
        break;
      }
    }

    if (index === shownIndex && Object.is(value, shownValue)) return;
    shownIndex = index;
    shownValue = value;

    removeBranch(branch);
    if (index === -1) {
      branch = renderBranch(owner, fallbackCache, () => props.fallback);
    } else {
      const cache = (caches[index] ??= new NodeCache());
      const readContent = content!;
      branch = renderBranch(owner, cache, () => {
        const children = readContent();
        return typeof children === 'function' ? children(value) : children;
      });
    }
    insertAfter(marker, branch);
  });

  return fragment;
}

/**
 * A match case for use inside Switch.
 *
 * Returns a special marker node that Switch can evaluate.
 *
 * @example
 * ```typescript
 * Match({
 *   when: () => status.value === 'loading',
 *   children: html`<${Spinner} />`
 * });
 *
 * // With accessor function
 * Match({
 *   when: () => user.value,
 *   children: (user) => html`<p>Hello ${user.name}</p>`
 * });
 * ```
 */
export function Match<T>(props: MatchProps<T>): Comment {
  const marker = document.createComment(Markers.MATCH);

  // Switch reads the match through its marker
  matchResults.set(marker, {
    condition: () => props.when,
    content: () => props.children as ReturnType<MatchResult['content']>,
  });

  return marker;
}

//=============================================
// Index Component
//=============================================

/**
 * Like For, but the callback receives a reactive item accessor
 * and a static index. Useful when items may be swapped but indices
 * remain stable.
 *
 * @example
 * ```typescript
 * const items = new Signal(['a', 'b', 'c']);
 *
 * Index({
 *   each: () => items.value,
 *   children: (item, index) => html`
 *     <li>${index}: ${item()}</li>
 *   `
 * });
 * ```
 */
export function Index<T>(props: {
  each: T[] | Accessor<T[]>;
  fallback?: Node | null;
  children: (item: Accessor<T>, index: number) => Node;
}): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const startMarker = document.createComment(Markers.INDEX_START);
  const endMarker = document.createComment(Markers.INDEX_END);
  fragment.appendChild(startMarker);
  fragment.appendChild(endMarker);

  const owner = getOwner();
  const fallbackCache = new NodeCache();
  let fallback = EMPTY_BRANCH;
  let fallbackShown = false;

  const renderRow = childFunction(props.children);

  // One row per position. A row keeps its DOM and gets the new item through
  // its signal, so only the bindings that read the item update.
  const rows: { item: Signal<T>; branch: Branch }[] = [];

  createRenderEffect(() => {
    const each = props.each;
    const items =
      (typeof each === 'function' ? (each as Accessor<T[]>)() : each) ?? [];

    if (items.length === 0) {
      // Last first: a row starts at the node before it, the previous row's
      for (let i = rows.length - 1; i >= 0; i--) removeBranch(rows[i]!.branch);
      rows.length = 0;
      if (!fallbackShown && props.fallback) {
        fallback = renderBranch(owner, fallbackCache, () => props.fallback);
        insertBefore(endMarker, fallback);
        fallbackShown = true;
      }
      return;
    }

    if (fallbackShown) {
      removeBranch(fallback);
      fallbackShown = false;
    }

    const shared = Math.min(rows.length, items.length);
    for (let i = 0; i < shared; i++) {
      rows[i]!.item.value = items[i] as T;
    }

    for (let i = rows.length; i < items.length; i++) {
      const item = new Signal(items[i] as T);
      const index = i;
      const branch = renderBranch(owner, new NodeCache(), () =>
        renderRow(() => item.value, index)
      );
      insertBefore(endMarker, branch);
      rows.push({ item, branch });
    }

    for (let i = rows.length - 1; i >= items.length; i--) {
      removeBranch(rows[i]!.branch);
    }
    rows.length = items.length;
  });

  return fragment;
}

//=============================================
// Portal Component
//=============================================

/**
 * Renders children into a different part of the DOM tree.
 *
 * Useful for modals, tooltips, and other overlay content that
 * needs to escape the normal DOM hierarchy.
 *
 * @example
 * ```typescript
 * Portal({
 *   mount: document.body,
 *   children: html`
 *     <div class="modal">
 *       <h2>Modal Title</h2>
 *       <p>Modal content...</p>
 *     </div>
 *   `
 * });
 * ```
 */
export function Portal(props: {
  /** Target element to mount into (default: document.body) */
  mount?: Element;
  /** Content to render in the portal */
  children: Node;
}): Comment {
  const marker = document.createComment(Markers.PORTAL);
  const target = props.mount ?? document.body;

  // Moved, not cloned, so the content keeps its listeners and bindings
  const cache = new NodeCache();
  cache.update(props.children);
  const nodes = cache.nodes;
  for (const node of nodes) {
    target.appendChild(node);
  }

  // Outside an owner nothing would ever remove the nodes: onCleanup() warns
  onCleanup(() => {
    // Through the end marker, so what control flow added later goes too
    const end = cache.end;
    let node: Node | null = nodes[0] ?? null;
    if (end?.parentNode === target && node?.parentNode === target) {
      while (node) {
        const next: Node | null = node === end ? null : node.nextSibling;
        target.removeChild(node);
        node = next;
      }
      return;
    }
    for (const node of nodes) {
      if (node.parentNode === target) target.removeChild(node);
    }
  });

  return marker;
}

//=============================================
// Dynamic Component
//=============================================

/** A tag name, a component class or a function component */
export type DynamicTarget = string | ComponentClass | Function;

/**
 * Props for Dynamic. Every prop except `component` goes to what it renders.
 */
export interface DynamicProps {
  /**
   * What to render. A function that is not a Component class is read as an
   * accessor, so a function component needs `() => MyFunction`.
   */
  component:
    | DynamicTarget
    | Accessor<DynamicTarget | null | undefined>
    | null
    | undefined;
  children?: unknown;
  [prop: string]: unknown;
}

/** The check h() makes, so a class from a second copy of signy still counts */
function isComponentClass(value: Function): boolean {
  return (
    value === Component ||
    value.prototype instanceof Component ||
    typeof value.prototype?.render === 'function'
  );
}

/**
 * Copies the props to forward. For a tag, a prop that is a getter becomes an
 * accessor, so a compiled JSX prop stays reactive. Events and refs are read
 * once, as they are not bindings.
 */
function forwardedProps(
  props: DynamicProps,
  tag: boolean
): Record<string, unknown> {
  const forwarded: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    if (key === 'component' || key === 'children') continue;
    const descriptor = Object.getOwnPropertyDescriptor(props, key)!;
    if (descriptor.get && !tag) {
      // A component reads it live, as a JSX component prop
      Object.defineProperty(forwarded, key, {
        get: () => props[key],
        enumerable: true,
        configurable: true,
      });
      continue;
    }
    forwarded[key] =
      descriptor.get && tag && key !== 'ref' && !key.startsWith('on')
        ? () => props[key]
        : props[key];
  }
  return forwarded;
}

/** Renders the target of Dynamic with the other props */
function renderDynamic(target: DynamicTarget, props: DynamicProps): Node {
  // The children are read by what it renders, so a component builds them
  // under itself and they see its context
  const children =
    'children' in props
      ? () => {
          const children = props.children;
          return Array.isArray(children)
            ? children
            : children === undefined
              ? []
              : [children];
        }
      : null;
  if (!isLiveProps(props)) {
    return hLazy(
      target as string,
      forwardedProps(props, typeof target === 'string'),
      children
    );
  }
  // A dynamic spread can gain keys, so they are followed, not copied
  const forwarded = (key: PropertyKey): boolean =>
    key !== 'component' && key !== 'children';
  if (typeof target !== 'string') {
    return hLazy(target, liveProps([props], forwarded), children);
  }
  const element = hLazy(target, null, children) as Element;
  spread(element, liveProps([props], forwarded));
  return element;
}

/**
 * Renders a tag or a component chosen at runtime, and swaps it when the choice
 * changes. The other props and the children go to what it renders.
 *
 * @example
 * ```typescript
 * const view = new Signal<ComponentClass>(Inbox);
 *
 * html`<${Dynamic} component=${() => view.value} user=${user} />`;
 * html`<${Dynamic} component="h2" class="title">Hello</${Dynamic}>`;
 * ```
 */
export function Dynamic(props: DynamicProps): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const marker = document.createComment(Markers.DYNAMIC);
  fragment.appendChild(marker);

  const owner = getOwner();
  const cache = new NodeCache();
  let branch = EMPTY_BRANCH;
  let shown: unknown = FALLBACK;

  createRenderEffect(() => {
    const source = props.component;
    let target =
      typeof source === 'function' && !isComponentClass(source)
        ? (source as Accessor<DynamicTarget | null | undefined>)()
        : source;
    // A function component passed bare is called as an accessor and lands here
    if (target && typeof target !== 'string' && typeof target !== 'function') {
      if (__DEV__) logger.warn(ViewLogMessages.INVALID_DYNAMIC, { target });
      target = null;
    }
    if (Object.is(target, shown)) return;
    shown = target;

    removeBranch(branch);
    branch = target
      ? renderBranch(owner, cache, () =>
          renderDynamic(target as DynamicTarget, props)
        )
      : EMPTY_BRANCH;
    insertAfter(marker, branch);
  });

  return fragment;
}

//=============================================
// ErrorBoundary Component
//=============================================

/**
 * Catches errors in child components and renders fallback UI: errors thrown
 * while rendering and errors thrown later by the bindings and effects of the
 * children. Errors in event handlers are not caught.
 *
 * @example
 * ```typescript
 * ErrorBoundary({
 *   fallback: (error, reset) => html`
 *     <div class="error">
 *       <p>Something went wrong: ${error.message}</p>
 *       <button onClick=${reset}>Try again</button>
 *     </div>
 *   `,
 *   children: html`<${RiskyComponent} />`
 * });
 * ```
 */
export function ErrorBoundary(props: {
  /** Fallback to show when error occurs */
  fallback: (error: Error, reset: () => void) => Node;
  /** Children to render */
  children: Node | (() => Node);
}): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const marker = document.createComment(Markers.ERROR_BOUNDARY);
  fragment.appendChild(marker);

  const owner = getOwner();
  const childCache = new NodeCache();
  const fallbackCache = new NodeCache();
  let branch = EMPTY_BRANCH;
  // Errors while rendering go to the try/catch below, later ones to onError
  let rendering = false;
  let failedWith: unknown = NO_ERROR;
  // A fallback scheduled before the boundary went away must not render
  let disposed = false;
  if (owner) onCleanup(() => (disposed = true));

  const showFallback = (error: unknown): void => {
    removeBranch(branch);
    const err = error instanceof Error ? error : new Error(String(error));
    branch = renderBranch(owner, fallbackCache, () =>
      props.fallback(err, renderContent)
    );
    insertAfter(marker, branch);
  };

  const onError = (error: unknown): void => {
    if (rendering) throw error;
    // Not while the failing effect runs: it belongs to the branch to dispose
    if (failedWith !== NO_ERROR) return;
    failedWith = error;
    scheduleTask(() => {
      if (!disposed) showFallback(failedWith);
    });
  };

  const renderContent = (): void => {
    removeBranch(branch);
    failedWith = NO_ERROR;
    rendering = true;
    try {
      branch = renderBranch(owner, childCache, () =>
        catchError(() => {
          const children = props.children;
          return typeof children === 'function' ? children() : children;
        }, onError)
      );
      rendering = false;
      insertAfter(marker, branch);
    } catch (error) {
      rendering = false;
      showFallback(error);
    }
  };

  renderContent();

  return fragment;
}
