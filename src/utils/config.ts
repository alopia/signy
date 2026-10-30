/**
 * Generic and reusable configuration management class
 * @module utils/config
 */

const hasOwn = Object.prototype.hasOwnProperty;

/**
 * Base Config class - Generic and reusable configuration management
 *
 * This class provides a foundation for any configuration management needs.
 * It can be extended for specific use cases.
 *
 * Supports fluent API with method chaining:
 * ```typescript
 * config.set('debug', true).configure({ apiUrl: 'https://api.example.com' });
 * ```
 *
 * @template T - The configuration options type
 *
 * @example
 * ```typescript
 * interface MyConfig {
 *   debug: boolean;
 *   apiUrl: string;
 * }
 *
 * // Using static factory
 * const config = Config.create<MyConfig>({ debug: false });
 *
 * // Or extending for specific use cases
 * class MyConfigClass extends Config<MyConfig> {
 *   constructor() {
 *     super({ debug: false });
 *   }
 * }
 * ```
 */
export class Config<T extends Record<string, unknown>> {
  /**
   * Creates a new Config instance with optional defaults
   * @param defaults - Optional default configuration values
   * @returns A new Config instance
   */
  static create<T extends Record<string, unknown>>(
    defaults?: Partial<T>
  ): Config<T> {
    return new Config<T>(defaults);
  }

  protected _options: T;

  /**
   * Creates a new Config instance
   * @param defaults - Optional default configuration values
   */
  constructor(defaults?: Partial<T>) {
    this._options = { ...defaults } as T;
  }

  /**
   * Gets all configuration options
   * @returns A readonly copy of all configuration options
   */
  get all(): Readonly<T> {
    return { ...this._options };
  }

  /**
   * Returns the number of configuration keys
   */
  get size(): number {
    return Object.keys(this._options).length;
  }

  /**
   * Checks if the configuration is empty
   */
  get isEmpty(): boolean {
    return this.size === 0;
  }

  /**
   * Configures with new options (merges with existing)
   * @param options - Configuration options to merge
   * @returns This instance for method chaining
   */
  configure(options: Partial<T>): this {
    this._options = { ...this._options, ...options };
    return this;
  }

  /**
   * Gets a specific configuration value
   * @param key - The configuration key to retrieve
   * @returns The configuration value or undefined
   */
  getValue<K extends keyof T>(key: K): T[K] | undefined {
    // Own keys only, so toString or constructor are not config values
    return hasOwn.call(this._options, key) ? this._options[key] : undefined;
  }

  /**
   * Gets a configuration value with a fallback default
   * @param key - The configuration key to retrieve
   * @param defaultValue - The default value if key doesn't exist
   * @returns The configuration value or the default (never undefined)
   */
  getValueOr<K extends keyof T>(key: K, defaultValue: T[K]): T[K] {
    const value = this.getValue(key);
    return (value !== undefined ? value : defaultValue) as NonNullable<T[K]>;
  }

  /**
   * Sets a single configuration value
   * @param key - The configuration key to set
   * @param value - The value to set
   * @returns This instance for method chaining
   */
  set<K extends keyof T>(key: K, value: T[K]): this {
    this._options[key] = value;
    return this;
  }

  /**
   * Resets configuration to defaults
   * @param defaults - Optional default configuration values
   * @returns This instance for method chaining
   */
  reset(defaults?: Partial<T>): this {
    this._options = { ...defaults } as T;
    return this;
  }

  /**
   * Checks if a configuration key exists
   * @param key - The configuration key to check
   * @returns True if the key exists in the configuration
   */
  has(key: keyof T): boolean {
    return hasOwn.call(this._options, key);
  }

  /**
   * Checks if a configuration key has a truthy value
   * @param key - The configuration key to check
   * @returns True if the value exists and is truthy
   */
  isEnabled(key: keyof T): boolean {
    return !!this.getValue(key);
  }

  /**
   * Removes a configuration key
   * @param key - The configuration key to remove
   * @returns This instance for method chaining
   */
  remove<K extends keyof T>(key: K): this {
    delete this._options[key];
    return this;
  }

  /**
   * Iterates over all configuration entries
   * @param callback - Function called for each key-value pair
   */
  forEach(callback: <K extends keyof T>(value: T[K], key: K) => void): void {
    for (const key of Object.keys(this._options) as Array<keyof T>) {
      callback(this._options[key] as T[typeof key], key);
    }
  }
}
