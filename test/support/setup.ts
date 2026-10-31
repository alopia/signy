import { afterEach, beforeEach } from 'vitest';
import { LogLevel } from '../../src/log';
import { globalConfig } from '../../src/app/global-config';
import { assertNoUnexpectedLogs, installConsoleGuard } from './console';
import { unmountAll } from './mount';
import { destroyRouters } from './router';
import {
  checkInvariants,
  resetForTests,
  schedulerProblems,
  trackForTests,
} from '../../src/reactivity/testing';

installConsoleGuard();
trackForTests(true);

// jsdom does not implement scrolling and warns on every call.
if (navigator.userAgent.includes('jsdom')) {
  window.scrollTo = () => {};
  Element.prototype.scrollIntoView = () => {};
}

// jsdom has no reportError, browsers do: it raises the window error event at once.
if (typeof globalThis.reportError !== 'function') {
  globalThis.reportError = (error: unknown) => {
    window.dispatchEvent(
      new window.ErrorEvent('error', { error, cancelable: true })
    );
  };
}

// Warnings count as unexpected output too, not only errors.
beforeEach(() => {
  globalConfig.configure({ logLevel: LogLevel.WARN });
});

afterEach(() => {
  unmountAll();
  destroyRouters();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
  globalConfig.reset();

  // A stuck scheduler or a leaked subscription fails the test that left it
  const problems = [...schedulerProblems(), ...checkInvariants()];
  resetForTests();
  assertNoUnexpectedLogs();
  if (problems.length > 0) {
    throw new Error(`Reactive state left broken:\n  ${problems.join('\n  ')}`);
  }
});
