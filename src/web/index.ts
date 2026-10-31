/**
 * Signy Web - DOM Bindings and Components
 *
 * This package extends Signy Core with DOM-specific utilities for building
 * web applications. It includes everything from core plus:
 *
 * - DOM utilities (query, manipulation, refs, events)
 * - Views (html template, For, Show, Switch/Match, Suspense)
 * - Component base class
 * - Context/DI system
 *
 * For the minimal reactive core without DOM, use `signy/core`.
 * For the full framework with App and Router, use `signy`.
 *
 * @module web
 *
 * @example
 * ```typescript
 * import {
 *   Signal,
 *   effect,
 *   html,
 *   For,
 *   Show,
 *   Component,
 *   createRef
 * } from 'signy/web';
 *
 * class TodoList extends Component {
 *   private items = new Signal<string[]>([]);
 *   private inputRef = createRef<HTMLInputElement>();
 *
 *   protected render() {
 *     return html`
 *       <div>
 *         <input ref=${this.inputRef} type="text" />
 *         <button onClick=${() => {
 *           const input = this.inputRef.current;
 *           if (input?.value) {
 *             this.items.value = [...this.items.value, input.value];
 *             input.value = '';
 *           }
 *         }}>Add</button>
 *
 *         <ul>
 *           ${For({ each: () => this.items.value, children: (item) => html`<li>${item}</li>` })}
 *         </ul>
 *       </div>
 *     `;
 *   }
 * }
 * ```
 *
 * ## What's in Web?
 *
 * Everything from Core, plus:
 *
 * - **DOM**: Query, manipulation, refs, event listeners
 * - **Views**: html template literal, For, Show, Switch/Match, Suspense, Lazy
 * - **Components**: Component base class with lifecycle
 * - **Context**: Dependency injection (provide/inject)
 * - **Transitions**: Deferred, batched updates with a pending state
 * - **Resources**: Async data fetching with Suspense integration
 * - **Map Arrays**: Reactive list rendering utilities
 *
 * ## What's NOT in Web?
 *
 * - Application framework (use `signy/app` or `signy`)
 * - Router (use `signy/router` or `signy`)
 * - Store (use `signy/store` or `signy`)
 */

//=============================================
// Re-export everything from Core
//=============================================

export * from '../core';

//=============================================
// DOM Utilities
//=============================================

export * from '../dom';

//=============================================
// Views (Templates and Control Flow)
//=============================================

export * from '../views';

//=============================================
// Components
//=============================================

export * from '../component';

//=============================================
// Context / Dependency Injection
//=============================================

export * from '../context';

//=============================================
// Additional Reactivity (not in core)
//=============================================

// Transitions
export {
  Transition,
  startTransition,
  useTransition,
  transition,
  createDeferred,
  isTransition,
  getTransitionPromise,
  getGlobalPending,
  type TransitionResult,
  type TransitionOptions,
  type DeferredOptions,
} from '../reactivity/transition';

// Resources (async data)
export {
  Resource,
  resource,
  type ResourceState,
  type ResourceOptions,
  type Fetcher,
  type SimpleFetcher,
  type FetcherInfo,
} from '../reactivity';

// Map Arrays (reactive lists)
export {
  mapByItem,
  mapByIndex,
  type MapByItemFn,
  type MapByIndexFn,
  type MapArrayOptions,
} from '../reactivity/map-array';

// Render utilities
export { text, dynamic } from '../reactivity/render';

//=============================================
// Utils
//=============================================

export * from '../utils';

//=============================================
// Types
//=============================================

export type * from '../types';
