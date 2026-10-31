/**
 * Context API
 *
 * Provides a simplified API for dependency injection using provide/inject.
 * Inspired by React's Context API and Vue's provide/inject.
 *
 * Context allows parent components to provide values that can be consumed
 * by any descendant component without prop drilling.
 *
 * @module context/context
 *
 * @example
 * ```typescript
 * import { createContext, html, Component } from 'signy';
 *
 * // Create a context for theme
 * const ThemeContext = createContext<'light' | 'dark'>('light');
 *
 * // Provider component
 * class App extends Component {
 *   protected setup() {
 *     ThemeContext.provide(this, 'dark');
 *   }
 * }
 *
 * // Consumer component
 * class Button extends Component {
 *   protected render() {
 *     const theme = ThemeContext.inject(this);
 *     return html`<button class="btn-${theme}">Click me</button>`;
 *   }
 * }
 * ```
 *
 * ## Known limitations
 *
 * **Requires component reference**: Unlike React's useContext hook, this API
 * requires passing the component instance to `inject()`. This is because
 * Signy uses a class-based component model.
 *
 * **Cannot distinguish undefined value from missing provider**: If a provider
 * explicitly provides `undefined` as the value, `inject()` will return the
 * default value instead. Use `null` instead of `undefined` for optional values,
 * or use `injectOptional()` which returns the raw value.
 */

import type { InjectionKey } from '../types';
import { createInjectionKey } from './injection-key';
import { logger } from '../log';
import { ContextLogMessages } from './log-messages';
import { CONTEXT_INJECT, CONTEXT_PROVIDE, type ContextHost } from './owner';

//=============================================
// Types
//=============================================

/**
 * A typed context object that can be used with provide/inject.
 *
 * @template T - Type of the context value
 */
export interface Context<T> {
  /**
   * The unique symbol key for this context.
   * Can be used directly with component's provide/inject methods.
   */
  readonly key: InjectionKey<T>;

  /**
   * The default value for this context.
   * Returned when no provider is found in the component tree.
   */
  readonly defaultValue: T | undefined;

  /**
   * Provides the context value from a component.
   * All descendants of this component can inject this value.
   *
   * @param component - The component providing the value
   * @param value - The value to provide
   *
   * @example
   * ```typescript
   * class App extends Component {
   *   protected setup() {
   *     ThemeContext.provide(this, 'dark');
   *   }
   * }
   * ```
   */
  provide(component: ContextProvider, value: T): void;

  /**
   * Injects the context value into a component.
   * Walks up the component tree to find the nearest provider.
   *
   * @param component - The component consuming the value
   * @returns The provided value or the default value
   *
   * @example
   * ```typescript
   * class Button extends Component {
   *   protected setup() {
   *     const theme = ThemeContext.inject(this);
   *   }
   * }
   * ```
   */
  inject(component: ContextConsumer): T;

  /**
   * Injects the context value, returning undefined if not provided.
   * Unlike inject(), this does not return the default value.
   *
   * @param component - The component consuming the value
   * @returns The provided value or undefined
   */
  injectOptional(component: ContextConsumer): T | undefined;
}

/**
 * A component that provides context values. Any object is accepted, checked
 * at runtime, so Component subclasses with protected `provide` can be passed.
 */
type ContextProvider = object;

/**
 * A component that consumes context values, checked like ContextProvider.
 */
type ContextConsumer = object;

//=============================================
// Validation Helpers
//=============================================

/**
 * Validates that an object is a component that can provide.
 * @throws Error if the object is not a component
 */
function validateProvider(
  component: ContextProvider,
  contextName: string
): asserts component is ContextHost {
  if (
    typeof (component as Partial<ContextHost>)[CONTEXT_PROVIDE] !== 'function'
  ) {
    logger.error(ContextLogMessages.INVALID_PROVIDER, { contextName });
    throw new Error(
      `Context.provide() requires a Component instance. ` +
        `The provided object does not have a 'provide' method.`
    );
  }
}

/**
 * Validates that an object is a component that can inject.
 * @throws Error if the object is not a component
 */
function validateConsumer(
  component: ContextConsumer,
  contextName: string
): asserts component is ContextHost {
  if (
    typeof (component as Partial<ContextHost>)[CONTEXT_INJECT] !== 'function'
  ) {
    logger.error(ContextLogMessages.INVALID_CONSUMER, { contextName });
    throw new Error(
      `Context.inject() requires a Component instance. ` +
        `The provided object does not have an 'inject' method.`
    );
  }
}

//=============================================
// Context Implementation
//=============================================

/**
 * Creates a new context for dependency injection.
 *
 * A context provides a way to pass data through the component tree without
 * having to pass props down manually at every level.
 *
 * @template T - Type of the context value
 * @param defaultValue - Default value when no provider is found
 * @param name - Optional name for debugging (used in the symbol description)
 * @returns A Context object with provide and inject methods
 *
 * @example
 * ```typescript
 * // Create a theme context with default value
 * const ThemeContext = createContext<'light' | 'dark'>('light');
 *
 * // Create a user context (no default - will be undefined if not provided)
 * interface User {
 *   id: string;
 *   name: string;
 * }
 * const UserContext = createContext<User | null>(null);
 *
 * // Named context for debugging
 * const ConfigContext = createContext<Config>(defaultConfig, 'AppConfig');
 * ```
 *
 * @example
 * ```typescript
 * // Complete usage pattern with reactive Signal
 * const CountContext = createContext<Signal<number> | null>(null, 'Count');
 *
 * class Counter extends Component {
 *   private count = new Signal(0);
 *
 *   protected setup() {
 *     // Provide the Signal itself for reactive updates
 *     CountContext.provide(this, this.count);
 *   }
 * }
 *
 * class Display extends Component {
 *   protected render() {
 *     const countSignal = CountContext.inject(this);
 *     // Access .value in render for reactivity
 *     return html`<span>Count: ${() => countSignal?.value ?? 0}</span>`;
 *   }
 * }
 * ```
 */
export function createContext<T>(defaultValue?: T, name?: string): Context<T> {
  const contextName = name ?? 'Context';
  const key = createInjectionKey<T>(contextName);

  return {
    key,
    defaultValue,

    provide(component: ContextProvider, value: T): void {
      validateProvider(component, contextName);
      component[CONTEXT_PROVIDE](key, value);
    },

    inject(component: ContextConsumer): T {
      validateConsumer(component, contextName);
      const value = component[CONTEXT_INJECT](key) as T | undefined;
      return value !== undefined ? value : (defaultValue as T);
    },

    injectOptional(component: ContextConsumer): T | undefined {
      validateConsumer(component, contextName);
      return component[CONTEXT_INJECT](key) as T | undefined;
    },
  };
}

/**
 * Creates a context that requires a provider.
 *
 * Unlike `createContext()`, this variant has no default value and will
 * throw an error if no provider is found. Use this when the context
 * value is required for the component to function correctly.
 *
 * @template T - Type of the context value
 * @param name - Name for debugging and error messages
 * @returns A Context object that throws if no provider is found
 *
 * @example
 * ```typescript
 * const RouterContext = createRequiredContext<Router>('Router');
 *
 * class Link extends Component {
 *   protected setup() {
 *     // Throws if no Router provider is found
 *     const router = RouterContext.inject(this);
 *   }
 * }
 * ```
 */
export function createRequiredContext<T>(name: string): Context<T> {
  const key = createInjectionKey<T>(name);

  return {
    key,
    defaultValue: undefined,

    provide(component: ContextProvider, value: T): void {
      validateProvider(component, name);
      component[CONTEXT_PROVIDE](key, value);
    },

    inject(component: ContextConsumer): T {
      validateConsumer(component, name);
      const value = component[CONTEXT_INJECT](key) as T | undefined;
      if (value === undefined) {
        throw new Error(
          `Context "${name}" not found. Make sure a provider exists in the component tree.`
        );
      }
      return value;
    },

    injectOptional(component: ContextConsumer): T | undefined {
      validateConsumer(component, name);
      return component[CONTEXT_INJECT](key) as T | undefined;
    },
  };
}
