import { memoryRouter, type Router } from '../../src/router/router';
import type { RouterOptions } from '../../src/router/types';

const active = new Set<Router>();

/** A memory router destroyed after each test. */
export function createTestRouter(
  routes: RouterOptions['routes'],
  options: Omit<RouterOptions, 'routes' | 'mode'> & {
    initialEntries?: string[];
    initialIndex?: number;
  } = {}
): Router {
  const router = memoryRouter({ routes, ...options });
  active.add(router);
  return router;
}

/** Called from setup.ts after each test. */
export function destroyRouters(): void {
  for (const router of active) router.destroy();
  active.clear();
}
