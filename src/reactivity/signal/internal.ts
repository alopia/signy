/**
 * Internal Signal API
 *
 * This module exports internal signal APIs that should only be used
 * within the reactivity module. These are not part of the public API
 * and may change without notice.
 *
 * @module reactivity/signal/internal
 * @internal
 *
 * ## Known limitations
 *
 * None.
 */

// Links between sources and the computations that read them
export {
  getCurrentSubscriber,
  setCurrentSubscriber,
  startTracking,
  endTracking,
  trackSource,
  hasSourcesChanged,
  linkSources,
  unlinkSources,
  dropSources,
  notifySubscribers,
  clearSubscribers,
  subscribe,
  unsubscribe,
  countSubscribers,
  subscribersOf,
  Link,
  type Source,
  type Tracker,
} from './links';

// Internal scheduler utilities (signy implementation, not TC39)
export {
  // Signal notifications
  scheduleNotification,
  getPendingCount,
  enterBatch,
  exitBatch,
  isInBatch,
  forceFlush,
  // Version-based dirty checking
  bumpGlobalVersion,
  getGlobalVersion,
  countDerivedRead,
  getDerivedReads,
  // Effect scheduling (unified)
  scheduleEffect,
  registerEffectFlush,
  getPendingEffects,
  clearPendingEffects,
  isFlushingEffectsNow,
  setFlushingEffects,
  getPendingEffectsCount,
  scheduleTask,
  flushAll,
  // Test support
  trackForTests,
  registerSource,
  registerRunner,
  getRegistry,
  onResetForTests,
  getSchedulerState,
  resetForTests,
  // Types
  type Subscriber,
  type Runnable,
  type SubscriberTarget,
} from './scheduler';

// Internal log messages
export { SignalLogMessages } from './log-messages';
