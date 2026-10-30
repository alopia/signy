/**
 * Injection Key Utilities
 *
 * Provides type-safe injection keys for the DI system.
 *
 * @module context/injection-key
 */

import type { InjectionKey } from '../types';

/**
 * Creates a type-safe injection key.
 * Use this to define keys for provide/inject.
 *
 * @template T - Type of the injected value
 * @param description - Description for debugging
 * @returns A typed symbol that can be used with provide/inject
 *
 * @example
 * ```typescript
 * // Define a key for an API service
 * interface ApiService {
 *   get(url: string): Promise<any>;
 * }
 *
 * const ApiKey = createInjectionKey<ApiService>('api');
 *
 * // In parent component
 * class App extends Component {
 *   protected setup() {
 *     this.provide(ApiKey, new MyApiService());
 *   }
 * }
 *
 * // In child component
 * class UserList extends Component {
 *   protected setup() {
 *     const api = this.inject(ApiKey);
 *     // api is typed as ApiService | undefined
 *   }
 * }
 * ```
 */
export function createInjectionKey<T>(description: string): InjectionKey<T> {
  return Symbol(description) as InjectionKey<T>;
}
