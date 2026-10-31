/**
 * Smoke tests against the built package in dist/. Run after `npm run build:all`.
 */

import { describe, it, expect } from 'vitest';
import pkg from '../../package.json';

const expected: Record<string, string[]> = {
  signy: [
    'Component',
    'Signal',
    'Computed',
    'html',
    'application',
    'flushAll',
    'VERSION',
  ],
  'signy/core': ['Signal', 'Computed', 'batch', 'features'],
  'signy/web': ['Component', 'html', 'Show', 'For'],
  'signy/app': ['application', 'Application'],
  'signy/router': ['router', 'memoryRouter', 'Link', 'Outlet', 'lazyRoute'],
  'signy/store': ['store', 'ReactiveStore', 'produce', 'unwrap'],
  'signy/jsx': ['template', 'insert', 'createComponent', 'delegateEvents'],
  'signy/jsx-runtime': ['jsx', 'jsxs', 'Fragment'],
  'signy/jsx-dev-runtime': ['jsxDEV', 'Fragment'],
};

describe('package exports', () => {
  it('lists a test for every subpath in package.json', () => {
    const subpaths = Object.keys(pkg.exports).map((key) =>
      key === '.' ? 'signy' : `signy/${key.slice(2)}`
    );
    expect(Object.keys(expected).sort()).toEqual(subpaths.sort());
  });

  it.each(Object.entries(expected))(
    '%s exposes its API',
    async (specifier, names) => {
      const mod = (await import(/* @vite-ignore */ specifier)) as Record<
        string,
        unknown
      >;
      for (const name of names) {
        expect(mod, `${specifier} is missing ${name}`).toHaveProperty(name);
      }
    }
  );

  it('bakes the package version into the build', async () => {
    const { VERSION } = (await import('signy')) as { VERSION: string };
    expect(VERSION).toBe(pkg.version);
  });

  it('shares one runtime across subpaths', async () => {
    type Mod = Record<string, unknown>;
    const main = (await import('signy')) as Mod;
    const core = (await import('signy/core')) as Mod;
    const web = (await import('signy/web')) as Mod;
    const store = (await import('signy/store')) as Mod;
    const router = (await import('signy/router')) as Mod;

    expect(core['Signal']).toBe(main['Signal']);
    expect(web['Component']).toBe(main['Component']);
    expect(store['ReactiveStore']).toBe(main['ReactiveStore']);
    expect(router['Link']).toBe(main['Link']);

    const Component = main['Component'] as abstract new () => object;
    const Link = router['Link'] as abstract new () => object;
    expect(Link.prototype instanceof Component).toBe(true);
  });
});
