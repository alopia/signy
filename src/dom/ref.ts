/**
 * Ref - DOM Element References
 *
 * Provides a simple container for capturing references to DOM elements.
 * Refs are stable containers that persist across renders.
 *
 * @module dom/ref
 *
 * @example
 * ```typescript
 * import { createRef, html } from 'signy';
 *
 * class MyComponent extends Component {
 *   private inputRef = createRef<HTMLInputElement>();
 *
 *   protected onMount() {
 *     // Access DOM element after mount
 *     this.inputRef.current?.focus();
 *   }
 *
 *   protected render() {
 *     return html`
 *       <input ref=${this.inputRef} type="text" />
 *       <button onClick=${() => this.inputRef.current?.select()}>
 *         Select All
 *       </button>
 *     `;
 *   }
 * }
 * ```
 *
 * ## Known limitations
 *
 * None.
 */

//=============================================
// Types
//=============================================

/**
 * A ref object that holds a reference to a value.
 * Similar to React's RefObject but simpler.
 *
 * @template T - The type of the referenced value
 */
export interface Ref<T> {
  /** The current referenced value, or null if not set */
  current: T | null;
}

/**
 * A ref object with an initial value (never null).
 *
 * @template T - The type of the referenced value
 */
export interface RefWithValue<T> {
  /** The current referenced value */
  current: T;
}

//=============================================
// createRef
//=============================================

/**
 * Creates a ref object for capturing references to DOM elements or values.
 *
 * Refs are stable containers whose `current` property can be mutated
 * without triggering reactivity. They're useful for:
 * - Capturing DOM element references
 * - Storing mutable values that shouldn't trigger re-renders
 * - Keeping references stable across renders
 *
 * @template T - The type of the referenced value (defaults to HTMLElement)
 * @returns A ref object with a `current` property initialized to null
 *
 * @example
 * ```typescript
 * // DOM element ref
 * const buttonRef = createRef<HTMLButtonElement>();
 *
 * // After render, access the element
 * buttonRef.current?.click();
 *
 * // Store any mutable value
 * const countRef = createRef<number>();
 * countRef.current = 0;
 * countRef.current++; // No reactivity triggered
 * ```
 */
export function createRef<T = HTMLElement>(): Ref<T> {
  return { current: null };
}

/**
 * Creates a ref object with an initial value.
 *
 * Unlike `createRef()`, this variant requires an initial value and
 * guarantees `current` is never null.
 *
 * @template T - The type of the referenced value
 * @param initialValue - The initial value for the ref
 * @returns A ref object with `current` set to the initial value
 *
 * @example
 * ```typescript
 * const timerRef = createRefWithValue<number>(0);
 * timerRef.current = setInterval(() => {}, 1000);
 *
 * // Cleanup
 * clearInterval(timerRef.current);
 * ```
 */
export function createRefWithValue<T>(initialValue: T): RefWithValue<T> {
  return { current: initialValue };
}

/**
 * Type guard to check if a value is a Ref object.
 *
 * @param value - The value to check
 * @returns True if the value is a Ref object
 */
export function isRef<T>(value: unknown): value is Ref<T> {
  return typeof value === 'object' && value !== null && 'current' in value;
}
