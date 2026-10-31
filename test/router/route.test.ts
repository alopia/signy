/**
 * Route Matching Tests
 */

import { describe, it, expect } from 'vitest';
import {
  compilePath,
  matchPath,
  compileRoutes,
  resolvePath,
  parseQuery,
  stringifyQuery,
  normalizePath,
  joinPaths,
  generatePath,
  normalizeEncoding,
} from '../../src/router/route';
import type { RouteConfig } from '../../src/router/types';

describe('compilePath', () => {
  describe('static paths', () => {
    it('should compile root path', () => {
      const compiled = compilePath('/');
      expect(compiled.paramNames).toEqual([]);
      expect(compiled.regex.test('/')).toBe(true);
    });

    it('should compile static path', () => {
      const compiled = compilePath('/users');
      expect(compiled.paramNames).toEqual([]);
      expect(compiled.regex.test('/users')).toBe(true);
      expect(compiled.regex.test('/posts')).toBe(false);
    });

    it('should compile nested static path', () => {
      const compiled = compilePath('/users/list/active');
      expect(compiled.regex.test('/users/list/active')).toBe(true);
      expect(compiled.regex.test('/users/list')).toBe(false);
    });

    it('should be case insensitive', () => {
      const compiled = compilePath('/Users');
      expect(compiled.regex.test('/users')).toBe(true);
      expect(compiled.regex.test('/USERS')).toBe(true);
    });

    it('should match with optional trailing slash', () => {
      const compiled = compilePath('/users');
      expect(compiled.regex.test('/users')).toBe(true);
      expect(compiled.regex.test('/users/')).toBe(true);
    });
  });

  describe('dynamic parameters', () => {
    it('should compile single parameter', () => {
      const compiled = compilePath('/users/:id');
      expect(compiled.paramNames).toEqual(['id']);
      expect(compiled.regex.test('/users/123')).toBe(true);
      expect(compiled.regex.test('/users/')).toBe(false);
    });

    it('should compile multiple parameters', () => {
      const compiled = compilePath('/users/:userId/posts/:postId');
      expect(compiled.paramNames).toEqual(['userId', 'postId']);
      expect(compiled.regex.test('/users/1/posts/2')).toBe(true);
    });

    it('should compile optional parameters', () => {
      const compiled = compilePath('/users/:id?');
      expect(compiled.paramNames).toEqual(['id']);
      expect(compiled.regex.test('/users')).toBe(true);
      expect(compiled.regex.test('/users/123')).toBe(true);
    });
  });

  describe('wildcards', () => {
    it('should compile wildcard', () => {
      const compiled = compilePath('/files/*');
      expect(compiled.paramNames).toEqual(['*']);
      expect(compiled.regex.test('/files/any/path/here')).toBe(true);
    });

    it('should compile named wildcard', () => {
      const compiled = compilePath('/files/*path');
      expect(compiled.paramNames).toEqual(['path']);
      expect(compiled.regex.test('/files/docs/readme.md')).toBe(true);
    });
  });

  describe('scoring', () => {
    it('should score static paths higher than dynamic', () => {
      const static1 = compilePath('/users/list');
      const dynamic = compilePath('/users/:id');
      expect(static1.score).toBeGreaterThan(dynamic.score);
    });

    it('should score dynamic paths higher than wildcards', () => {
      const dynamic = compilePath('/users/:id');
      const wildcard = compilePath('/users/*');
      expect(dynamic.score).toBeGreaterThan(wildcard.score);
    });

    it('should score required params higher than optional', () => {
      const required = compilePath('/users/:id');
      const optional = compilePath('/users/:id?');
      expect(required.score).toBeGreaterThan(optional.score);
    });

    it('should score root path higher than catch-all wildcard', () => {
      const root = compilePath('/');
      const catchAll = compilePath('*');
      expect(root.score).toBeGreaterThan(catchAll.score);
    });

    it('should give wildcards negative score to ensure last match', () => {
      const wildcard = compilePath('*');
      expect(wildcard.score).toBeLessThan(0);
    });
  });
});

describe('matchPath', () => {
  it('should match and extract parameters', () => {
    const compiled = compilePath('/users/:id');
    const match = matchPath('/users/123', compiled);

    expect(match).not.toBeNull();
    expect(match?.params).toEqual({ id: '123' });
    expect(match?.path).toBe('/users/123');
  });

  it('should handle URL-encoded parameters', () => {
    const compiled = compilePath('/search/:query');
    const match = matchPath('/search/hello%20world', compiled);

    expect(match?.params).toEqual({ query: 'hello world' });
  });

  it('should return null for non-matching paths', () => {
    const compiled = compilePath('/users/:id');
    const match = matchPath('/posts/123', compiled);

    expect(match).toBeNull();
  });

  it('should strip query string before matching', () => {
    const compiled = compilePath('/users/:id');
    const match = matchPath('/users/123?foo=bar', compiled);

    expect(match?.params).toEqual({ id: '123' });
    expect(match?.path).toBe('/users/123');
  });

  it('should strip hash before matching', () => {
    const compiled = compilePath('/users/:id');
    const match = matchPath('/users/123#section', compiled);

    expect(match?.params).toEqual({ id: '123' });
  });

  it('should match wildcard paths', () => {
    const compiled = compilePath('/files/*path');
    const match = matchPath('/files/docs/readme.md', compiled);

    expect(match?.params).toEqual({ path: 'docs/readme.md' });
  });

  it('should normalize paths before matching', () => {
    const compiled = compilePath('/users/:id');
    const match = matchPath('users/123/', compiled);

    expect(match?.params).toEqual({ id: '123' });
  });
});

describe('compileRoutes', () => {
  it('should compile flat routes', () => {
    const routes: RouteConfig[] = [
      { path: '/' },
      { path: '/users' },
      { path: '/users/:id' },
    ];

    const compiled = compileRoutes(routes);
    expect(compiled).toHaveLength(3);
  });

  it('should compile nested routes', () => {
    const routes: RouteConfig[] = [
      {
        path: '/users',
        children: [{ path: '' }, { path: ':id' }],
      },
    ];

    const compiled = compileRoutes(routes);
    expect(compiled).toHaveLength(3);

    // Find the child routes
    const childRoutes = compiled.filter((r) => r.parent);
    expect(childRoutes).toHaveLength(2);
    expect(childRoutes.map((r) => r.fullPath).sort()).toEqual(
      ['/users', '/users/:id'].sort()
    );
  });

  it('should sort routes by specificity', () => {
    const routes: RouteConfig[] = [
      { path: '/users/*' },
      { path: '/users/:id' },
      { path: '/users/new' },
    ];

    const compiled = compileRoutes(routes);

    // Most specific first
    expect(compiled[0]!.fullPath).toBe('/users/new');
    expect(compiled[1]!.fullPath).toBe('/users/:id');
    expect(compiled[2]!.fullPath).toBe('/users/*');
  });

  it('should handle absolute paths in children', () => {
    const routes: RouteConfig[] = [
      {
        path: '/users',
        children: [
          { path: '/about' }, // Absolute path
        ],
      },
    ];

    const compiled = compileRoutes(routes);
    const paths = compiled.map((r) => r.fullPath);
    expect(paths).toContain('/about');
    expect(paths).not.toContain('/users/about');
  });
});

describe('resolvePath', () => {
  const routes: RouteConfig[] = [
    { path: '/', name: 'home' },
    { path: '/users', name: 'users', meta: { requiresAuth: true } },
    { path: '/users/:id', name: 'user-detail' },
  ];

  const compiled = compileRoutes(routes);

  it('should resolve matching route', () => {
    const resolved = resolvePath('/users', compiled);

    expect(resolved).not.toBeNull();
    expect(resolved?.path).toBe('/users');
    expect(resolved?.name).toBe('users');
    expect(resolved?.meta).toEqual({ requiresAuth: true });
  });

  it('should resolve with params', () => {
    const resolved = resolvePath('/users/123', compiled);

    expect(resolved?.params).toEqual({ id: '123' });
  });

  it('should parse query string', () => {
    const resolved = resolvePath('/users?page=1&limit=10', compiled);

    expect(resolved?.query).toEqual({ page: '1', limit: '10' });
  });

  it('should parse hash', () => {
    const resolved = resolvePath('/users#section', compiled);

    expect(resolved?.hash).toBe('section');
  });

  it('should return null for non-matching path', () => {
    const resolved = resolvePath('/unknown', compiled);

    expect(resolved).toBeNull();
  });

  it('should include fullPath', () => {
    const resolved = resolvePath('/users/123?foo=bar#section', compiled);

    expect(resolved?.fullPath).toBe('/users/123?foo=bar#section');
  });
});

describe('parseQuery', () => {
  it('keeps keys named like Object.prototype members as plain data', () => {
    const query = parseQuery(
      '__proto__=x&toString=1&constructor=a&constructor=b'
    );
    expect(Object.getPrototypeOf(query)).toBe(Object.prototype);
    expect(Object.keys(query)).toEqual([
      '__proto__',
      'toString',
      'constructor',
    ]);
    expect(Object.getOwnPropertyDescriptor(query, '__proto__')!.value).toBe(
      'x'
    );
    expect(query['toString']).toBe('1');
    expect(query['constructor']).toEqual(['a', 'b']);
    expect(({} as Record<string, unknown>)['x']).toBeUndefined();
  });

  it('should parse simple query string', () => {
    expect(parseQuery('foo=bar')).toEqual({ foo: 'bar' });
  });

  it('should parse multiple parameters', () => {
    expect(parseQuery('foo=bar&baz=qux')).toEqual({ foo: 'bar', baz: 'qux' });
  });

  it('should handle array parameters', () => {
    expect(parseQuery('ids=1&ids=2&ids=3')).toEqual({ ids: ['1', '2', '3'] });
  });

  it('should handle empty values', () => {
    expect(parseQuery('foo')).toEqual({ foo: '' });
  });

  it('should decode URL-encoded values', () => {
    expect(parseQuery('foo=hello%20world')).toEqual({ foo: 'hello world' });
  });

  it('should handle leading ?', () => {
    expect(parseQuery('?foo=bar')).toEqual({ foo: 'bar' });
  });

  it('should return empty object for empty string', () => {
    expect(parseQuery('')).toEqual({});
  });
});

describe('stringifyQuery', () => {
  it('should stringify simple query', () => {
    expect(stringifyQuery({ foo: 'bar' })).toBe('foo=bar');
  });

  it('should stringify multiple parameters', () => {
    const result = stringifyQuery({ foo: 'bar', baz: 'qux' });
    expect(result).toContain('foo=bar');
    expect(result).toContain('baz=qux');
  });

  it('should stringify array parameters', () => {
    expect(stringifyQuery({ ids: ['1', '2', '3'] })).toBe('ids=1&ids=2&ids=3');
  });

  it('should skip undefined values', () => {
    expect(stringifyQuery({ foo: 'bar', baz: undefined })).toBe('foo=bar');
  });

  it('should encode special characters', () => {
    expect(stringifyQuery({ foo: 'hello world' })).toBe('foo=hello%20world');
  });
});

describe('normalizePath', () => {
  it('should add leading slash', () => {
    expect(normalizePath('users')).toBe('/users');
  });

  it('should remove trailing slash', () => {
    expect(normalizePath('/users/')).toBe('/users');
  });

  it('should preserve root path', () => {
    expect(normalizePath('/')).toBe('/');
  });

  it('should remove duplicate slashes', () => {
    expect(normalizePath('//users//posts//')).toBe('/users/posts');
  });
});

describe('joinPaths', () => {
  it('should join paths', () => {
    expect(joinPaths('/users', 'posts')).toBe('/users/posts');
  });

  it('should handle empty segments', () => {
    expect(joinPaths('/users', '', 'posts')).toBe('/users/posts');
  });

  it('should normalize result', () => {
    expect(joinPaths('/users/', '/posts/')).toBe('/users/posts');
  });
});

describe('generatePath', () => {
  it('should generate path with parameters', () => {
    expect(generatePath('/users/:id', { id: '123' })).toBe('/users/123');
  });

  it('should generate path with multiple parameters', () => {
    expect(
      generatePath('/users/:userId/posts/:postId', { userId: '1', postId: '2' })
    ).toBe('/users/1/posts/2');
  });

  it('should remove unfilled optional parameters', () => {
    expect(generatePath('/users/:id?', {})).toBe('/users');
  });

  it('should encode parameter values', () => {
    expect(generatePath('/search/:query', { query: 'hello world' })).toBe(
      '/search/hello%20world'
    );
  });
});

describe('route matching fixes', () => {
  it('keeps a param parent in the match chain of a nested route', () => {
    const routes = compileRoutes([
      {
        path: '/users/:id',
        children: [{ path: 'edit' }],
      },
    ]);
    const resolved = resolvePath('/users/5/edit', routes)!;
    expect(resolved.matched.map((m) => m.route.fullPath)).toEqual([
      '/users/:id',
      '/users/:id/edit',
    ]);
    expect(resolved.params).toEqual({ id: '5' });
  });

  it('does not take /application as a child of /app', () => {
    const routes = compileRoutes([
      { path: '/app', children: [{ path: 'x' }] },
      { path: '/application' },
    ]);
    expect(resolvePath('/application', routes)!.matched).toHaveLength(1);
  });

  it('decodes + as a space in queries', () => {
    expect(parseQuery('q=hello+world&tag=a%2Bb')).toEqual({
      q: 'hello world',
      tag: 'a+b',
    });
  });

  it('matches /files/* against /files', () => {
    const routes = compileRoutes([{ path: '/files/*' }]);
    expect(resolvePath('/files', routes)).not.toBeNull();
    expect(resolvePath('/files/a/b', routes)!.params['*']).toBe('a/b');
  });
});

describe('route aliases', () => {
  it('compiles one entry per path and marks the aliases', () => {
    const compiled = compileRoutes([
      { path: '/users', alias: ['/people', '/team'] },
    ]);
    expect(compiled.map((r) => r.fullPath).sort()).toEqual([
      '/people',
      '/team',
      '/users',
    ]);
    expect(
      compiled
        .filter((r) => r.isAlias)
        .map((r) => r.fullPath)
        .sort()
    ).toEqual(['/people', '/team']);
  });

  it('takes a single string', () => {
    const compiled = compileRoutes([{ path: '/users', alias: '/people' }]);
    expect(compiled).toHaveLength(2);
  });

  it('resolves an alias to the same config and keeps the typed path', () => {
    const config: RouteConfig = {
      path: '/users/:id',
      alias: '/people/:id',
      name: 'user',
    };
    const resolved = resolvePath('/people/7', compileRoutes([config]));
    expect(resolved!.matched[0]!.route.config).toBe(config);
    expect(resolved!.params).toEqual({ id: '7' });
    expect(resolved!.fullPath).toBe('/people/7');
    expect(resolved!.name).toBe('user');
  });

  it('reads a relative alias against the parent', () => {
    const compiled = compileRoutes([
      { path: '/shop', children: [{ path: 'items', alias: 'products' }] },
    ]);
    expect(compiled.map((r) => r.fullPath)).toContain('/shop/products');
  });

  it('reads an absolute alias on a child as is', () => {
    const compiled = compileRoutes([
      { path: '/shop', children: [{ path: 'items', alias: '/catalog' }] },
    ]);
    expect(compiled.map((r) => r.fullPath)).toContain('/catalog');
  });

  it('compiles the children under every path of the parent', () => {
    const compiled = compileRoutes([
      {
        path: '/shop',
        alias: '/store',
        children: [{ path: ':id' }],
      },
    ]);
    const paths = compiled.map((r) => r.fullPath);
    expect(paths).toContain('/shop/:id');
    expect(paths).toContain('/store/:id');
    const underAlias = compiled.find((r) => r.fullPath === '/store/:id')!;
    expect(underAlias.isAlias).toBe(true);
    expect(underAlias.parent!.fullPath).toBe('/store');
  });

  it('builds the nested match chain for an alias parent', () => {
    const compiled = compileRoutes([
      { path: '/shop', alias: '/store', children: [{ path: ':id' }] },
    ]);
    const resolved = resolvePath('/store/42', compiled);
    expect(resolved!.matched).toHaveLength(2);
    expect(resolved!.params).toEqual({ id: '42' });
  });

  it('leaves routes without an alias alone', () => {
    const compiled = compileRoutes([{ path: '/a' }]);
    expect(compiled).toHaveLength(1);
    expect(compiled[0]!.isAlias).toBeUndefined();
  });
});

describe('generatePath with wildcards', () => {
  it('fills a named wildcard, keeping the slashes and encoding each segment', () => {
    expect(generatePath('/files/*path', { path: 'a b/c/d.txt' })).toBe(
      '/files/a%20b/c/d.txt'
    );
  });

  it('fills a bare wildcard from the * param', () => {
    expect(generatePath('/files/*', { '*': 'x/y' })).toBe('/files/x/y');
  });

  it('drops a wildcard without a value', () => {
    expect(generatePath('/files/*path', {})).toBe('/files');
    expect(generatePath('/files/*path', { path: '' })).toBe('/files');
    expect(generatePath('/files/*path', { path: undefined })).toBe('/files');
  });

  it('fills params and a wildcard together', () => {
    expect(generatePath('/u/:id/files/*path', { id: '7', path: 'a/b' })).toBe(
      '/u/7/files/a/b'
    );
  });

  it('keeps a slash at the start of the value from doubling', () => {
    expect(generatePath('/files/*path', { path: '/a/b' })).toBe('/files/a/b');
  });

  it('encodes characters that would end the path', () => {
    expect(generatePath('/files/*path', { path: 'a?b#c/d' })).toBe(
      '/files/a%3Fb%23c/d'
    );
  });

  it('is read back by resolvePath', () => {
    const compiled = compileRoutes([{ path: '/files/*path' }]);
    const path = generatePath('/files/*path', { path: 'a b/c' });
    expect(resolvePath(path, compiled)!.params).toEqual({ path: 'a b/c' });
  });
});

describe('generatePath with optional params', () => {
  it('skips a param that is undefined', () => {
    expect(generatePath('/files/:name?', { name: undefined })).toBe('/files');
    expect(generatePath('/users/:id/:tab?', { id: '1', tab: undefined })).toBe(
      '/users/1'
    );
  });
});

describe('paths with encoded characters', () => {
  const routes = compileRoutes([
    { path: '/café', component: (() => null) as never },
    { path: '/files/:name', component: (() => null) as never },
  ]);

  it('match a static segment written raw or encoded', () => {
    expect(resolvePath('/café', routes)?.path).toBe('/café');
    expect(resolvePath('/caf%C3%A9', routes)?.path).toBe('/café');
    expect(resolvePath('/caf%c3%a9', routes)?.path).toBe('/café');
  });

  it('decode a param once, whichever form it came in', () => {
    expect(resolvePath('/files/a b', routes)?.params).toEqual({ name: 'a b' });
    expect(resolvePath('/files/a%20b', routes)?.params).toEqual({
      name: 'a b',
    });
    expect(resolvePath('/files/a%2Fb', routes)?.params).toEqual({
      name: 'a/b',
    });
    expect(resolvePath('/files/100%2541', routes)?.params).toEqual({
      name: '100%41',
    });
  });

  it('keep %, /, ? and # encoded', () => {
    expect(normalizeEncoding('/a%2Fb%3F%23%25%20%C3%A9')).toBe(
      '/a%2Fb%3F%23%25 é'
    );
    expect(normalizeEncoding('/bad%E9%ZZ')).toBe('/bad%E9%ZZ');
  });
});
