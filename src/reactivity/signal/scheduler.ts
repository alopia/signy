/**
 * Unified Scheduler
 *
 * Central scheduling mechanism for Signal notifications, Effect execution and
 * DOM tasks.
 * This is a signy implementation detail, NOT part of the TC39 Signals proposal.
 *
 * ## Why Does signy Need a Scheduler?
 *
 * The TC39 Signals proposal provides only **pull-based** primitives:
 *
 * ```typescript
 * // TC39 provides:
 * Signal.State<T>     // Writable signal
 * Signal.Computed<T>  // Derived computation (lazy, pull-based)
 * Signal.subtle.*     // Introspection utilities
 * ```
 *
 * TC39 Computed is **pull-based only** - it only recomputes when you call `.get()`:
 *
 * ```typescript
 * const count = new Signal(0);
 * const double = new Computed(() => count.get() * 2);
 *
 * count.set(5);
 * // Nothing happens! double doesn't know count changed
 * double.get(); // Only NOW does it recompute
 * ```
 *
 * However, signy's `effect()` is **push-based** - effects run automatically
 * when dependencies change:
 *
 * ```typescript
 * effect(() => console.log(count.value));
 * count.value = 5; // Effect runs automatically!
 * ```
 *
 * Push-based reactivity requires scheduling infrastructure to:
 * 1. **Notify** - Tell effects when dependencies change
 * 2. **Batch** - Avoid running effect 100 times for 100 rapid changes
 * 3. **Deduplicate** - Run each effect only once per batch
 * 4. **Order** - Handle dependency chains correctly
 * 5. **Defer** - Let sync code finish before effects run (microtask)
 *
 * ## TC39 Design Philosophy
 *
 * The TC39 proposal explicitly states:
 * > "Writes are synchronous and immediately take effect
 * > (a framework which batches writes can do that on top)"
 *
 * This scheduler IS that "on top" layer. Every reactive framework has one:
 *
 * | Framework | Scheduler |
 * |-----------|-----------|
 * | React | Scheduler package, Fiber reconciler |
 * | Vue | nextTick queue, reactive effect queue |
 * | Svelte | Compiler-generated update batching |
 * | Solid.js | Internal fine-grained scheduler |
 * | Angular | Zone.js + Change Detection |
 *
 * ## Why Not Use TC39 Watcher?
 *
 * The TC39 proposal mentions a potential `Signal.subtle.Watcher` API that
 * could provide push notifications. However:
 * 1. It's not finalized and may change
 * 2. It only notifies "dirty", not "changed"
 * 3. Frameworks still need scheduling logic for batching/ordering
 *
 * If TC39 Watcher lands in the future, Signy could refactor to use it as
 * the notification primitive while keeping this scheduling logic.
 *
 * ## Alternatives Considered
 *
 * | Approach | Why Not |
 * |----------|---------|
 * | Polling (rAF/setInterval) | Wastes CPU, high latency, battery drain |
 * | No effects (pull-only) | Users must manually call .get() everywhere |
 * | Remove scheduler | Not possible - scheduling IS the push layer |
 *
 * ## Architecture
 *
 * The scheduler handles three types of work:
 * 1. **Signal notifications**: Batched synchronously via `scheduleNotification()`
 * 2. **Effect execution**: Queued to microtask via `scheduleEffect()`
 * 3. **DOM tasks**: Render effect re-runs and control flow setup, queued to
 *    microtask via `scheduleTask()`
 *
 * The `flushAll()` function synchronously flushes all three until none is left.
 *
 * ## Version-based Dirty Checking
 *
 * Sources (State, Computed) have a `version` property that increments on value change.
 * The links of links.ts keep the version each reader saw, so a computed checks
 * whether its sources changed before recomputing.
 *
 * ## Public vs Internal API
 *
 * This module is primarily **internal infrastructure**. Most exports are marked
 * `@internal` and should not be used outside of signy's reactivity system.
 *
 * | Export | Public? | Purpose |
 * |--------|---------|---------|
 * | `flushAll()` | Yes | Synchronously flush all pending work |
 * | `scheduleNotification()` | No | Queue subscriber notification |
 * | `scheduleEffect()` | No | Queue effect execution |
 * | `scheduleTask()` | No | Queue a DOM task |
 * | `enterBatch()`, `exitBatch()` | No | Used by `batch()` |
 *
 * **`flushAll()`** is the only public export, exposed by the `signy` entry.
 * It is not in `signy/core` or `signy/web`, to keep those bundles small.
 *
 * Use cases for `flushAll()`:
 * - Testing: Synchronously flush effects for assertions
 * - SSR: Ensure all effects complete before serializing
 * - Edge cases requiring synchronous completion
 *
 * @module reactivity/signal/scheduler
 * @internal
 *
 * ## Known limitations
 *
 * None.
 */

import { panic } from '../../log';
import { SignalLogMessages } from './log-messages';
import type { Source } from './links';

//=============================================
// Types
//=============================================

/**
 * Subscriber callback, or an object with a notify() method, so an effect can
 * be its own subscriber without a closure.
 * Used internally by the signal system for notification scheduling.
 * An eager subscriber only marks state and runs even inside a batch, so a
 * computed read in the batch sees the writes made before it.
 */
export type Subscriber = ((() => void) | { notify(): void }) & {
  /** The effect or computed this subscriber belongs to, for checkInvariants() */
  target?: SubscriberTarget;
  eager?: boolean;
};

/**
 * The effect or computed behind a subscriber.
 */
export interface SubscriberTarget {
  readonly disposed: boolean;
  /** For a computed: whether anything subscribes to it */
  readonly watched?: boolean;
}

//=============================================
// Module State
//=============================================

/**
 * Bumped on every write to any source, so a computed without subscribers can
 * skip checking its sources when nothing was written since its last check.
 */
let globalVersion = 0;

/**
 * Bumped when a subscriber tracks a computed, so an effect that read none
 * skips looking for one.
 */
let derivedReads = 0;

/**
 * Current batch depth. When > 0, notifications are queued.
 * Supports nested batching.
 */
let batchDepth = 0;

/**
 * Pending subscribers to notify when batch completes.
 * Using Set ensures each subscriber is notified at most once per batch.
 */
let pendingSubscribers = new Set<Subscriber>();

/** The other set of the double buffer flushPending() swaps, to copy nothing */
let flushingSubscribers = new Set<Subscriber>();

//=============================================
// Internal API - Versions
//=============================================

/**
 * Records a write to a source.
 *
 * @internal
 */
export function bumpGlobalVersion(): void {
  globalVersion++;
}

/**
 * The write counter of all sources.
 *
 * @internal
 */
export function getGlobalVersion(): number {
  return globalVersion;
}

/** @internal */
export function countDerivedRead(): void {
  derivedReads++;
}

/** @internal */
export function getDerivedReads(): number {
  return derivedReads;
}

//=============================================
// Internal API - Batching
//=============================================

/**
 * Schedules a subscriber notification, respecting batch state.
 * If batching, the subscriber is queued; otherwise, it's called immediately.
 *
 * @param subscriber - The subscriber callback to notify
 * @internal
 */
export function scheduleNotification(subscriber: Subscriber): void {
  if (batchDepth > 0 && !subscriber.eager) {
    pendingSubscribers.add(subscriber);
  } else {
    notify(subscriber);
  }
}

function notify(subscriber: Subscriber): void {
  if (typeof subscriber === 'function') subscriber();
  else subscriber.notify();
}

/**
 * Enters batch mode. Increments batch depth.
 * Called by the public `batch()` function.
 *
 * @internal
 */
export function enterBatch(): void {
  batchDepth++;
}

/**
 * Exits batch mode and flushes if at outermost level.
 * Called by the public `batch()` function.
 *
 * @internal
 */
export function exitBatch(): void {
  batchDepth--;
  if (batchDepth === 0) {
    flushPending();
  }
}

/**
 * Checks if currently inside a batch operation.
 *
 * @returns True if currently batching
 * @internal
 */
export function isInBatch(): boolean {
  return batchDepth > 0;
}

/**
 * Forces immediate flush of all pending subscribers.
 * Used by `flushSync()` to synchronously flush notifications.
 *
 * @internal
 */
export function forceFlush(): void {
  const previousDepth = batchDepth;
  batchDepth = 0;
  try {
    flushPending();
  } finally {
    batchDepth = previousDepth;
  }
}

/**
 * Gets the number of pending subscribers.
 * Useful for debugging and testing.
 *
 * @returns Number of subscribers waiting to be notified
 * @internal
 */
export function getPendingCount(): number {
  return pendingSubscribers.size;
}

//=============================================
// Effect Scheduling (Unified Scheduling)
//=============================================

/**
 * Runnable interface for effects.
 * Effects implement this to be scheduled.
 */
export interface Runnable {
  run(): void;
  readonly disposed: boolean;
}

/**
 * Pending effects to run (microtask scheduled). Each effect deduplicates
 * itself with its own queued flag, so this is a plain array.
 */
let pendingEffects: Runnable[] | null = null;

/**
 * Whether a microtask to flush effects is queued. flushAll() empties the queue
 * without clearing this, so writes until that microtask runs queue no other.
 */
let effectsMicrotaskQueued = false;

/**
 * Whether we're currently flushing effects
 */
let isFlushingEffects = false;

/**
 * Effect flush callback - set by effect module to avoid circular imports
 */
let effectFlushCallback: (() => void) | null = null;

/**
 * Registers the effect flush callback.
 * Called once by the effect module during initialization.
 *
 * @param callback - The flush callback from effect module
 * @internal
 */
export function registerEffectFlush(callback: () => void): void {
  effectFlushCallback = callback;
}

/**
 * Schedules an effect to run in a microtask. The caller makes sure an effect
 * is queued at most once.
 *
 * @param effect - The effect to schedule
 * @internal
 */
export function scheduleEffect(effect: Runnable): void {
  if (!pendingEffects) pendingEffects = [];
  if (!effectsMicrotaskQueued) {
    effectsMicrotaskQueued = true;
    queueMicrotask(flushEffectsInternal);
  }
  pendingEffects.push(effect);
}

/**
 * Gets the pending effects queue.
 * Used by the effect module for flushing.
 *
 * @returns The pending effects queue or null
 * @internal
 */
export function getPendingEffects(): Runnable[] | null {
  return pendingEffects;
}

/**
 * Clears the pending effects queue.
 * Called after effects are collected for flushing.
 *
 * @internal
 */
export function clearPendingEffects(): void {
  pendingEffects = null;
}

/**
 * Checks if currently flushing effects.
 *
 * @returns True if flushing effects
 * @internal
 */
export function isFlushingEffectsNow(): boolean {
  return isFlushingEffects;
}

/**
 * Sets the flushing effects state.
 *
 * @param value - Whether currently flushing
 * @internal
 */
export function setFlushingEffects(value: boolean): void {
  isFlushingEffects = value;
}

/**
 * Gets the pending effects count.
 * Useful for debugging and testing.
 *
 * @returns Number of effects waiting to run
 * @internal
 */
export function getPendingEffectsCount(): number {
  return pendingEffects?.length ?? 0;
}

/**
 * Internal effect flush - called from microtask.
 */
function flushEffectsInternal(): void {
  effectsMicrotaskQueued = false;
  if (effectFlushCallback) {
    effectFlushCallback();
  }
}

//=============================================
// DOM Task Scheduling
//=============================================

/**
 * Pending DOM tasks, run in order in one microtask
 */
let pendingTasks: Array<(() => void) | Runnable> | null = null;

/** Whether a microtask to flush tasks is queued, as for effects */
let tasksMicrotaskQueued = false;

/**
 * Maximum flush rounds before `flushAll()` gives up on a cycle.
 */
const MAX_FLUSH_ROUNDS = 100;

/**
 * Schedules a DOM task to run in a microtask, after the current sync code.
 * Used for render effect re-runs and control flow setup so `flushAll()`
 * can run them early.
 *
 * @param task - The task to run
 * @internal
 */
export function scheduleTask(task: (() => void) | Runnable): void {
  if (!pendingTasks) pendingTasks = [];
  queueTasksMicrotask();
  pendingTasks.push(task);
}

/**
 * Flushes all pending work: signal notifications, effects and DOM tasks.
 * Repeats until nothing is pending, so work queued by other work also runs.
 * Useful for testing or when synchronous completion is required.
 *
 * @throws {SignyError} If work keeps queueing more work for 100 rounds
 */
export function flushAll(): void {
  for (let round = 0; round < MAX_FLUSH_ROUNDS; round++) {
    forceFlush();

    if (effectFlushCallback && pendingEffects && pendingEffects.length > 0) {
      effectFlushCallback();
    } else if (pendingTasks) {
      flushTasks();
    } else if (pendingSubscribers.size === 0) {
      return;
    }
  }
  panic(SignalLogMessages.FLUSH_EXCEEDED, { rounds: MAX_FLUSH_ROUNDS });
}

//=============================================
// Private Functions
//=============================================

/**
 * Runs the DOM tasks pending right now. Tasks they queue go to a new batch.
 */
function flushTasks(): void {
  const tasks = pendingTasks;
  if (!tasks) return;
  pendingTasks = null;
  for (let i = 0; i < tasks.length; i++) {
    try {
      const task = tasks[i]!;
      if (typeof task === 'function') task();
      else task.run();
    } catch (error) {
      // Requeue the rest so one failing binding does not freeze the others.
      // concat(), as a spread of a long queue overflows the argument limit
      const rest = tasks.slice(i + 1);
      if (pendingTasks) {
        pendingTasks = rest.concat(pendingTasks);
      } else {
        pendingTasks = rest;
        queueTasksMicrotask();
      }
      throw error;
    }
  }
}

function queueTasksMicrotask(): void {
  if (tasksMicrotaskQueued) return;
  tasksMicrotaskQueued = true;
  queueMicrotask(flushTasksMicrotask);
}

function flushTasksMicrotask(): void {
  tasksMicrotaskQueued = false;
  flushTasks();
}

/**
 * Flushes all pending subscribers.
 * Loops until no more pending subscribers to handle cascading updates.
 */
function flushPending(): void {
  // One throwing subscriber must not drop the rest, so the first error is
  // rethrown once every subscriber ran
  let failed = false;
  let firstError: unknown;
  while (pendingSubscribers.size > 0) {
    // Swap, so subscribers scheduled while this round runs go to the next
    const round = pendingSubscribers;
    pendingSubscribers = flushingSubscribers;
    flushingSubscribers = round;
    for (const subscriber of round) {
      try {
        notify(subscriber);
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
        }
      }
    }
    round.clear();
  }
  if (failed) throw firstError;
}

//=============================================
// Test Support
//=============================================

/** Sources and runners created while tests track them, null otherwise */
let registry: { sources: Set<Source>; runners: Set<unknown> } | null = null;

/** Module state outside the scheduler that resetForTests() clears too */
const resetHooks: Array<() => void> = [];

/**
 * Starts or stops recording the sources and effects created, so
 * checkInvariants() can inspect them. For tests only.
 *
 * @internal
 */
export function trackForTests(on: boolean): void {
  registry = on ? { sources: new Set(), runners: new Set() } : null;
}

/**
 * Records a source while tests track. Returns whether they do.
 *
 * @internal
 */
export function registerSource(source: Source): boolean {
  if (!registry) return false;
  registry.sources.add(source);
  return true;
}

/**
 * Records an effect while tests track. Returns whether they do, so the
 * effect sets the test only `target` of its subscriber just then.
 *
 * @internal
 */
export function registerRunner(runner: unknown): boolean {
  if (!registry) return false;
  registry.runners.add(runner);
  return true;
}

/**
 * The sources and runners recorded since trackForTests() or the last reset.
 *
 * @internal
 */
export function getRegistry(): {
  sources: ReadonlySet<Source>;
  runners: ReadonlySet<unknown>;
} | null {
  return registry;
}

/**
 * Registers module state to clear in resetForTests().
 *
 * @internal
 */
export function onResetForTests(hook: () => void): void {
  resetHooks.push(hook);
}

/**
 * What the scheduler is in the middle of. Between tests every count is 0 and
 * nothing is flushing, or a test left it stuck.
 *
 * @internal
 */
export function getSchedulerState(): {
  batchDepth: number;
  flushingEffects: boolean;
  pendingSubscribers: number;
  pendingEffects: number;
  pendingTasks: number;
} {
  return {
    batchDepth,
    flushingEffects: isFlushingEffects,
    pendingSubscribers: pendingSubscribers.size,
    pendingEffects: pendingEffects?.length ?? 0,
    pendingTasks: pendingTasks?.length ?? 0,
  };
}

/**
 * Puts the scheduler back to its initial state, so one test cannot leave the
 * next a stuck batch or a pending flush. For tests only.
 *
 * @internal
 */
export function resetForTests(): void {
  // Hooks first: they may need what is about to be cleared
  for (const hook of resetHooks) hook();
  batchDepth = 0;
  pendingSubscribers.clear();
  flushingSubscribers.clear();
  pendingEffects = null;
  effectsMicrotaskQueued = false;
  isFlushingEffects = false;
  pendingTasks = null;
  tasksMicrotaskQueued = false;
  if (registry) trackForTests(true);
}
