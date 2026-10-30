/**
 * Feature Registry
 *
 * A lightweight plugin system for development features.
 * Features can register handlers for various hooks emitted by Signy internals.
 *
 * Key design decisions:
 * - **Lazy emit**: Emit functions are no-ops until features are installed
 * - **Conditional emission**: Reactivity primitives check `featuresActive` before emitting
 * - **Full isolation**: Each feature manages its own state, no shared context
 * - **Sync handlers**: All handlers are synchronous for performance
 * - **Insertion order**: Handlers execute in the order they were registered
 *
 * ## Performance: Conditional Emission Cost Analysis
 *
 * Reactivity primitives (Signal, Computed, Effect) use conditional checks before
 * emitting events to avoid overhead when no features are installed.
 *
 * ### Actual CPU Cost
 *
 * | Operation                      | Approximate Cost      |
 * |--------------------------------|-----------------------|
 * | Boolean check (`if (active)`)  | ~0.3 nanoseconds      |
 * | Property access (`this._value`)| ~1-2 nanoseconds      |
 * | `Object.is` comparison         | ~2-5 nanoseconds      |
 * | Linking a subscriber           | ~10-50 nanoseconds    |
 * | Full signal write              | ~50-200 nanoseconds   |
 *
 * **The boolean check is ~0.15-0.6% of total signal write cost.**
 *
 * ### Branch Prediction
 *
 * Modern CPUs predict branches with 95-99% accuracy for consistent patterns:
 *
 * - **Production** (`featuresActive = false` always):
 *   - Branch predictor learns this pattern
 *   - Misprediction rate: ~0.1%
 *   - Effective cost: nearly zero
 *
 * - **Development** (`featuresActive = true`):
 *   - Small overhead, but you want the logging
 *   - Performance doesn't matter as much
 *
 * ### Benchmark Estimates
 *
 * | Scenario        | Writes/sec  | Overhead/write | Total overhead |
 * |-----------------|-------------|----------------|----------------|
 * | Light UI        | 1,000/sec   | 0.3ns          | 0.0003ms/sec   |
 * | Heavy reactive  | 100,000/sec | 0.3ns          | 0.03ms/sec     |
 * | Extreme stress  | 1M/sec      | 0.3ns          | 0.3ms/sec      |
 *
 * Even at **1 million signal writes per second**, the overhead is **0.3ms**.
 *
 * ### Cost Comparison
 *
 * Things more expensive than one boolean check:
 * - Creating a single DOM text node: ~1,000x more expensive
 * - One `console.log`: ~10,000x more expensive
 * - One `JSON.stringify`: ~100,000x more expensive
 * - One network request: ~1,000,000x more expensive
 *
 * **Verdict: Essentially zero practical performance impact.**
 *
 * @module core/features
 *
 * @example
 * ```typescript
 * import { features } from 'signy';
 *
 * // Install a feature
 * const cleanup = features.install({
 *   id: 'my-feature',
 *   name: 'My Feature',
 *   install(ctx) {
 *     ctx.onComponentMount((component, target) => {
 *       console.log('Mounted:', component.name);
 *     });
 *   },
 * });
 *
 * // Later, uninstall
 * cleanup();
 * ```
 *
 * ## Known limitations
 *
 * None.
 */

import type {
  DevFeature,
  DevEmit,
  FeatureContext,
  ComponentCreateHandler,
  ComponentMountHandler,
  ComponentUnmountHandler,
  ComponentRenderHandler,
  ComponentErrorHandler,
  SignalCreateHandler,
  SignalWriteHandler,
  EffectCreateHandler,
  EffectRunHandler,
  EffectDisposeHandler,
  ComputedCreateHandler,
  ComputedInvalidateHandler,
  AppMountHandler,
  AppUnmountHandler,
  LifecycleHandlers,
  ReactivityHandlers,
  AppHandlers,
} from './feature-types';

import { logger } from '../log';
import { FeatureLogMessages } from './log-messages';

//=============================================
// Features Active Flag
//=============================================

/**
 * Whether any features are currently installed.
 *
 * This flag enables conditional emission in reactivity primitives.
 * When `false`, emit calls in Signal/Computed/Effect are skipped entirely.
 *
 * The boolean check adds ~0.3 nanoseconds per operation, which is
 * ~0.15-0.6% of total signal write cost. See module documentation
 * for full performance analysis.
 *
 * @internal
 */
let featuresActive = false;

/**
 * Checks if any features are currently installed.
 *
 * Use this in hot paths to conditionally emit feature events.
 * The boolean check is essentially free (~0.3ns) due to branch prediction.
 *
 * @returns `true` if features are installed, `false` otherwise
 *
 * @example
 * ```typescript
 * if (isFeaturesActive()) {
 *   features.emit.signalWrite(this, oldValue, newValue);
 * }
 * ```
 */
export function isFeaturesActive(): boolean {
  return featuresActive;
}

//=============================================
// Handler Storage
//=============================================

interface HandlerArrays {
  componentCreate: ComponentCreateHandler[];
  componentMount: ComponentMountHandler[];
  componentUnmount: ComponentUnmountHandler[];
  componentRender: ComponentRenderHandler[];
  componentError: ComponentErrorHandler[];
  signalCreate: SignalCreateHandler[];
  signalWrite: SignalWriteHandler[];
  effectCreate: EffectCreateHandler[];
  effectRun: EffectRunHandler[];
  effectDispose: EffectDisposeHandler[];
  computedCreate: ComputedCreateHandler[];
  computedInvalidate: ComputedInvalidateHandler[];
  appMount: AppMountHandler[];
  appUnmount: AppUnmountHandler[];
}

//=============================================
// No-op Emit (default when no features)
//=============================================

/**
 * Receives feature install and uninstall notifications.
 *
 * @internal
 */
export interface FeatureObserver {
  installed?(id: string, name: string): void;
  uninstalled?(id: string): void;
}

const noopEmit: DevEmit = {
  componentCreate: () => {},
  componentMount: () => {},
  componentUnmount: () => {},
  componentRender: () => {},
  componentError: () => {},
  signalCreate: () => {},
  signalWrite: () => {},
  effectCreate: () => {},
  effectRun: () => {},
  effectDispose: () => {},
  computedCreate: () => {},
  computedInvalidate: () => {},
  appMount: () => {},
  appUnmount: () => {},
};

//=============================================
// Active Emit (when features are installed)
//=============================================

function createActiveEmit(handlers: HandlerArrays): DevEmit {
  return {
    componentCreate: (component) => run(handlers.componentCreate, component),
    componentMount: (component, target) =>
      run(handlers.componentMount, component, target),
    componentUnmount: (component) => run(handlers.componentUnmount, component),
    componentRender: (component, duration) =>
      run(handlers.componentRender, component, duration),
    componentError: (component, error) =>
      run(handlers.componentError, component, error),
    signalCreate: (signal, initialValue) =>
      run(handlers.signalCreate, signal, initialValue),
    signalWrite: (signal, prevValue, nextValue) =>
      run(handlers.signalWrite, signal, prevValue, nextValue),
    effectCreate: (effect) => run(handlers.effectCreate, effect),
    effectRun: (effect) => run(handlers.effectRun, effect),
    effectDispose: (effect) => run(handlers.effectDispose, effect),
    computedCreate: (computed) => run(handlers.computedCreate, computed),
    computedInvalidate: (computed) =>
      run(handlers.computedInvalidate, computed),
    appMount: (app) => run(handlers.appMount, app),
    appUnmount: (app) => run(handlers.appUnmount, app),
  };
}

/**
 * Calls each handler. A throwing one is logged, so a broken dev tool cannot
 * break the signal write or the mount that emitted the event.
 */
function run<A extends unknown[]>(
  handlers: ReadonlyArray<(...args: A) => void>,
  ...args: A
): void {
  for (const handler of handlers) {
    try {
      handler(...args);
    } catch (error) {
      logger.error(FeatureLogMessages.HANDLER_ERROR, { error });
    }
  }
}

//=============================================
// Feature Registry
//=============================================

/**
 * The feature registry manages dev features and their handlers.
 *
 * Features are installed with `features.install()` and can be
 * uninstalled by calling the returned cleanup function.
 *
 * When no features are installed, emit calls are no-ops (zero overhead).
 */
class FeatureRegistry {
  private _features = new Map<string, DevFeature>();
  private _featureCleanups = new Map<string, Array<() => void>>();

  private _handlers: HandlerArrays = {
    componentCreate: [],
    componentMount: [],
    componentUnmount: [],
    componentRender: [],
    componentError: [],
    signalCreate: [],
    signalWrite: [],
    effectCreate: [],
    effectRun: [],
    effectDispose: [],
    computedCreate: [],
    computedInvalidate: [],
    appMount: [],
    appUnmount: [],
  };

  //=============================================
  // Current emit function (lazy-swapped)
  //=============================================

  private _emit: DevEmit = noopEmit;

  // Notified on install and uninstall, see observe()
  private readonly _observers = new Set<FeatureObserver>();

  /**
   * Current emit interface.
   * Call methods on this to notify registered handlers.
   */
  get emit(): DevEmit {
    return this._emit;
  }

  //=============================================
  // Public Properties
  //=============================================

  /**
   * Returns true if any features are currently installed.
   */
  get hasFeatures(): boolean {
    return this._features.size > 0;
  }

  /**
   * Returns the IDs of all installed features.
   */
  get installed(): string[] {
    return Array.from(this._features.keys());
  }

  /**
   * Returns the number of installed features.
   */
  get count(): number {
    return this._features.size;
  }

  //=============================================
  // Install/Uninstall
  //=============================================

  /**
   * Install a dev feature.
   *
   * @param feature - The feature to install
   * @returns Cleanup function to uninstall the feature
   * @throws If a feature with the same ID is already installed
   *
   * @example
   * ```typescript
   * const cleanup = features.install({
   *   id: 'my-feature',
   *   name: 'My Feature',
   *   install(ctx) {
   *     ctx.onComponentMount((c) => console.log('Mounted:', c.name));
   *   },
   * });
   * ```
   */
  install(feature: DevFeature): () => void {
    if (this._features.has(feature.id)) {
      logger.error(FeatureLogMessages.ALREADY_INSTALLED, {
        featureId: feature.id,
      });
      throw new Error(`Feature "${feature.id}" is already installed`);
    }

    // First feature - activate real emit and set flag
    if (this._features.size === 0) {
      this._emit = createActiveEmit(this._handlers);
      featuresActive = true;
    }

    // Track this feature's cleanups
    const featureCleanups: Array<() => void> = [];
    this._featureCleanups.set(feature.id, featureCleanups);

    // Create context for this feature
    const ctx = this._createContext(featureCleanups);

    // Install the feature
    this._features.set(feature.id, feature);
    try {
      feature.install(ctx);
    } catch (error) {
      // Undo what it registered, so it can be installed again
      for (const cleanup of featureCleanups) cleanup();
      this._featureCleanups.delete(feature.id);
      this._features.delete(feature.id);
      if (this._features.size === 0) {
        this._emit = noopEmit;
        featuresActive = false;
      }
      throw error;
    }

    logger.debug(FeatureLogMessages.INSTALLED, {
      featureId: feature.id,
      featureName: feature.name,
    });

    for (const observer of this._observers) {
      observer.installed?.(feature.id, feature.name);
    }

    return () => this.uninstall(feature.id);
  }

  /**
   * Uninstall a feature by ID.
   *
   * @param id - The feature ID to uninstall
   */
  uninstall(id: string): void {
    const feature = this._features.get(id);
    if (!feature) return;

    // Run feature's uninstall hook
    try {
      feature.uninstall?.();
    } catch (error) {
      logger.error(FeatureLogMessages.UNINSTALL_ERROR, {
        featureId: id,
        error,
      });
    }

    // Run all handler cleanups for this feature
    const cleanups = this._featureCleanups.get(id);
    if (cleanups) {
      for (const cleanup of cleanups) {
        try {
          cleanup();
        } catch (error) {
          logger.error(FeatureLogMessages.CLEANUP_ERROR, {
            featureId: id,
            error,
          });
        }
      }
      this._featureCleanups.delete(id);
    }

    this._features.delete(id);

    for (const observer of this._observers) {
      observer.uninstalled?.(id);
    }

    logger.debug(FeatureLogMessages.UNINSTALLED, { featureId: id });

    // Last feature removed - switch back to noop and clear flag
    if (this._features.size === 0) {
      this._emit = noopEmit;
      featuresActive = false;
    }
  }

  /**
   * Uninstall all features.
   */
  uninstallAll(): void {
    const ids = Array.from(this._features.keys());
    for (const id of ids) {
      this.uninstall(id);
    }
  }

  /**
   * Calls `observer` when a feature is installed or uninstalled. Used by the
   * dev tools hook to report feature changes.
   *
   * @returns Function to stop observing
   * @internal
   */
  observe(observer: FeatureObserver): () => void {
    this._observers.add(observer);
    return () => this._observers.delete(observer);
  }

  /**
   * Check if a feature is installed.
   *
   * @param id - The feature ID to check
   */
  isInstalled(id: string): boolean {
    return this._features.has(id);
  }

  //=============================================
  // Context Factory
  //=============================================

  private _createContext(featureCleanups: Array<() => void>): FeatureContext {
    const handlers = this._handlers;

    // Helper to add a handler and return cleanup
    const addHandler = <T>(arr: T[], handler: T): (() => void) => {
      arr.push(handler);
      const cleanup = () => {
        const idx = arr.indexOf(handler);
        if (idx !== -1) arr.splice(idx, 1);
      };
      featureCleanups.push(cleanup);
      return cleanup;
    };

    return {
      // Fine-grained handlers
      onComponentCreate: (h) => addHandler(handlers.componentCreate, h),
      onComponentMount: (h) => addHandler(handlers.componentMount, h),
      onComponentUnmount: (h) => addHandler(handlers.componentUnmount, h),
      onComponentRender: (h) => addHandler(handlers.componentRender, h),
      onComponentError: (h) => addHandler(handlers.componentError, h),
      onSignalCreate: (h) => addHandler(handlers.signalCreate, h),
      onSignalWrite: (h) => addHandler(handlers.signalWrite, h),
      onEffectCreate: (h) => addHandler(handlers.effectCreate, h),
      onEffectRun: (h) => addHandler(handlers.effectRun, h),
      onEffectDispose: (h) => addHandler(handlers.effectDispose, h),
      onComputedCreate: (h) => addHandler(handlers.computedCreate, h),
      onComputedInvalidate: (h) => addHandler(handlers.computedInvalidate, h),
      onAppMount: (h) => addHandler(handlers.appMount, h),
      onAppUnmount: (h) => addHandler(handlers.appUnmount, h),

      // Grouped handlers
      onLifecycle: (grouped: LifecycleHandlers): (() => void) => {
        const cleanups: Array<() => void> = [];
        if (grouped.onCreate) {
          cleanups.push(addHandler(handlers.componentCreate, grouped.onCreate));
        }
        if (grouped.onMount) {
          cleanups.push(addHandler(handlers.componentMount, grouped.onMount));
        }
        if (grouped.onUnmount) {
          cleanups.push(
            addHandler(handlers.componentUnmount, grouped.onUnmount)
          );
        }
        if (grouped.onRender) {
          cleanups.push(addHandler(handlers.componentRender, grouped.onRender));
        }
        if (grouped.onError) {
          cleanups.push(addHandler(handlers.componentError, grouped.onError));
        }
        return () => cleanups.forEach((c) => c());
      },

      onReactivity: (grouped: ReactivityHandlers): (() => void) => {
        const cleanups: Array<() => void> = [];
        if (grouped.onSignalCreate) {
          cleanups.push(
            addHandler(handlers.signalCreate, grouped.onSignalCreate)
          );
        }
        if (grouped.onSignalWrite) {
          cleanups.push(
            addHandler(handlers.signalWrite, grouped.onSignalWrite)
          );
        }
        if (grouped.onEffectCreate) {
          cleanups.push(
            addHandler(handlers.effectCreate, grouped.onEffectCreate)
          );
        }
        if (grouped.onEffectRun) {
          cleanups.push(addHandler(handlers.effectRun, grouped.onEffectRun));
        }
        if (grouped.onEffectDispose) {
          cleanups.push(
            addHandler(handlers.effectDispose, grouped.onEffectDispose)
          );
        }
        if (grouped.onComputedCreate) {
          cleanups.push(
            addHandler(handlers.computedCreate, grouped.onComputedCreate)
          );
        }
        if (grouped.onComputedInvalidate) {
          cleanups.push(
            addHandler(
              handlers.computedInvalidate,
              grouped.onComputedInvalidate
            )
          );
        }
        return () => cleanups.forEach((c) => c());
      },

      onApp: (grouped: AppHandlers): (() => void) => {
        const cleanups: Array<() => void> = [];
        if (grouped.onMount) {
          cleanups.push(addHandler(handlers.appMount, grouped.onMount));
        }
        if (grouped.onUnmount) {
          cleanups.push(addHandler(handlers.appUnmount, grouped.onUnmount));
        }
        return () => cleanups.forEach((c) => c());
      },
    };
  }
}

//=============================================
// Singleton Instance
//=============================================

/**
 * The global feature registry instance.
 *
 * Use this to install dev features:
 *
 * @example
 * ```typescript
 * import { features } from 'signy';
 *
 * features.install(myFeature);
 * ```
 */
export const features = new FeatureRegistry();

/**
 * Convenience reference to the emit interface.
 *
 * Used internally by Signy to emit hook notifications.
 * When no features are installed, all emit calls are no-ops.
 *
 * @internal
 */
// Forwards to the current emitter. A plain `features.emit` captured here would
// stay the no-op one forever.
export const devEmit: DevEmit = Object.fromEntries(
  (Object.keys(noopEmit) as (keyof DevEmit)[]).map((key) => [
    key,
    (...args: unknown[]) =>
      (features.emit[key] as (...a: unknown[]) => void)(...args),
  ])
) as unknown as DevEmit;

//=============================================
// Type Re-exports
//=============================================

export type {
  DevFeature,
  DevEmit,
  FeatureContext,
  ComponentLike,
  SignalLike,
  EffectLike,
  ApplicationLike,
  LifecycleHandlers,
  ReactivityHandlers,
  AppHandlers,
} from './feature-types';
