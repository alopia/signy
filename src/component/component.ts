/**
 * Base Component class with Solid-style rendering and hierarchical DI
 *
 * Components use an owner chain pattern for dependency injection:
 * - Parent components are captured during render via getCurrentComponent()
 * - provide() makes values available to descendants
 * - inject() walks up the owner chain to find values
 *
 * Components support **fine-grained reactivity**: the render() method runs
 * once at mount. Reactive updates happen at the binding level using accessor
 * functions like `${() => signal.value}` in templates. This is the Solid.js
 * pattern - component functions run once, bindings update in place.
 *
 * **Shadow DOM Support**: Components can enable Shadow DOM for CSS isolation
 * via the `shadow` property or constructor option. This is essential for
 * micro frontends and embeddable widgets.
 *
 * @module component/component
 *
 * @example
 * ```typescript
 * import { Component, html, Signal } from 'signy';
 *
 * class Counter extends Component {
 *   private count = new Signal(0);
 *
 *   protected render() {
 *     // render() runs ONCE. The ${() => ...} creates a reactive binding
 *     // that updates just that text node when count changes.
 *     return html`
 *       <div>
 *         <span>Count: ${() => this.count.value}</span>
 *         <button onClick=${() => this.count.value++}>+</button>
 *       </div>
 *     `;
 *   }
 * }
 *
 * // With Shadow DOM for isolation
 * class IsolatedWidget extends Component {
 *   protected shadow = true;
 *   protected styles = ':host { display: block; padding: 16px; }';
 *
 *   protected render() {
 *     return html`<div class="widget"><slot></slot></div>`;
 *   }
 * }
 * ```
 *
 * ## Known limitations
 *
 * **Shadow DOM style inheritance**: Inherited styles (font, color) pass
 * through shadow boundaries by design. Use CSS custom properties (--var)
 * for theming across shadow boundaries.
 */

import type {
  ComponentClass,
  ComponentOptions,
  RenderResult,
  InjectionKey,
  VNode,
  ShadowOptions,
  NormalizedShadowOptions,
} from '../types';
import type { Application } from '../app/application';
import { getElement } from '../dom';
import { appendChildren } from '../views/append';

import { panic, logger } from '../log';
import { ComponentLogMessages } from './log-messages';
import { AppLogMessages } from '../app/log-messages';
import { ReactiveLogMessages } from '../reactivity/log-messages';
import {
  CONTEXT_INJECT,
  CONTEXT_PROVIDE,
  getCurrentComponent,
  IS_COMPONENT,
} from '../context/owner';
import {
  adoptOwner,
  createRoot,
  detachOwner,
  disposeOwned,
  getOwner,
  OWNER_DISPOSE,
  runWithOwner,
  type Owner,
} from '../reactivity/effect';
import { features, isFeaturesActive } from '../core/features';
import { DATA_ATTR_SHADOW, Markers } from '../constants';
import { appliedStyles } from './applied-styles';
import { onResetForTests, scheduleTask } from '../reactivity/signal/internal';
import { untrack } from '../reactivity/signal/subtle';
import {
  mergeShadowOptions,
  attachShadow,
  applyStyles,
  mergeStyles,
  shouldUseShadowDOM,
  getSlottedElements,
  getSlottedNodes,
  hasSlottedContent,
  onSlotChange,
  createComposedEvent,
  SHADOW_DOM_SUPPORTED,
} from './shadow';

/**
 * Prefix for shadow host custom element tag names.
 * Used to create descriptive element names like `<signy-my-widget>`.
 */
const SHADOW_HOST_PREFIX = 'signy-';

/**
 * Component lifecycle status
 */
const enum ComponentStatus {
  /** Component created but not yet mounted */
  CREATED = 0,

  /** Component successfully mounted to DOM */
  MOUNTED = 1,

  /** Component unmounted from DOM and cannot be used again */
  UNMOUNTED = 2,
}

/**
 * Base component class that provides core functionality for creating UI components.
 *
 * Uses Solid-style rendering where:
 * - render() returns DOM elements (Element | DocumentFragment | void)
 * - Child components are created via h() / html`` during render
 * - Owner chain enables hierarchical provide/inject
 *
 * @example
 * ```typescript
 * import { Component, html } from 'signy';
 *
 * class MyComponent extends Component {
 *   protected render() {
 *     return html`
 *       <div class="my-component">
 *         <h1>Hello World</h1>
 *         <${ChildComponent} message="Hi" />
 *       </div>
 *     `;
 *   }
 * }
 *
 * const app = application(MyComponent);
 * app.mount('#app');
 * ```
 *
 * @example
 * ```typescript
 * // With typed props
 * interface CardProps {
 *   title: string;
 *   description?: string;
 * }
 *
 * class Card extends Component<CardProps> {
 *   protected render() {
 *     return html`<div class="card">
 *       <h2>${this.props.title}</h2>
 *       <p>${this.props.description ?? 'No description'}</p>
 *     </div>`;
 *   }
 * }
 * ```
 */
export class Component<
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  //=============================================
  // Protected Fields
  //=============================================

  /** Props passed to this component */
  protected readonly props: P;

  /** The DOM element where the component is mounted */
  protected container: Element | null = null;

  /** Component configuration options (immutable after creation) */
  protected readonly options: ComponentOptions;

  /**
   * Enable Shadow DOM for this component.
   * Set to `true` for default options or provide a configuration object.
   *
   * @example
   * ```typescript
   * // Simple boolean
   * class Widget extends Component {
   *   protected shadow = true;
   * }
   *
   * // With options
   * class IsolatedWidget extends Component {
   *   protected shadow: ShadowOptions = {
   *     mode: 'open',
   *     delegatesFocus: true,
   *   };
   * }
   * ```
   */
  protected shadow?: boolean | ShadowOptions;

  /**
   * Styles to apply to Shadow DOM.
   * Only used when shadow DOM is enabled.
   *
   * Can be a string, array of strings, or CSSStyleSheet objects.
   * Using CSSStyleSheet (Constructable Stylesheets) provides the best
   * performance as styles are shared across instances.
   *
   * @example
   * ```typescript
   * class Widget extends Component {
   *   protected shadow = true;
   *   protected styles = `
   *     :host { display: block; padding: 16px; }
   *     .content { background: #f0f0f0; }
   *   `;
   * }
   *
   * // Multiple style sources
   * class FancyWidget extends Component {
   *   protected shadow = true;
   *   protected styles = [
   *     baseStyles,        // Shared from design system
   *     componentStyles,   // Component-specific
   *   ];
   * }
   * ```
   */
  protected styles?: string | string[] | CSSStyleSheet[];

  //=============================================
  // Private Fields
  //=============================================

  /** Reference to the parent application instance */
  private _app: Application | null = null;

  /** Reference to the parent component (captured during construction) */
  private _parent: Component | null = null;

  /** Current lifecycle status of the component */
  private _status: ComponentStatus = ComponentStatus.CREATED;

  /** Provided values for descendant injection */
  private _providers = new Map<string | symbol, unknown>();

  /** Disposes the owner of the last render, see _renderOwned() */
  private _disposeRender: (() => void) | null = null;

  /** The owner of the last render, so what its content inserts goes with it */
  private _renderOwner: Owner | null = null;

  /** Shadow root if shadow DOM is enabled */
  private _shadowRoot: ShadowRoot | null = null;

  /**
   * What mount() and update() added to a container that is not ours: its first
   * and last node. Unmount removes those and the nodes between them, and
   * nothing the page put around them.
   */
  private _rendered: { first: Node; last: Node } | null = null;

  /** First node of a child render, for the mount event of dev tools */
  private _firstNode: Node | null = null;

  /** The container is a wrapper this component made, so it may be emptied */
  private _ownsContainer = false;

  /** Resolved shadow options (null if shadow disabled) */
  private _shadowOptions: NormalizedShadowOptions | null = null;

  /** Slot change cleanup functions */
  private _slotCleanups: Array<() => void> = [];

  /** onSlotChange() calls made before the render, run by _finishMount() */
  private _pendingSlotListeners: Array<() => void> | null = null;

  /** Mount callbacks - run after mount, can return cleanup */
  private _mountCallbacks: Array<() => void | (() => void)> = [];

  /** Unmount callbacks - run before unmount */
  private _unmountCallbacks: Array<() => void> = [];

  /** Cleanup functions from mount callbacks */
  private _cleanups: Array<() => void> = [];

  /** Unique component ID */
  private readonly _id: string;

  //=============================================
  // Owner Interface Implementation
  //=============================================

  /**
   * Parent owner in the reactive ownership tree.
   * Enables onCleanup() to register cleanups on the component.
   * @internal
   */
  owner: Owner | null = null;

  /**
   * Owned children (effects, render roots, child components), disposed when
   * the component unmounts. A doubly linked list.
   * @internal
   */
  ownedHead: Owner | null = null;

  /** @internal */
  ownedTail: Owner | null = null;

  /** @internal */
  ownedNext: Owner | null = null;

  /** @internal */
  ownedPrev: Owner | null = null;

  /**
   * Marks this owner as a component for getCurrentComponent().
   * @internal
   */
  readonly [IS_COMPONENT] = true as const;

  /**
   * Cleanup functions registered via onCleanup().
   * Run when component unmounts.
   * @internal
   */
  cleanups: (() => void)[] | null = null;

  /**
   * Context for reactive dependency injection.
   * @internal
   */
  context: Record<symbol, unknown> | null = null;

  /** Static counter for generating unique IDs */
  private static _instanceCounter = 0;

  /**
   * Name used for `name`, ids and shadow host tags. Defaults to the class
   * name, which a minifier may rename, so set it in code that ships minified.
   *
   * @example
   * ```typescript
   * class TodoList extends Component {
   *   static displayName = 'TodoList';
   * }
   * ```
   */
  static displayName?: string;

  //=============================================
  // Getters
  //=============================================

  /**
   * Unique identifier for this component instance.
   * Used for tracking and debugging.
   */
  get id(): string {
    return this._id;
  }

  /**
   * Component name: the static `displayName`, or the class name.
   * Used for debugging and DevTools display.
   */
  get name(): string {
    return (
      (this.constructor as typeof Component).displayName ??
      this.constructor.name
    );
  }

  /**
   * Whether this component is currently mounted.
   */
  get isMounted(): boolean {
    return this._status === ComponentStatus.MOUNTED;
  }

  /**
   * Gets the shadow root of this component, if shadow DOM is enabled.
   * Returns null if shadow DOM is not enabled or not yet attached.
   *
   * @example
   * ```typescript
   * class Widget extends Component {
   *   protected shadow = true;
   *
   *   protected setup() {
   *     this.onMount(() => {
   *       // Access shadow root after mount
   *       const root = this.shadowRoot;
   *       root?.querySelector('.content');
   *     });
   *   }
   * }
   * ```
   */
  protected get shadowRoot(): ShadowRoot | null {
    return this._shadowRoot;
  }

  /**
   * Gets the render target for this component.
   * Returns shadowRoot if shadow DOM is enabled, otherwise container.
   */
  protected get renderTarget(): Element | ShadowRoot | null {
    return this._shadowRoot ?? this.container;
  }

  /**
   * Whether shadow DOM is enabled for this component.
   */
  protected get hasShadow(): boolean {
    return this._shadowRoot !== null;
  }

  /**
   * Gets the application instance for this component.
   * Walks up the parent chain to find the app (root component always has it).
   *
   * @throws {Error} If no application instance is found
   */
  protected get app(): Application {
    const app = this._findApp();
    if (!app) panic(AppLogMessages.NOT_FOUND);
    return app;
  }

  /**
   * Gets the parent component in the owner chain.
   * Returns null for root components.
   */
  protected get parent(): Component | null {
    return this._parent;
  }

  //=============================================
  // Constructor
  //=============================================

  /**
   * Creates a new component instance.
   * Captures the current owner (parent component) from the render context.
   *
   * Shadow DOM is resolved during construction:
   * - Constructor option takes precedence over class property
   * - `shadow: false` in constructor disables shadow even if class has `shadow = true`
   *
   * @param props - Props passed to the component
   * @param options - Component configuration options
   */
  constructor(props: P = {} as P, options: ComponentOptions = {}) {
    this.props = props;
    this.options = options;

    // Capture parent from current render context (Solid-style owner chain)
    this._parent = getCurrentComponent();

    // Set app reference if provided (for micro-frontends)
    if (this.options.app) {
      this._app = this.options.app;
    }

    // Assign unique ID
    this._id = `${this.name}-${++Component._instanceCounter}`;

    // Emit component create event for dev tools
    if (isFeaturesActive()) features.emit.componentCreate(this);
  }

  //=============================================
  // Dependency Injection
  //=============================================

  /**
   * Provides a value to this component's descendants.
   * Descendants can access this value via inject().
   *
   * @template T - Type of the provided value
   * @param key - Injection key (string or symbol)
   * @param value - Value to provide
   *
   * @example
   * ```typescript
   * const ThemeKey = Symbol('theme') as InjectionKey<string>;
   *
   * class App extends Component {
   *   protected setup() {
   *     this.provide(ThemeKey, 'dark');
   *   }
   * }
   * ```
   */
  protected provide<T>(key: string | symbol | InjectionKey<T>, value: T): void {
    this._providers.set(key as string | symbol, value);
  }

  /**
   * Injects a value from an ancestor component.
   * Walks up the owner chain to find the nearest provider.
   * Falls back to app-level services if not found in component tree.
   *
   * @template T - Type of the injected value
   * @param key - Injection key (string or symbol)
   * @param defaultValue - Optional default value if not found
   * @returns The injected value or default
   *
   * @example
   * ```typescript
   * class Button extends Component {
   *   protected setup() {
   *     const theme = this.inject(ThemeKey, 'light');
   *     console.log('Using theme:', theme);
   *   }
   * }
   * ```
   */
  protected inject<T>(
    key: string | symbol | InjectionKey<T>,
    defaultValue?: T
  ): T | undefined {
    // Walk up the owner chain
    let current: Component | null = this;

    while (current) {
      if (current._providers.has(key as string | symbol)) {
        return current._providers.get(key as string | symbol) as T;
      }
      current = current._parent;
    }

    // Fall back to app-level services (router, plugins, etc.)
    const appValue = this._findApp()?.get<T>(key as string | symbol);
    return appValue !== undefined ? appValue : defaultValue;
  }

  /**
   * Binds the root component to its application. False when it already
   * belongs to one.
   *
   * @internal
   */
  _bindApp(app: Application): boolean {
    if (this._app) return false;
    this._app = app;
    return true;
  }

  /** @internal For createContext() */
  [CONTEXT_PROVIDE](key: symbol, value: unknown): void {
    this.provide(key, value);
  }

  /** @internal For createContext() */
  [CONTEXT_INJECT](key: symbol): unknown {
    return this.inject(key);
  }

  //=============================================
  // Lifecycle
  //=============================================

  /**
   * Mounts the component to a DOM element.
   *
   * Lifecycle order:
   * 1. setup() method
   * 2. options.setup() callback
   * 3. Attach Shadow DOM (if enabled)
   * 4. Apply styles (if Shadow DOM)
   * 5. render() - with this component as owner
   * 6. onMount() callbacks (cleanups collected)
   *
   * @param target - DOM element or CSS selector where component should be mounted
   * @throws {Error} If the mount target is not found in the DOM
   * @throws {Error} If the component is already mounted
   *
   * @example
   * ```typescript
   * // Components must be mounted via Application
   * application(MyComponent).mount('#app');
   * ```
   */
  mount(target: Element | string): void {
    if (this._status !== ComponentStatus.CREATED) {
      panic(ComponentLogMessages.ALREADY_MOUNTED);
    }

    // Components require an Application context
    // Use application(Component).mount() instead of new Component().mount()
    if (!this._app && !this._parent) {
      panic(ComponentLogMessages.APP_REQUIRED);
    }

    this.container = getElement(target);
    if (!this.container) {
      panic(ComponentLogMessages.MOUNT_FAILED);
    }

    this._resolveShadowOptions();

    try {
      // Setup phase - run with this component as the reactive owner
      // so onCleanup() calls register on the component
      runWithOwner(this, () =>
        untrack(() => {
          this.setup();
          this._runOptionsSetup();
        })
      );

      // Attach Shadow DOM if enabled
      this._attachShadowIfNeeded();

      // Determine render target (shadow root or container)
      const renderTarget = this._shadowRoot ?? this.container;

      // Render once with this component as owner.
      // Fine-grained reactivity is handled by accessor functions in templates:
      // ${() => signal.value} creates reactive bindings that update in place.
      // This follows Solid.js pattern - component functions run once.
      const content = this._renderOwned();

      // Append rendered content to render target
      if (content && renderTarget) {
        this._inRender(() => {
          if (this._shadowRoot) this._appendContent(renderTarget, content);
          else this._appendToContainer(renderTarget as Element, content);
        });
      }
    } catch (error) {
      // Nothing owns a root, so what setup() started would stay live
      this._unmount(true);
      throw error;
    }

    // The children are in the document now, they mount before their parent
    flushChildMounts();
    this._finishMount();
  }

  /**
   * Unmounts the component from the DOM.
   *
   * Lifecycle order:
   * 1. onUnmount() callbacks
   * 2. Cleanup functions from onMount()
   * 3. Dispose reactive render effect
   * 4. Unmount all child components
   * 5. Clean up effects and listeners
   * 6. Remove what the component added to its container. Nodes that were in
   *    the container before, or that the page added around the component,
   *    stay.
   *
   * After unmounting, components cannot be remounted.
   * Calling unmount() on an already unmounted component is a no-op.
   */
  unmount(): void {
    this._unmount(true);
  }

  /**
   * Manually forces a full re-render of the component.
   *
   * Note: With fine-grained reactivity, you typically don't need this.
   * Reactive bindings like `${() => signal.value}` update automatically.
   * Use this only when you need to force a complete DOM rebuild.
   *
   * Lifecycle order:
   * 1. Unmount child components
   * 2. Remove what the component added to its container
   * 3. Re-run render()
   */
  update(): void {
    if (this._status !== ComponentStatus.MOUNTED || !this.container) {
      return;
    }

    this._performUpdate();
  }

  /**
   * Runs fn under the owner of the last render. A binding among the roots of a
   * template is inserted here, and must be disposed with the render.
   */
  private _inRender(fn: () => void): void {
    runWithOwner(this._renderOwner, fn);
  }

  /**
   * Internal helper to append render content to a target.
   * Handles both single VNode and VNode[] cases.
   * Works with both Element and ShadowRoot.
   */
  private _appendContent(
    target: Element | ShadowRoot,
    content: VNode | VNode[]
  ): void {
    appendChildren(target, Array.isArray(content) ? content : [content]);
  }

  /**
   * Internal method to perform the actual update.
   * Called by update() for manual forced re-renders.
   */
  private _performUpdate(): void {
    const renderTarget = this._shadowRoot ?? this.container;
    if (!renderTarget) return;

    // Clear content, but keep the styles applyStyles() added
    if (this._shadowRoot) {
      let child = this._shadowRoot.firstChild;
      while (child) {
        const next = child.nextSibling;
        if (!appliedStyles.has(child)) {
          this._shadowRoot.removeChild(child);
        }
        child = next;
      }
    }
    // Where the old content was, so the new one takes its place
    const anchor = this._rendered?.last.nextSibling ?? null;
    if (!this._shadowRoot && this.container) this._clearRendered();

    // Re-render
    const content = this._renderOwned();
    if (content) {
      this._inRender(() => {
        if (this._shadowRoot) this._appendContent(renderTarget, content);
        else this._appendToContainer(renderTarget as Element, content, anchor);
      });
    }
  }

  /**
   * Appends content to a container and remembers where it went. Control flow
   * leaves a comment marker among the top level nodes, a function child shows
   * nodes that it swaps later, and in both the last node can change. So such a
   * root gets a closing comment, a boundary that never moves. A root of
   * elements and text does not.
   *
   * @param anchor - Put the content before this node, for update()
   */
  private _appendToContainer(
    container: Element,
    content: VNode | VNode[],
    anchor: Node | null = null
  ): void {
    const before = container.lastChild;
    let marked = Array.isArray(content)
      ? content.some((item) => typeof item === 'function')
      : typeof content === 'function';
    this._appendContent(container, content);
    const first = before ? before.nextSibling : container.firstChild;
    let last = container.lastChild;
    if (!first || !last || last === before) return;

    for (let node: Node | null = first; node; node = node.nextSibling) {
      if (node.nodeType === Node.COMMENT_NODE) marked = true;
      if (node === last) break;
    }
    if (marked) {
      last = container.appendChild(
        document.createComment(Markers.COMPONENT_END)
      );
    }

    if (anchor && anchor.parentNode === container) {
      for (let node: Node | null = first; node;) {
        const next: Node | null = node === last ? null : node.nextSibling;
        container.insertBefore(node, anchor);
        node = next;
      }
    }
    this._rendered = { first, last };
  }

  /**
   * Removes the nodes this component added to its container, from the first
   * to the last. It stops at a node that left the container, such as one
   * moved by a portal.
   */
  private _clearRendered(): void {
    const range = this._rendered;
    this._rendered = null;
    const parent = this.container;
    if (!range || !parent) return;
    let node: Node | null = range.first;
    while (node && node.parentNode === parent) {
      const next: Node | null = node === range.last ? null : node.nextSibling;
      parent.removeChild(node);
      node = next;
    }
  }

  //=============================================
  // Rendering
  //=============================================

  /**
   * Renders the component and returns DOM content.
   * Override this method to define the component's view.
   *
   * This method runs **once** at mount time (Solid.js pattern).
   * Reactive updates are handled by accessor functions in templates:
   * `${() => signal.value}` creates a binding that updates in place.
   *
   * This component is set as the current owner during render, so child
   * components created via h() or html`` will capture this as their parent.
   *
   * @returns DOM element, DocumentFragment, or null
   *
   * @example
   * ```typescript
   * protected render() {
   *   return html`
   *     <div class="counter">
   *       <!-- Static text - rendered once -->
   *       <span>Count: ${() => this.count.value}</span>
   *       <!--          ^^^^^^ Reactive binding - updates when count changes -->
   *       <button onClick=${() => this.count.value++}>+</button>
   *     </div>
   *   `;
   * }
   * ```
   */
  protected render(): RenderResult {
    return null;
  }

  /**
   * Renders a child component and tracks it for lifecycle management.
   * Use this for imperative child component creation.
   *
   * @template T - Component type
   * @param ComponentClass - Component class to instantiate
   * @param props - Component props
   * @param options - Component options
   * @returns The rendered DOM from the child component
   *
   * @example
   * ```typescript
   * protected render() {
   *   const header = this.renderChild(Header, { title: 'My App' });
   *   const content = this.renderChild(Content);
   *   return html`<div>${header}${content}</div>`;
   * }
   * ```
   */
  protected renderChild<T extends Component, P = Record<string, unknown>>(
    ComponentClass: new (props: P, options?: ComponentOptions) => T,
    props?: P,
    options?: ComponentOptions
  ): RenderResult {
    // Created under this component, so it finds us as its parent
    const child = runWithOwner(
      this,
      () => new ComponentClass(props as P, options)
    );

    // Render child using _renderAsChild for proper lifecycle and shadow DOM support
    return child._renderAsChild();
  }

  //=============================================
  // Setup Hook
  //=============================================

  /**
   * Setup hook for initializing component state and dependencies.
   * Called once during mount, before render.
   *
   * Use this to:
   * - Inject dependencies from ancestors
   * - Provide values to descendants
   * - Register lifecycle hooks
   * - Initialize reactive state
   *
   * @example
   * ```typescript
   * protected setup(): void {
   *   // Inject from parent
   *   const api = this.inject(ApiKey);
   *
   *   // Provide to children
   *   this.provide('userId', 123);
   *
   *   // Register hooks with cleanup
   *   this.onMount(() => {
   *     const timer = setInterval(() => console.log('tick'), 1000);
   *     return () => clearInterval(timer);  // Cleanup
   *   });
   * }
   * ```
   */
  protected setup(): void {}

  //=============================================
  // Lifecycle Hooks
  //=============================================

  /**
   * Register a callback to run after component is mounted.
   * Can return a cleanup function that runs on unmount.
   *
   * @param callback - Function to run after mount, may return cleanup
   *
   * @example
   * ```typescript
   * this.onMount(() => {
   *   console.log('Mounted!');
   *   const timer = setInterval(() => {}, 1000);
   *   return () => clearInterval(timer);  // Automatic cleanup
   * });
   * ```
   */
  protected onMount(callback: () => void | (() => void)): void {
    this._mountCallbacks.push(callback);
  }

  /**
   * Register a callback to run before component unmounts.
   *
   * @param callback - Function to run before unmount
   *
   * @example
   * ```typescript
   * this.onUnmount(() => {
   *   console.log('Goodbye!');
   *   this.saveState();
   * });
   * ```
   */
  protected onUnmount(callback: () => void): void {
    this._unmountCallbacks.push(callback);
  }

  //=============================================
  // Internal Helpers
  //=============================================

  /**
   * Renders in a fresh root owned by this component. The bindings of the
   * previous render are disposed first, effects from setup() stay.
   *
   * @internal
   */
  _renderOwned(): RenderResult {
    this._disposeRender?.();
    const start = isFeaturesActive() ? performance.now() : 0;
    try {
      const result = runWithOwner(this, () =>
        createRoot((dispose) => {
          this._disposeRender = dispose;
          this._renderOwner = getOwner();
          // Created inside a binding, a render must not subscribe it
          return untrack(() => this.render());
        })
      );
      if (isFeaturesActive()) {
        features.emit.componentRender(this, performance.now() - start);
      }
      return result;
    } catch (error) {
      if (isFeaturesActive()) {
        features.emit.componentError(
          this,
          error instanceof Error ? error : new Error(String(error))
        );
      }
      throw error;
    }
  }

  /**
   * Marks the component mounted, reports it to dev tools and runs its
   * onMount() callbacks. The last step of mount(). A child rendered by
   * _renderAsChild() or the JSX component path queues it with
   * queueChildMount(), so it runs once its nodes are inserted.
   *
   * @internal
   */
  _finishMount(): void {
    // Unmounted before a queued mount ran
    if (this._status !== ComponentStatus.CREATED) return;
    this._status = ComponentStatus.MOUNTED;

    const slotListeners = this._pendingSlotListeners;
    if (slotListeners) {
      this._pendingSlotListeners = null;
      for (const listen of slotListeners) listen();
    }

    if (isFeaturesActive()) {
      const target = this._mountTarget();
      if (target) features.emit.componentMount(this, target);
    }

    // With this component as owner, so onCleanup() inside registers on it
    runWithOwner(this, () => {
      for (const callback of this._mountCallbacks) {
        try {
          const cleanup = callback();
          if (typeof cleanup === 'function') {
            this._cleanups.push(cleanup);
          }
        } catch (e) {
          logger.error(ReactiveLogMessages.CLEANUP_ERROR, { error: e });
        }
      }
    });
  }

  /**
   * Where the nodes went: the container, the parent of a child's first node,
   * or the container of the nearest ancestor that has one.
   */
  private _mountTarget(): Element | ShadowRoot | null {
    if (this.container) return this.container;
    const parent = this._firstNode?.parentNode;
    if (parent instanceof Element || parent instanceof ShadowRoot)
      return parent;
    let ancestor = this._parent;
    while (ancestor && !ancestor.container) ancestor = ancestor._parent;
    return ancestor?.container ?? null;
  }

  /**
   * Called when the owner of this component is disposed.
   *
   * @internal
   */
  [OWNER_DISPOSE](): void {
    this._unmount(false);
  }

  //=============================================
  // Shadow DOM Methods
  //=============================================

  /**
   * Get elements assigned to a slot.
   *
   * @param slotName - Name of the slot (undefined for default slot)
   * @returns Array of elements in the slot
   *
   * @example
   * ```typescript
   * class Card extends Component {
   *   protected shadow = true;
   *
   *   protected setup() {
   *     this.onMount(() => {
   *       const headerElements = this.getSlottedElements('header');
   *       console.log('Header has', headerElements.length, 'elements');
   *     });
   *   }
   *
   *   protected render() {
   *     return html\`
   *       <div class="card">
   *         <header><slot name="header"></slot></header>
   *         <main><slot></slot></main>
   *       </div>
   *     \`;
   *   }
   * }
   * ```
   */
  protected getSlottedElements(slotName?: string): Element[] {
    if (!this._shadowRoot) return [];
    return getSlottedElements(this._shadowRoot, slotName);
  }

  /**
   * Get all nodes (including text) assigned to a slot.
   *
   * @param slotName - Name of the slot (undefined for default slot)
   * @returns Array of nodes in the slot
   */
  protected getSlottedNodes(slotName?: string): Node[] {
    if (!this._shadowRoot) return [];
    return getSlottedNodes(this._shadowRoot, slotName);
  }

  /**
   * Check if a slot has any assigned content.
   *
   * @param slotName - Name of the slot (undefined for default slot)
   * @returns True if slot has an element or text that is not only whitespace
   */
  protected hasSlottedContent(slotName?: string): boolean {
    if (!this._shadowRoot) return false;
    return hasSlottedContent(this._shadowRoot, slotName);
  }

  /**
   * Listen for slot content changes. Called from setup(), it starts once the
   * component has rendered. Cleanup is automatic on component unmount.
   *
   * @param slotName - Name of the slot (undefined for default slot)
   * @param callback - Called when slot content changes
   * @returns Cleanup function
   *
   * @example
   * ```typescript
   * class DynamicSlot extends Component {
   *   protected shadow = true;
   *
   *   protected setup() {
   *     this.onSlotChange('content', (elements) => {
   *       console.log('Slot content changed:', elements.length, 'items');
   *     });
   *   }
   * }
   * ```
   */
  protected onSlotChange(
    slotName: string | undefined,
    callback: (elements: Element[]) => void
  ): () => void {
    let cleanup: (() => void) | null = null;
    const listen = (): void => {
      if (!this._shadowRoot) return;
      cleanup = onSlotChange(this._shadowRoot, slotName, callback);
      this._slotCleanups.push(cleanup);
    };
    // From setup() the shadow root and the slot are not there yet: listen
    // once the component has rendered
    if (this._status === ComponentStatus.CREATED) {
      (this._pendingSlotListeners ??= []).push(listen);
    } else {
      listen();
    }

    return () => {
      const pending = this._pendingSlotListeners?.indexOf(listen) ?? -1;
      if (pending !== -1) this._pendingSlotListeners!.splice(pending, 1);
      if (!cleanup) return;
      cleanup();
      const idx = this._slotCleanups.indexOf(cleanup);
      if (idx !== -1) {
        this._slotCleanups.splice(idx, 1);
      }
    };
  }

  /**
   * Emit a custom event that crosses shadow DOM boundaries.
   * Sets `composed: true` automatically.
   *
   * **Note:** This method is designed for shadow DOM components. It dispatches
   * events from the shadow host element. For components without shadow DOM,
   * use `element.dispatchEvent()` directly or pass callback props instead.
   *
   * @param name - Event name
   * @param detail - Event detail data
   * @returns True if event was not cancelled, false if no dispatch target exists
   *
   * @example
   * ```typescript
   * class CustomInput extends Component {
   *   protected shadow = true;
   *
   *   private handleInput(e: Event) {
   *     const value = (e.target as HTMLInputElement).value;
   *     this.emit('value-change', { value });
   *   }
   *
   *   protected render() {
   *     return html\`<input onInput=\${(e) => this.handleInput(e)} />\`;
   *   }
   * }
   *
   * // Parent can listen:
   * // html\`<\${CustomInput} onvalue-change=\${(e) => console.log(e.detail.value)} />\`
   * ```
   */
  protected emit<T = unknown>(name: string, detail?: T): boolean {
    const target = this.container ?? this._shadowRoot;
    if (!target) return false;

    const event = createComposedEvent(name, { detail });
    return target.dispatchEvent(event);
  }

  //=============================================
  // Internal Methods (used by framework internals)
  //=============================================

  /**
   * Renders this component as a child component.
   * Called by h(), the JSX runtime and the router Outlet.
   *
   * Handles:
   * - Running setup()
   * - Attaching Shadow DOM if enabled
   * - Rendering content into shadow root or wrapper element
   *
   * @returns The rendered DOM element (wrapper with shadow root, or direct content)
   * @internal
   */
  _renderAsChild(): VNode | null {
    // Belong to the current owner, so we are disposed with it
    adoptOwner(this);
    this._resolveShadowOptions();

    // Run setup phase with this component as reactive owner (same as mount)
    runWithOwner(this, () =>
      untrack(() => {
        this.setup();
        this._runOptionsSetup();
      })
    );

    let result: VNode | null = null;

    // Check if shadow DOM is enabled
    if (
      this._shadowOptions &&
      shouldUseShadowDOM(this._shadowOptions) &&
      SHADOW_DOM_SUPPORTED
    ) {
      // Create a wrapper element for the shadow host
      // Use a custom element name based on component class, or default to 'signy-component'
      const tagName = this._getCustomElementName();
      const wrapper = document.createElement(tagName);
      wrapper.setAttribute(DATA_ATTR_SHADOW, '');

      // Attach shadow root to wrapper
      this._shadowRoot = attachShadow(wrapper, this._shadowOptions);

      // Apply styles
      const combinedStyles = mergeStyles(this.styles, this.options.styles);
      if (combinedStyles.length > 0) {
        applyStyles(this._shadowRoot, combinedStyles);
      }

      // Store wrapper as container for event dispatching
      this.container = wrapper;
      this._ownsContainer = true;

      // Render content into shadow root
      const content = this._renderOwned();
      if (content) {
        this._inRender(() => this._appendContent(this._shadowRoot!, content));
      }

      result = wrapper;
    } else {
      // No shadow DOM - render directly
      const content = this._renderOwned();
      if (content === null || content === undefined) {
        result = null;
      } else if (Array.isArray(content)) {
        // If content is an array, wrap in a fragment
        const fragment = document.createDocumentFragment();
        this._inRender(() => appendChildren(fragment, content));
        result = fragment;
      } else {
        result = content;
      }
      this._firstNode =
        result instanceof DocumentFragment ? result.firstChild : result;
    }

    queueChildMount(this);
    return result;
  }

  /**
   * Gets a custom element tag name for this component's shadow host.
   * Converts PascalCase class name to kebab-case with 'signy-' prefix.
   *
   * Note: These are valid autonomous custom elements per HTML5 spec (any
   * hyphenated tag is valid). We intentionally don't register them via
   * `customElements.define()` because:
   * 1. No lifecycle callbacks needed - Signy handles component lifecycle
   * 2. Avoids global customElements registry pollution
   * 3. Provides descriptive DevTools names without registration overhead
   *
   * Trade-off: CSS `:defined` pseudo-class won't match these elements.
   *
   * @returns Custom element tag name (e.g., 'signy-my-widget')
   * @internal
   */
  private _getCustomElementName(): string {
    // PascalCase to kebab case, then only what a custom element name allows:
    // bundler names like `_Foo` or `Foo$1` and display names with spaces
    // would make createElement() throw
    const kebab = this.name
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return `${SHADOW_HOST_PREFIX}${kebab || 'component'}`;
  }

  //=============================================
  // Private Methods
  //=============================================

  /**
   * Unmounts. `clearDom` is false when the owner is disposed: whoever removes
   * the subtree takes these nodes out with it, so they are not cleared one
   * component at a time.
   */
  private _unmount(clearDom: boolean): void {
    // Guard against double unmount
    if (this._status === ComponentStatus.UNMOUNTED) {
      return;
    }

    // Leave the parent's owned list, so the parent does not dispose us again
    detachOwner(this);

    // Execute unmount callbacks
    for (const callback of this._unmountCallbacks) {
      try {
        callback();
      } catch (e) {
        logger.error(ReactiveLogMessages.CLEANUP_ERROR, { error: e });
      }
    }
    this._unmountCallbacks = [];

    // Execute cleanup functions from onMount
    for (const cleanup of this._cleanups) {
      try {
        cleanup();
      } catch (e) {
        logger.error(ReactiveLogMessages.CLEANUP_ERROR, { error: e });
      }
    }
    this._cleanups = [];

    // Execute reactive cleanups registered via onCleanup()
    if (this.cleanups) {
      for (let i = this.cleanups.length - 1; i >= 0; i--) {
        const cleanup = this.cleanups[i];
        if (cleanup) {
          try {
            cleanup();
          } catch (e) {
            logger.error(ReactiveLogMessages.CLEANUP_ERROR, { error: e });
          }
        }
      }
      this.cleanups = null;
    }

    // Dispose everything this component owns: effects from setup() and
    // onMount(), the render root with its bindings, and child components
    disposeOwned(this);
    this._disposeRender = null;
    this._renderOwner = null;

    // Clean up slot change listeners
    for (const cleanup of this._slotCleanups) {
      try {
        cleanup();
      } catch (e) {
        logger.error(ReactiveLogMessages.CLEANUP_ERROR, { error: e });
      }
    }
    this._slotCleanups = [];
    this._pendingSlotListeners = null;

    // Clear mount callbacks to prevent memory leaks
    this._mountCallbacks = [];

    // Clear shadow root content
    if (clearDom && this._shadowRoot) {
      // Remove all content from shadow root
      while (this._shadowRoot.firstChild) {
        this._shadowRoot.removeChild(this._shadowRoot.firstChild);
      }
      // Note: Shadow root cannot be detached once attached
      // The element would need to be removed from DOM entirely
    }

    // Clear the container: all of it when it is our own wrapper, else only
    // what we added to it
    if (this.container) {
      if (clearDom) {
        if (this._ownsContainer) this.container.innerHTML = '';
        else this._clearRendered();
      }
      this._rendered = null;
      this.container = null;
    }

    // Reset shadow root reference (though it stays attached to element)
    this._shadowRoot = null;

    this._status = ComponentStatus.UNMOUNTED;

    // Emit component unmount event for dev tools
    if (isFeaturesActive()) features.emit.componentUnmount(this);
  }

  /**
   * The application of this component or of its nearest ancestor that has one.
   */
  private _findApp(): Application | null {
    let current: Component | null = this;
    while (current && !current._app) current = current._parent;
    if (current) this._app = current._app;
    return this._app;
  }

  /**
   * Resolves Shadow DOM options (constructor overrides class property).
   * Runs at mount time because subclass fields like `shadow = true` are not
   * set yet while the base constructor runs.
   */
  private _resolveShadowOptions(): void {
    this._shadowOptions = mergeShadowOptions(this.shadow, this.options.shadow);
  }

  /**
   * Attaches Shadow DOM to the container if enabled.
   * Called during mount, after setup.
   */
  private _attachShadowIfNeeded(): void {
    if (!this._shadowOptions || !this.container) {
      return;
    }

    // Check if we should use shadow DOM in current environment
    if (!shouldUseShadowDOM(this._shadowOptions)) {
      // SSR light mode fallback - render to light DOM
      return;
    }

    // Check if Shadow DOM is supported
    if (!SHADOW_DOM_SUPPORTED) {
      // Fallback to light DOM rendering
      return;
    }

    // Attach shadow root
    this._shadowRoot = attachShadow(this.container, this._shadowOptions);

    // Apply styles (merge class property with constructor option)
    const combinedStyles = mergeStyles(this.styles, this.options.styles);
    if (combinedStyles.length > 0) {
      applyStyles(this._shadowRoot, combinedStyles);
    }
  }

  /**
   * Runs the options.setup() callback if provided.
   */
  private _runOptionsSetup(): void {
    if (!this.options.setup) return;

    const setupResult = this.options.setup.call(this);

    if (setupResult && typeof setupResult === 'object') {
      // An own __proto__ key, as JSON.parse() makes, would swap our prototype
      for (const key of Object.keys(setupResult)) {
        if (key === '__proto__') continue;
        (this as Record<string, unknown>)[key] = (
          setupResult as Record<string, unknown>
        )[key];
      }
    }
  }
}

//=============================================
// Child Mounts
//=============================================

/** Children rendered but not mounted yet, children before their parents */
const pendingMounts: Component[] = [];
let mountsQueued = false;

/**
 * Queues the mount of a child component, so its onMount() callbacks run once
 * its nodes are inserted: right after a root mount() appends its content, or
 * from the DOM task queue for children rendered later.
 *
 * @internal
 */
export function queueChildMount(component: Component): void {
  pendingMounts.push(component);
  if (!mountsQueued) {
    mountsQueued = true;
    scheduleTask(flushChildMounts);
  }
}

onResetForTests(() => {
  pendingMounts.length = 0;
  mountsQueued = false;
});

function flushChildMounts(): void {
  mountsQueued = false;
  // Mounts may queue more, and those belong to this flush too
  for (let i = 0; i < pendingMounts.length; i++)
    pendingMounts[i]!._finishMount();
  pendingMounts.length = 0;
}

/**
 * Creates a component from a class typed as any component, with props the
 * caller vouches for: route props, loaded modules.
 *
 * @internal
 */
export function construct(
  ComponentClass: ComponentClass,
  props?: object
): Component {
  return new (ComponentClass as unknown as new (props?: object) => Component)(
    props
  );
}
