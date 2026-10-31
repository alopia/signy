/**
 * Suspense Component for Async Boundaries
 *
 * Suspense provides a declarative way to handle loading states for async
 * components and data. It displays a fallback while any lazy components
 * within its boundary load, or any resource read within it has its first
 * fetch pending.
 *
 * @module views/suspense
 *
 * @example
 * ```typescript
 * import { Suspense, lazy, html } from 'signy';
 *
 * const LazyChart = lazy(() => import('./Chart'));
 * const LazyTable = lazy(() => import('./Table'));
 *
 * // Single lazy component
 * html`
 *   <${Suspense} fallback=${html`<div class="loader">Loading...</div>`}>
 *     <${LazyChart} data=${data} />
 *   </${Suspense}>
 * `;
 *
 * // Multiple lazy components - waits for all
 * html`
 *   <${Suspense} fallback=${html`<div>Loading dashboard...</div>`}>
 *     <${LazyChart} />
 *     <${LazyTable} />
 *   </${Suspense}>
 * `;
 *
 * // Nested Suspense with different fallbacks
 * html`
 *   <${Suspense} fallback=${html`<div>Loading page...</div>`}>
 *     <header>Always visible</header>
 *     <${Suspense} fallback=${html`<div>Loading chart...</div>`}>
 *       <${LazyChart} />
 *     </${Suspense}>
 *   </${Suspense}>
 * `;
 * ```
 *
 * ## Known limitations
 *
 * **Hidden children keep running**: while the fallback shows, the children
 * stay alive in a detached fragment, so their effects and bindings run.
 *
 * **No streaming**: Does not support streaming SSR patterns. The entire
 * Suspense boundary resolves before showing children.
 */

import { Signal } from '../reactivity';
import { createRenderEffect } from '../reactivity/render';
import { untrack } from '../reactivity/signal/subtle';
import { createRoot, getOwner, runWithOwner } from '../reactivity/effect';
import {
  runInSuspenseBoundary,
  type SuspenseBoundary,
} from '../reactivity/suspense-boundary';
import { Markers } from '../constants';
import { contentFragment } from './insert';

//=============================================
// Types
//=============================================

/**
 * Props for the Suspense component
 */
export interface SuspenseProps {
  /** Content to show while loading */
  fallback?: Node | Node[] | (() => Node | Node[]);
  /** Children that may contain lazy components */
  children?: Node | Node[] | (() => Node | Node[]);
}

//=============================================
// Suspense Implementation
//=============================================

/**
 * Creates a Suspense boundary for async content.
 *
 * Suspense tracks all pending promises within its boundary and shows
 * the fallback content until all promises resolve. This includes:
 * - Lazy-loaded components created with `lazy()`
 * - Resources whose `value` is read inside while their first fetch is pending
 *
 * @param props - Suspense configuration and children
 * @returns A DocumentFragment containing the Suspense boundary
 *
 * @example
 * ```typescript
 * // Basic usage
 * Suspense({
 *   fallback: html`<div>Loading...</div>`,
 *   children: html`<${LazyComponent} />`
 * });
 *
 * // With loading spinner component
 * Suspense({
 *   fallback: () => html`<${LoadingSpinner} size="large" />`,
 *   children: () => html`<${LazyDashboard} />`
 * });
 * ```
 */
export function Suspense(props: SuspenseProps): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const startMarker = document.createComment(Markers.SUSPENSE_START);
  const endMarker = document.createComment(Markers.SUSPENSE_END);

  fragment.appendChild(startMarker);
  fragment.appendChild(endMarker);

  const pendingPromises = new Set<Promise<unknown>>();
  const isPending = new Signal(false);

  const boundary: SuspenseBoundary = {
    register: (promise) => {
      pendingPromises.add(promise);
      isPending.value = true;
    },
    unregister: (promise) => {
      pendingPromises.delete(promise);
      if (pendingPromises.size === 0) {
        isPending.value = false;
      }
    },
  };

  const owner = getOwner();

  // Children render once and stay alive while the fallback shows, so what
  // they started loading is not started again. Whichever is shown sits
  // between the markers. Hidden children wait in `hidden`.
  const hidden = document.createDocumentFragment();

  // The boundary's owner is adopted by `owner`, so the children are disposed
  // with it
  const children = runWithOwner(owner, () =>
    runInSuspenseBoundary(boundary, () => {
      const content = props.children;
      return untrack(() =>
        toContent(typeof content === 'function' ? content() : content)
      );
    })
  );
  for (const node of toNodes(children)) {
    fragment.insertBefore(node, endMarker);
  }

  // The fallback renders in its own root, outside the boundary, and is
  // disposed when hidden
  let disposeFallback: (() => void) | null = null;
  // A static fallback is shown again with the nodes it had: a fragment is
  // empty after its first insert
  let fallbackContent: unknown = undefined;
  let fallbackNodes: Node[] = [];

  const showFallback = (): void => {
    moveBetween(startMarker, endMarker, hidden);
    runWithOwner(owner, () =>
      createRoot((dispose) => {
        disposeFallback = dispose;
        const fallback = props.fallback;
        const content = untrack(() =>
          typeof fallback === 'function' ? fallback() : fallback
        );
        if (content !== fallbackContent || typeof fallback === 'function') {
          fallbackContent = content;
          fallbackNodes = toNodes(toContent(content));
        }
      })
    );
    const parent = endMarker.parentNode;
    for (const node of fallbackNodes) parent?.insertBefore(node, endMarker);
  };

  const showChildren = (): void => {
    disposeFallback?.();
    disposeFallback = null;
    const shown = document.createDocumentFragment();
    moveBetween(startMarker, endMarker, shown);
    fallbackNodes = Array.from(shown.childNodes);
    endMarker.parentNode?.insertBefore(hidden, endMarker);
  };

  let shownPending = false;
  createRenderEffect(() => {
    const pending = isPending.value;
    if (pending === shownPending) return;
    shownPending = pending;
    if (pending) showFallback();
    else showChildren();
  });

  return fragment;
}

/** An array, as an html template with several roots returns, as a fragment */
function toContent(
  content: Node | Node[] | null | undefined
): Node | null | undefined {
  return Array.isArray(content) ? contentFragment(content) : content;
}

/** Content as a flat list of nodes. A template with several roots is an array. */
function toNodes(content: Node | Node[] | null | undefined): Node[] {
  if (!content) return [];
  return (Array.isArray(content) ? content : [content]).flatMap((node) =>
    node instanceof DocumentFragment ? Array.from(node.childNodes) : [node]
  );
}

/** Moves the nodes between start and end into target. */
function moveBetween(start: Node, end: Node, target: Node): void {
  let node = start.nextSibling;
  while (node && node !== end) {
    const next = node.nextSibling;
    target.appendChild(node);
    node = next;
  }
}
