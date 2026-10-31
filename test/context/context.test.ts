/**
 * Tests for context/context module
 */

import { describe, it, expect, vi } from 'vitest';
import { expectLogged } from '../support/console';
import {
  CONTEXT_INJECT,
  CONTEXT_PROVIDE,
  type ContextHost,
} from '../../src/context/owner';
import {
  createContext,
  createRequiredContext,
} from '../../src/context/context';

/**
 * Mock component interface for testing
 */
interface MockComponent extends ContextHost {
  provide<T>(key: string | symbol, value: T): void;
  inject<T>(key: string | symbol, defaultValue?: T): T | undefined;
  setParent(p: MockComponent | null): void;
}

/**
 * Mock component that implements the provide/inject interface
 */
function createMockComponent(): MockComponent {
  const providers = new Map<string | symbol, unknown>();
  let parent: MockComponent | null = null;

  const component: MockComponent = {
    provide<T>(key: string | symbol, value: T): void {
      providers.set(key, value);
    },

    inject<T>(key: string | symbol, defaultValue?: T): T | undefined {
      // Check own providers first
      if (providers.has(key)) {
        return providers.get(key) as T;
      }
      // Walk up parent chain
      if (parent) {
        return parent.inject(key, defaultValue);
      }
      return defaultValue;
    },

    setParent(p: MockComponent | null) {
      parent = p;
    },

    [CONTEXT_PROVIDE](key: symbol, value: unknown): void {
      component.provide(key, value);
    },

    [CONTEXT_INJECT](key: symbol): unknown {
      return component.inject(key);
    },
  };

  return component;
}

describe('createContext', () => {
  describe('basic usage', () => {
    it('should create a context with default value', () => {
      const ThemeContext = createContext<string>('light');

      expect(ThemeContext.defaultValue).toBe('light');
      expect(typeof ThemeContext.key).toBe('symbol');
    });

    it('should create a context without default value', () => {
      const UserContext = createContext<{ name: string }>();

      expect(UserContext.defaultValue).toBeUndefined();
    });

    it('should create a context with a name', () => {
      const ConfigContext = createContext({}, 'AppConfig');

      expect(ConfigContext.key.toString()).toContain('AppConfig');
    });
  });

  describe('provide and inject', () => {
    it('should provide and inject values', () => {
      const ThemeContext = createContext<string>('light');
      const component = createMockComponent();

      ThemeContext.provide(component, 'dark');
      const theme = ThemeContext.inject(component);

      expect(theme).toBe('dark');
    });

    it('should return default value when not provided', () => {
      const ThemeContext = createContext<string>('light');
      const component = createMockComponent();

      const theme = ThemeContext.inject(component);

      expect(theme).toBe('light');
    });

    it('should return undefined for context without default', () => {
      const UserContext = createContext<{ name: string }>();
      const component = createMockComponent();

      const user = UserContext.inject(component);

      expect(user).toBeUndefined();
    });

    it('should allow providing different values to different components', () => {
      const CountContext = createContext<number>(0);

      const component1 = createMockComponent();
      const component2 = createMockComponent();

      CountContext.provide(component1, 10);
      CountContext.provide(component2, 20);

      expect(CountContext.inject(component1)).toBe(10);
      expect(CountContext.inject(component2)).toBe(20);
    });
  });

  describe('injectOptional', () => {
    it('should return value when provided', () => {
      const ThemeContext = createContext<string>('light');
      const component = createMockComponent();

      ThemeContext.provide(component, 'dark');
      const theme = ThemeContext.injectOptional(component);

      expect(theme).toBe('dark');
    });

    it('should return undefined when not provided (ignoring default)', () => {
      const ThemeContext = createContext<string>('light');
      const component = createMockComponent();

      const theme = ThemeContext.injectOptional(component);

      expect(theme).toBeUndefined();
    });
  });

  describe('parent-child injection', () => {
    it('should inject from parent component', () => {
      const ThemeContext = createContext<string>('light');

      const parent = createMockComponent();
      const child = createMockComponent();
      child.setParent(parent);

      ThemeContext.provide(parent, 'dark');
      const theme = ThemeContext.inject(child);

      expect(theme).toBe('dark');
    });

    it('should prefer child value over parent', () => {
      const ThemeContext = createContext<string>('light');

      const parent = createMockComponent();
      const child = createMockComponent();
      child.setParent(parent);

      ThemeContext.provide(parent, 'dark');
      ThemeContext.provide(child, 'system');

      expect(ThemeContext.inject(child)).toBe('system');
      expect(ThemeContext.inject(parent)).toBe('dark');
    });

    it('should traverse multiple levels', () => {
      const ThemeContext = createContext<string>('light');

      const grandparent = createMockComponent();
      const parent = createMockComponent();
      const child = createMockComponent();

      parent.setParent(grandparent);
      child.setParent(parent);

      ThemeContext.provide(grandparent, 'dark');

      expect(ThemeContext.inject(child)).toBe('dark');
      expect(ThemeContext.inject(parent)).toBe('dark');
      expect(ThemeContext.inject(grandparent)).toBe('dark');
    });
  });

  describe('typed contexts', () => {
    it('should work with object types', () => {
      interface Config {
        apiUrl: string;
        timeout: number;
      }

      const ConfigContext = createContext<Config>({
        apiUrl: 'http://localhost',
        timeout: 5000,
      });

      const component = createMockComponent();
      ConfigContext.provide(component, {
        apiUrl: 'https://api.example.com',
        timeout: 10000,
      });

      const config = ConfigContext.inject(component);
      expect(config?.apiUrl).toBe('https://api.example.com');
      expect(config?.timeout).toBe(10000);
    });

    it('should work with function types', () => {
      type Logger = (msg: string) => void;
      const LoggerContext = createContext<Logger>(console.log);

      const component = createMockComponent();
      const mockLogger = vi.fn();
      LoggerContext.provide(component, mockLogger);

      const logger = LoggerContext.inject(component);
      logger?.('test message');

      expect(mockLogger).toHaveBeenCalledWith('test message');
    });

    it('should work with nullable types', () => {
      interface User {
        id: string;
        name: string;
      }

      const UserContext = createContext<User | null>(null);

      const component = createMockComponent();

      // Initially null
      expect(UserContext.inject(component)).toBeNull();

      // After providing user
      UserContext.provide(component, { id: '1', name: 'Alice' });
      expect(UserContext.inject(component)?.name).toBe('Alice');
    });
  });
});

describe('createRequiredContext', () => {
  describe('basic usage', () => {
    it('should create a context without default value', () => {
      const RouterContext = createRequiredContext<{ push: () => void }>(
        'Router'
      );

      expect(RouterContext.defaultValue).toBeUndefined();
      expect(typeof RouterContext.key).toBe('symbol');
    });
  });

  describe('inject behavior', () => {
    it('should return value when provided', () => {
      const RouterContext = createRequiredContext<{ path: string }>('Router');
      const component = createMockComponent();

      RouterContext.provide(component, { path: '/home' });
      const router = RouterContext.inject(component);

      expect(router.path).toBe('/home');
    });

    it('should throw when not provided', () => {
      const RouterContext = createRequiredContext<{ path: string }>('Router');
      const component = createMockComponent();

      expect(() => RouterContext.inject(component)).toThrow(
        'Context "Router" not found. Make sure a provider exists in the component tree.'
      );
    });
  });

  describe('injectOptional behavior', () => {
    it('should return value when provided', () => {
      const RouterContext = createRequiredContext<{ path: string }>('Router');
      const component = createMockComponent();

      RouterContext.provide(component, { path: '/home' });
      const router = RouterContext.injectOptional(component);

      expect(router?.path).toBe('/home');
    });

    it('should return undefined when not provided (no throw)', () => {
      const RouterContext = createRequiredContext<{ path: string }>('Router');
      const component = createMockComponent();

      const router = RouterContext.injectOptional(component);

      expect(router).toBeUndefined();
    });
  });

  describe('parent-child injection', () => {
    it('should inject from parent component', () => {
      const StoreContext = createRequiredContext<{ value: number }>('Store');

      const parent = createMockComponent();
      const child = createMockComponent();
      child.setParent(parent);

      StoreContext.provide(parent, { value: 42 });

      expect(StoreContext.inject(child).value).toBe(42);
    });

    it('should throw if parent does not provide', () => {
      const StoreContext = createRequiredContext<{ value: number }>('Store');

      const parent = createMockComponent();
      const child = createMockComponent();
      child.setParent(parent);

      expect(() => StoreContext.inject(child)).toThrow(
        'Context "Store" not found'
      );
    });
  });
});

describe('validation', () => {
  describe('createContext validation', () => {
    it('should throw when provide is called with non-component object', () => {
      const ThemeContext = createContext<string>('light');
      const notAComponent = { foo: 'bar' };

      expect(() => ThemeContext.provide(notAComponent, 'dark')).toThrow(
        "Context.provide() requires a Component instance. The provided object does not have a 'provide' method."
      );
      expectLogged('error', 'context:invalid-provider');
    });

    it('should throw when inject is called with non-component object', () => {
      const ThemeContext = createContext<string>('light');
      const notAComponent = { foo: 'bar' };

      expect(() => ThemeContext.inject(notAComponent)).toThrow(
        "Context.inject() requires a Component instance. The provided object does not have an 'inject' method."
      );
      expectLogged('error', 'context:invalid-consumer');
    });

    it('should throw when injectOptional is called with non-component object', () => {
      const ThemeContext = createContext<string>('light');
      const notAComponent = { foo: 'bar' };

      expect(() => ThemeContext.injectOptional(notAComponent)).toThrow(
        "Context.inject() requires a Component instance. The provided object does not have an 'inject' method."
      );
      expectLogged('error', 'context:invalid-consumer');
    });

    it('should throw when provide is called with null', () => {
      const ThemeContext = createContext<string>('light');

      expect(() => ThemeContext.provide(null as never, 'dark')).toThrow();
    });

    it('should throw when inject is called with undefined', () => {
      const ThemeContext = createContext<string>('light');

      expect(() => ThemeContext.inject(undefined as never)).toThrow();
    });
  });

  describe('createRequiredContext validation', () => {
    it('should throw when provide is called with non-component object', () => {
      const RouterContext = createRequiredContext<{ path: string }>('Router');
      const notAComponent = {};

      expect(() =>
        RouterContext.provide(notAComponent, { path: '/home' })
      ).toThrow(
        "Context.provide() requires a Component instance. The provided object does not have a 'provide' method."
      );
      expectLogged('error', 'context:invalid-provider');
    });

    it('should throw when inject is called with non-component object', () => {
      const RouterContext = createRequiredContext<{ path: string }>('Router');
      const notAComponent = {};

      expect(() => RouterContext.inject(notAComponent)).toThrow(
        "Context.inject() requires a Component instance. The provided object does not have an 'inject' method."
      );
      expectLogged('error', 'context:invalid-consumer');
    });
  });
});

describe('edge cases', () => {
  describe('undefined value handling', () => {
    it('should return default when undefined is explicitly provided (known limitation)', () => {
      // This documents the known limitation where undefined cannot be
      // distinguished from "not provided"
      const OptionalContext = createContext<string | undefined>('fallback');
      const component = createMockComponent();

      // Explicitly provide undefined
      OptionalContext.provide(component, undefined);

      // Due to the limitation, we get the default value
      // Users should use null instead of undefined for optional values
      const value = OptionalContext.inject(component);
      expect(value).toBe('fallback');
    });

    it('should return undefined via injectOptional when undefined is provided', () => {
      const OptionalContext = createContext<string | undefined>('fallback');
      const component = createMockComponent();

      OptionalContext.provide(component, undefined);

      // injectOptional bypasses the default value logic
      const value = OptionalContext.injectOptional(component);
      expect(value).toBeUndefined();
    });

    it('should work correctly with null values (recommended pattern)', () => {
      // This is the recommended pattern for optional values
      const OptionalContext = createContext<string | null>('fallback');
      const component = createMockComponent();

      // Provide null explicitly
      OptionalContext.provide(component, null);

      // null is correctly returned (not confused with "not provided")
      const value = OptionalContext.inject(component);
      expect(value).toBeNull();
    });
  });

  describe('falsy values', () => {
    it('should correctly handle zero as a value', () => {
      const CountContext = createContext<number>(99);
      const component = createMockComponent();

      CountContext.provide(component, 0);

      expect(CountContext.inject(component)).toBe(0);
    });

    it('should correctly handle empty string as a value', () => {
      const NameContext = createContext<string>('default');
      const component = createMockComponent();

      NameContext.provide(component, '');

      expect(NameContext.inject(component)).toBe('');
    });

    it('should correctly handle false as a value', () => {
      const FlagContext = createContext<boolean>(true);
      const component = createMockComponent();

      FlagContext.provide(component, false);

      expect(FlagContext.inject(component)).toBe(false);
    });
  });

  describe('object with provide/inject methods that are not functions', () => {
    it('should throw when provide is a non-function property', () => {
      const ThemeContext = createContext<string>('light');
      const badComponent = { provide: 'not a function', inject: 'also not' };

      expect(() => ThemeContext.provide(badComponent, 'dark')).toThrow(
        'Context.provide() requires a Component instance'
      );
      expectLogged('error', 'context:invalid-provider');
    });

    it('should throw when inject is a non-function property', () => {
      const ThemeContext = createContext<string>('light');
      const badComponent = { provide: () => {}, inject: 123 };

      expect(() => ThemeContext.inject(badComponent)).toThrow(
        'Context.inject() requires a Component instance'
      );
      expectLogged('error', 'context:invalid-consumer');
    });
  });
});
