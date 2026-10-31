import { onTestFinished } from 'vitest';
import { createRoot } from '../../src/reactivity';

/**
 * Runs `fn` in an owned root that is disposed when the test finishes, also
 * when it fails. `fn` gets the dispose function for tests that dispose early.
 */
export function testRoot<T>(fn: (dispose: () => void) => T): T {
  return createRoot((dispose) => {
    onTestFinished(dispose);
    return fn(dispose);
  });
}
