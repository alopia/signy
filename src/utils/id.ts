/**
 * Unique ID Generation
 *
 * Provides utilities for generating unique IDs, particularly useful for
 * accessibility attributes (aria-labelledby, aria-describedby, etc.).
 *
 * @module utils/id
 *
 * @example
 * ```typescript
 * import { useId, createIdGenerator } from 'signy';
 *
 * // Generate a unique ID
 * const id = useId(); // 'signy-1'
 *
 * // Use in accessibility attributes
 * html`
 *   <label id=${labelId}>Email</label>
 *   <input aria-labelledby=${labelId} />
 * `;
 *
 * // Custom prefix
 * const dialogId = useId('dialog'); // 'dialog-1'
 * ```
 *
 * ## Known limitations
 *
 * None.
 */

//=============================================
// Module State
//=============================================

/**
 * Global counter for generating unique IDs.
 * Starts at 0 and increments with each call to useId().
 */
let idCounter = 0;

/**
 * Default prefix for generated IDs
 */
const DEFAULT_PREFIX = 'signy';

//=============================================
// Public API Functions
//=============================================

/**
 * Generates a unique ID string.
 *
 * Each call returns a new ID that is guaranteed to be unique within the
 * current session. IDs are NOT stable across server/client boundaries
 * or page reloads.
 *
 * @param prefix - Optional prefix for the ID (default: 'signy')
 * @returns A unique ID string in the format `{prefix}-{counter}`
 *
 * @example
 * ```typescript
 * // Basic usage
 * const id1 = useId(); // 'signy-1'
 * const id2 = useId(); // 'signy-2'
 *
 * // With custom prefix
 * const menuId = useId('menu'); // 'menu-3'
 * const buttonId = useId('btn'); // 'btn-4'
 * ```
 *
 * @example
 * ```typescript
 * // Accessibility pattern
 * class Tooltip extends Component {
 *   private tooltipId = useId('tooltip');
 *
 *   protected render() {
 *     return html`
 *       <button aria-describedby=${this.tooltipId}>
 *         Hover me
 *       </button>
 *       <div id=${this.tooltipId} role="tooltip">
 *         Tooltip content
 *       </div>
 *     `;
 *   }
 * }
 * ```
 */
export function useId(prefix: string = DEFAULT_PREFIX): string {
  return `${prefix}-${++idCounter}`;
}

/**
 * Creates an ID generator with a specific prefix.
 *
 * Useful when you need multiple IDs with the same prefix within
 * a component or module.
 *
 * @param prefix - Prefix for all generated IDs
 * @returns A function that generates IDs with the given prefix
 *
 * @example
 * ```typescript
 * const formId = createIdGenerator('form-field');
 *
 * const emailId = formId(); // 'form-field-1'
 * const passwordId = formId(); // 'form-field-2'
 * ```
 */
export function createIdGenerator(prefix: string): () => string {
  return () => useId(prefix);
}

/**
 * Generates multiple unique IDs at once.
 *
 * @param count - Number of IDs to generate
 * @param prefix - Optional prefix for the IDs (default: 'signy')
 * @returns An array of unique ID strings
 *
 * @example
 * ```typescript
 * const [labelId, inputId, errorId] = useIds(3, 'field');
 * // ['field-1', 'field-2', 'field-3']
 * ```
 */
export function useIds(
  count: number,
  prefix: string = DEFAULT_PREFIX
): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    ids.push(useId(prefix));
  }
  return ids;
}

/**
 * Resets the ID counter.
 *
 * **Warning:** Only use this for testing purposes. Resetting the counter
 * in production can cause duplicate IDs.
 *
 * @internal
 */
export function resetIdCounter(): void {
  idCounter = 0;
}

/**
 * Gets the current ID counter value.
 *
 * Useful for debugging or testing purposes.
 *
 * @returns The current counter value
 *
 * @internal
 */
export function getIdCounter(): number {
  return idCounter;
}
