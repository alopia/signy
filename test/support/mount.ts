import { type Application, application } from '../../src/app/application';
import { Component } from '../../src/component/component';
import type { Installable } from '../../src/app/installable-registry';
import type { RenderResult } from '../../src/types';
import { flushAll, type Effect } from '../../src/reactivity';
import { liveEffects } from '../../src/reactivity/testing';

type ComponentClass = new (props?: never) => Component;

export interface Mounted {
  root: HTMLElement;
  app: Application;
  unmount(): void;
}

export interface MountOptions {
  plugins?: Installable<Application>[];
}

const active = new Set<Application>();

/** Effects live before the first of the active apps mounted */
let baseline = new Set<Effect<unknown>>();

/**
 * Mounts a component class, or a render function, into a fresh container
 * through application(), then settles. Unmounted after each test.
 */
export function mount(
  root: ComponentClass | (() => RenderResult),
  options: MountOptions = {}
): Mounted {
  const Root =
    root.prototype instanceof Component
      ? (root as ComponentClass)
      : class TestRoot extends Component {
          protected render(): RenderResult {
            return (root as () => RenderResult)();
          }
        };

  const container = document.createElement('div');
  container.id = 'test-root';
  document.body.appendChild(container);

  if (active.size === 0) baseline = new Set(liveEffects());
  const app = application(Root);
  for (const plugin of options.plugins ?? []) app.use(plugin);
  app.mount(container);
  active.add(app);
  flushAll();

  return {
    root: container,
    app,
    unmount: () => {
      if (!active.delete(app)) return;
      app.unmount();
      if (active.size === 0) checkLeaks();
    },
  };
}

/** Called from setup.ts after each test. */
export function unmountAll(): void {
  if (active.size === 0) return;
  for (const app of active) app.unmount();
  active.clear();
  checkLeaks();
}

/**
 * Fails when an effect created since the first active app mounted is still
 * live once they are all unmounted: an app leaked it.
 */
function checkLeaks(): void {
  const leaked = liveEffects().filter((effect) => !baseline.has(effect));
  if (leaked.length > 0) {
    throw new Error(`${leaked.length} effect(s) still live after unmount`);
  }
}
