import { flushAll } from '../../src/reactivity';

/** Waits one macrotask, so pending promises and timers of 0ms resolve. */
export const tick = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/** Waits one microtask, for code that runs on queueMicrotask(). */
export const microtask = (): Promise<void> => Promise.resolve();

/** Runs all pending notifications, effects and DOM updates synchronously. */
export const settle = (): void => flushAll();

/** Waits for pending promises (loaders, lazy imports), then settles. */
export async function settleAsync(): Promise<void> {
  await tick();
  flushAll();
}
