/**
 * Batch Update API
 *
 * Public API for batching multiple signal updates into a single notification cycle.
 * This is a signy framework feature, NOT part of the TC39 Signals proposal.
 *
 * The TC39 proposal explicitly states: "Writes are synchronous and immediately
 * take effect (a framework which batches writes can do that on top)". This module
 * provides that framework-level batching capability.
 *
 * @module reactivity/batch
 *
 * @example
 * ```typescript
 * import { Signal, batch } from 'signy';
 *
 * const firstName = new Signal(0);
 * const lastName = new Signal(0);
 *
 * // Without batch: subscribers notified twice
 * firstName.value = 1;
 * lastName.value = 2;
 *
 * // With batch: subscribers notified once
 * batch(() => {
 *   firstName.value = 10;
 *   lastName.value = 20;
 * });
 * ```
 *
 * ## TC39 Alignment Note
 *
 * The TC39 Signals proposal does not include batching. Per the proposal:
 * - Writes are synchronous and immediately take effect
 * - Frameworks provide batching "on top" as needed
 *
 * Signy provides batching for performance optimization when updating
 * multiple signals together.
 *
 * ## Known limitations
 *
 * None.
 *
 * ## Known Behaviors
 *
 * **Synchronous only**: the batch closes when `fn` returns. With an async
 * function, only the part before the first `await` is batched.
 */

import {
  enterBatch,
  exitBatch,
  isInBatch,
  forceFlush,
} from './signal/scheduler';

//=============================================
// Public API
//=============================================

/**
 * Batches multiple signal updates into a single notification cycle.
 * Subscribers are only notified once after all updates complete.
 *
 * Supports nested batching - only the outermost batch triggers
 * the notification flush. Computeds read inside the batch already see the
 * writes made before the read.
 *
 * @template T - Return type of the function
 * @param fn - Function containing signal updates
 * @returns The result of the function
 *
 * @example
 * ```typescript
 * const a = new Signal(1);
 * const b = new Signal(2);
 *
 * // Effect depends on both a and b
 * effect(() => console.log(a.value + b.value));
 *
 * batch(() => {
 *   a.value = 100;
 *   b.value = 200;
 * }); // Logs: 300
 * ```
 */
export function batch<T>(fn: () => T): T {
  enterBatch();
  try {
    return fn();
  } finally {
    exitBatch();
  }
}

/**
 * Checks if currently inside a batch operation.
 * Useful for debugging and conditional logic.
 *
 * @returns True if currently batching
 *
 * @example
 * ```typescript
 * console.log(isBatching()); // false
 *
 * batch(() => {
 *   console.log(isBatching()); // true
 * });
 *
 * console.log(isBatching()); // false
 * ```
 */
export function isBatching(): boolean {
  return isInBatch();
}

/**
 * Forces immediate flush of all pending subscribers.
 * Useful for testing or when synchronous updates are required.
 *
 * Note: This flushes the pending notifications even inside a batch, which
 * stays open for the writes after it.
 *
 * @example
 * ```typescript
 * batch(() => {
 *   count.value = 1;
 *   flushSync(); // Force immediate notification
 *   // Subscribers have already been notified here
 *   count.value = 2;
 * }); // Subscribers notified again for count=2
 * ```
 */
export function flushSync(): void {
  forceFlush();
}
