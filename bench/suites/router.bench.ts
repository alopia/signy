import type { RouteComponent, RouteConfig } from '../../src/router/types.ts';
import { defineSuite } from '../suite.ts';

// Navigation needs window for scroll handling, so it waits for the browser tier.

// Matching never constructs the component.
const component = class {} as unknown as RouteComponent;

function routeTable(n: number): RouteConfig[] {
  const routes: RouteConfig[] = [{ path: '/', component }];
  for (let i = 0; i < n - 2; i++) {
    routes.push({
      path: `/section-${i}`,
      component,
      children: [{ path: ':id', component }],
    });
  }
  routes.push({ path: '/users/:userId/posts/:postId', component });
  return routes;
}

export default defineSuite({
  name: 'router',
  tier: 'node',
  time: {
    'compile 200 routes': (s) => {
      const routes = routeTable(200);
      return { run: () => s.compileRoutes(routes) };
    },
    'resolve, 10 routes, last route': (s) => {
      const compiled = s.compileRoutes(routeTable(10));
      return { run: () => s.resolvePath('/users/7/posts/42', compiled) };
    },
    'resolve, 200 routes, last route': (s) => {
      const compiled = s.compileRoutes(routeTable(200));
      return { run: () => s.resolvePath('/users/7/posts/42', compiled) };
    },
    'resolve, 200 routes, nested child with query': (s) => {
      const compiled = s.compileRoutes(routeTable(200));
      return {
        run: () => s.resolvePath('/section-150/abc?tab=2&sort=asc', compiled),
      };
    },
    'matchPath with 2 params': (s) => {
      const pattern = s.compilePath('/users/:userId/posts/:postId');
      return { run: () => s.matchPath('/users/7/posts/42', pattern) };
    },
    'parseQuery and stringifyQuery, 5 keys': (s) => {
      const search = '?a=1&b=two&c=%20three&d=4&e=five';
      return { run: () => s.stringifyQuery(s.parseQuery(search)) };
    },
  },
});
