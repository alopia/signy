/**
 * Feature Registry Types
 *
 * Type definitions for the dev feature plugin system.
 * Features are optional plugins that can hook into signy's internals
 * for debugging, profiling, and development purposes.
 *
 * @module core/feature-types
 */

import type { Owner } from '../reactivity/effect';

//=============================================
// Forward Declarations (avoid circular imports)
//=============================================

/**
 * Minimal interface for Component (to avoid circular imports)
 * The actual Component class implements this and more.
 */
export interface ComponentLike {
  readonly id: string;
  readonly name: string;
  readonly isMounted: boolean;
}

/**
 * Minimal interface for Signal (to avoid circular imports)
 */
export interface SignalLike<T = unknown> {
  readonly value: T;
}

/**
 * Minimal interface for Effect (to avoid circular imports)
 */
export interface EffectLike extends Owner {
  readonly name?: string;
}

/**
 * Minimal interface for Application (to avoid circular imports)
 */
export interface ApplicationLike {
  readonly id: string;
  readonly isMounted: boolean;
}

//=============================================
// Handler Types
//=============================================

// Component lifecycle handlers
export type ComponentCreateHandler = (component: ComponentLike) => void;
export type ComponentMountHandler = (
  component: ComponentLike,
  target: Element | ShadowRoot
) => void;
export type ComponentUnmountHandler = (component: ComponentLike) => void;
export type ComponentRenderHandler = (
  component: ComponentLike,
  duration: number
) => void;
export type ComponentErrorHandler = (
  component: ComponentLike,
  error: Error
) => void;

// Reactivity handlers
export type SignalCreateHandler = (
  signal: SignalLike,
  initialValue: unknown
) => void;
export type SignalWriteHandler = (
  signal: SignalLike,
  prevValue: unknown,
  nextValue: unknown
) => void;
export type EffectCreateHandler = (effect: EffectLike) => void;
export type EffectRunHandler = (effect: EffectLike) => void;
export type EffectDisposeHandler = (effect: EffectLike) => void;
export type ComputedCreateHandler = (computed: SignalLike) => void;
export type ComputedInvalidateHandler = (computed: SignalLike) => void;

// Application handlers
export type AppMountHandler = (app: ApplicationLike) => void;
export type AppUnmountHandler = (app: ApplicationLike) => void;

//=============================================
// Grouped Handler Interfaces (for Hybrid approach)
//=============================================

/**
 * Grouped component lifecycle handlers
 */
export interface LifecycleHandlers {
  onCreate?: ComponentCreateHandler;
  onMount?: ComponentMountHandler;
  onUnmount?: ComponentUnmountHandler;
  onRender?: ComponentRenderHandler;
  onError?: ComponentErrorHandler;
}

/**
 * Grouped reactivity handlers
 */
export interface ReactivityHandlers {
  onSignalCreate?: SignalCreateHandler;
  onSignalWrite?: SignalWriteHandler;
  onEffectCreate?: EffectCreateHandler;
  onEffectRun?: EffectRunHandler;
  onEffectDispose?: EffectDisposeHandler;
  onComputedCreate?: ComputedCreateHandler;
  onComputedInvalidate?: ComputedInvalidateHandler;
}

/**
 * Grouped application handlers
 */
export interface AppHandlers {
  onMount?: AppMountHandler;
  onUnmount?: AppUnmountHandler;
}

//=============================================
// Feature Context
//=============================================

/**
 * Context provided to features during installation.
 * Provides methods to register handlers for various hooks.
 *
 * All handler registration methods return a cleanup function.
 */
export interface FeatureContext {
  //===========================================
  // Fine-grained handlers (individual hooks)
  //===========================================

  // Component lifecycle
  onComponentCreate(handler: ComponentCreateHandler): () => void;
  onComponentMount(handler: ComponentMountHandler): () => void;
  onComponentUnmount(handler: ComponentUnmountHandler): () => void;
  onComponentRender(handler: ComponentRenderHandler): () => void;
  onComponentError(handler: ComponentErrorHandler): () => void;

  // Reactivity
  onSignalCreate(handler: SignalCreateHandler): () => void;
  onSignalWrite(handler: SignalWriteHandler): () => void;
  onEffectCreate(handler: EffectCreateHandler): () => void;
  onEffectRun(handler: EffectRunHandler): () => void;
  onEffectDispose(handler: EffectDisposeHandler): () => void;
  onComputedCreate(handler: ComputedCreateHandler): () => void;
  onComputedInvalidate(handler: ComputedInvalidateHandler): () => void;

  // Application
  onAppMount(handler: AppMountHandler): () => void;
  onAppUnmount(handler: AppUnmountHandler): () => void;

  //===========================================
  // Grouped handlers (register multiple at once)
  //===========================================

  /**
   * Register multiple lifecycle handlers at once.
   * @returns Cleanup function that removes all registered handlers
   */
  onLifecycle(handlers: LifecycleHandlers): () => void;

  /**
   * Register multiple reactivity handlers at once.
   * @returns Cleanup function that removes all registered handlers
   */
  onReactivity(handlers: ReactivityHandlers): () => void;

  /**
   * Register multiple app handlers at once.
   * @returns Cleanup function that removes all registered handlers
   */
  onApp(handlers: AppHandlers): () => void;
}

//=============================================
// Feature Interface
//=============================================

/**
 * A dev feature that can be installed into the feature registry.
 *
 * Features are isolated - each feature manages its own state
 * within the closure returned by its factory function.
 *
 * @example
 * ```typescript
 * const myFeature: DevFeature = {
 *   id: 'my-extension:profiler',
 *   name: 'My Profiler',
 *
 *   install(ctx) {
 *     const timings = new Map();
 *
 *     ctx.onComponentMount((component, target) => {
 *       timings.set(component.id, performance.now());
 *     });
 *   },
 *
 *   uninstall() {
 *     // Cleanup feature state
 *   },
 * };
 * ```
 */
export interface DevFeature {
  /**
   * Unique identifier for the feature.
   * Convention: 'package-name:feature-name'
   * Example: 'signy-dev:profiler'
   */
  readonly id: string;

  /**
   * Human-readable name for the feature.
   * Shown in DevTools UI.
   */
  readonly name: string;

  /**
   * Called when the feature is installed.
   * Register handlers and set up feature state here.
   *
   * @param ctx - Feature context for registering handlers
   */
  install(ctx: FeatureContext): void;

  /**
   * Called when the feature is uninstalled.
   * Clean up any feature-specific state here.
   * Handler cleanup is automatic - this is for additional cleanup.
   */
  uninstall?(): void;
}

//=============================================
// Emit Function Type
//=============================================

/**
 * Type-safe emit interface.
 * These are called from signy internals to notify registered handlers.
 */
export interface DevEmit {
  // Component lifecycle
  componentCreate(component: ComponentLike): void;
  componentMount(component: ComponentLike, target: Element | ShadowRoot): void;
  componentUnmount(component: ComponentLike): void;
  componentRender(component: ComponentLike, duration: number): void;
  componentError(component: ComponentLike, error: Error): void;

  // Reactivity
  signalCreate(signal: SignalLike, initialValue: unknown): void;
  signalWrite(signal: SignalLike, prevValue: unknown, nextValue: unknown): void;
  effectCreate(effect: EffectLike): void;
  effectRun(effect: EffectLike): void;
  effectDispose(effect: EffectLike): void;
  computedCreate(computed: SignalLike): void;
  computedInvalidate(computed: SignalLike): void;

  // Application
  appMount(app: ApplicationLike): void;
  appUnmount(app: ApplicationLike): void;
}
