/**
 * Route Matching Engine
 *
 * Provides path-to-regex style route matching with support for:
 * - Static paths: /users
 * - Dynamic parameters: /users/:id
 * - Optional parameters: /users/:id?
 * - Wildcard/catch-all: /files/*
 * - Named wildcards: /files/*path
 *
 * @module router/route
 *
 * @example
 * ```typescript
 * import { compilePath, matchPath, parseQuery, stringifyQuery } from 'signy/router';
 *
 * // Compile a route pattern
 * const compiled = compilePath('/users/:id');
 *
 * // Match against a path
 * const match = matchPath('/users/123', compiled);
 * // { params: { id: '123' }, path: '/users/123' }
 *
 * // Parse query string
 * const query = parseQuery('foo=bar&baz=qux');
 * // { foo: 'bar', baz: 'qux' }
 * ```
 *
 * ## Known limitations
 *
 * **No regex patterns in paths**: Unlike path-to-regexp, we don't support
 * custom regex patterns like `/users/:id(\\d+)`. This keeps the implementation
 * simple and type-safe.
 */

import type {
  NavigationTarget,
  RouteConfig,
  CompiledRoute,
  MatchedRoute,
  ResolvedRoute,
  RouteParams,
  QueryParams,
  RouteMeta,
  PathParams,
  TypedRouteConfig,
} from './types';

const hasOwn = Object.prototype.hasOwnProperty;

//=============================================
// Path Compilation
//=============================================

/** Characters a path must keep encoded: they split it or start an escape */
const KEEP_ENCODED = /[%/?#]/g;

/**
 * A path with one spelling: escapes are decoded, except those of `%`, `/`,
 * `?` and `#`, which the path needs encoded. `/caf%C3%A9` and `/café` give
 * the same path, and a param is still decoded once.
 *
 * @internal
 */
export function normalizeEncoding(path: string): string {
  if (!path.includes('%')) return path;
  return path.replace(/(?:%[0-9a-f]{2})+/gi, (escapes) => {
    try {
      return decodeURIComponent(escapes).replace(
        KEEP_ENCODED,
        encodeURIComponent
      );
    } catch {
      // Not UTF-8, so left as it is
      return escapes;
    }
  });
}

/**
 * Decodes a URI component, keeping the raw text when it is malformed
 * (e.g. `100%`) instead of throwing.
 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Compiled path pattern
 */
export interface CompiledPath {
  /** Parameter names extracted from path */
  paramNames: string[];
  /** Regex for matching */
  regex: RegExp;
  /** Regex matching the start of a path, up to a segment boundary */
  prefixRegex: RegExp;
  /** Score for sorting (higher = more specific) */
  score: number;
  /** Original path pattern */
  pattern: string;
}

/**
 * Segment types for scoring.
 *
 * Higher scores = more specific routes = matched first.
 * Routes are sorted by score descending (most specific first).
 *
 * Wildcards use a negative score to ensure catch-all routes
 * are always matched last, regardless of route order in config.
 */
const SegmentScore = {
  /** Static segment: /users - most specific */
  STATIC: 4,
  /** Dynamic parameter: /:id */
  PARAM: 3,
  /** Optional parameter: /:id? */
  OPTIONAL: 2,
  /** Wildcard: /* - least specific, always matched last */
  WILDCARD: -1000,
} as const;

/**
 * Compiles a path pattern into a regex and extracts parameter names.
 *
 * Path patterns support:
 * - Static segments: `/users`
 * - Parameters: `/:id`
 * - Optional parameters: `/:id?`
 * - Wildcards: `/*` or `/*path`
 *
 * @param pattern - Route path pattern
 * @returns Compiled path with regex and metadata
 *
 * @example
 * ```typescript
 * const compiled = compilePath('/users/:id/posts/:postId?');
 * // compiled.paramNames = ['id', 'postId']
 * // compiled.regex matches '/users/123/posts' and '/users/123/posts/456'
 * ```
 */
export function compilePath(pattern: string): CompiledPath {
  const paramNames: string[] = [];
  let score = 0;
  let regexStr = '^';

  // Normalize pattern
  pattern = normalizeEncoding(pattern);
  if (!pattern.startsWith('/')) pattern = '/' + pattern;
  if (pattern !== '/' && pattern.endsWith('/')) pattern = pattern.slice(0, -1);

  // Split into segments
  const segments = pattern.split('/').filter(Boolean);

  for (const segment of segments) {
    if (segment.startsWith('*')) {
      // Wildcard - matches anything
      const name = segment.slice(1) || '*';
      paramNames.push(name);
      // Optional, so /files/* also matches /files
      regexStr += '(?:/(.*))?';
      score += SegmentScore.WILDCARD;
    } else if (segment.startsWith(':')) {
      // Parameter
      const isOptional = segment.endsWith('?');
      const name = isOptional ? segment.slice(1, -1) : segment.slice(1);
      paramNames.push(name);

      if (isOptional) {
        // Make the entire segment (including slash) optional
        regexStr += '(?:/([^/]+))?';
        score += SegmentScore.OPTIONAL;
      } else {
        regexStr += '/([^/]+)';
        score += SegmentScore.PARAM;
      }
    } else {
      // Static segment - escape special regex chars
      regexStr += '/' + escapeRegex(segment);
      score += SegmentScore.STATIC;
    }
  }

  return {
    paramNames,
    // End of pattern - optionally match trailing slash
    regex: new RegExp(regexStr + '/?$', 'i'),
    prefixRegex: new RegExp(regexStr + '(?=/|$)', 'i'),
    score,
    pattern,
  };
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

//=============================================
// Path Matching
//=============================================

/**
 * The path as the route regexes see it: a leading slash, no query, hash or
 * trailing slash.
 */
function normalizeMatchPath(path: string): string {
  if (!path.startsWith('/')) path = '/' + path;
  const queryIndex = path.indexOf('?');
  if (queryIndex >= 0) path = path.slice(0, queryIndex);
  const hashIndex = path.indexOf('#');
  if (hashIndex >= 0) path = path.slice(0, hashIndex);
  if (path !== '/' && path.endsWith('/')) path = path.slice(0, -1);
  return path;
}

/**
 * Match result from matchPath
 */
export interface PathMatch {
  /** Extracted parameters */
  params: RouteParams;
  /** Matched path (without query/hash) */
  path: string;
  /** Whether this is an exact match */
  exact: boolean;
}

/**
 * Matches a path against a compiled pattern.
 *
 * @param path - URL path to match
 * @param compiled - Compiled path pattern
 * @returns Match result or null if no match
 *
 * @example
 * ```typescript
 * const compiled = compilePath('/users/:id');
 * const match = matchPath('/users/123', compiled);
 * // { params: { id: '123' }, path: '/users/123', exact: true }
 * ```
 */
export function matchPath(
  path: string,
  compiled: CompiledPath
): PathMatch | null {
  path = normalizeMatchPath(path);

  // Test against regex
  const match = compiled.regex.exec(path);
  if (!match) return null;

  return {
    params: extractParams(match, compiled.paramNames),
    path,
    exact: match[0] === path,
  };
}

/**
 * Match a path as a prefix against a compiled route.
 * Used for matching parent routes in nested route scenarios.
 *
 * @param path - Full URL path to match
 * @param route - Compiled route to check as prefix
 * @returns Match result or null if not a prefix match
 */
function matchPathPrefix(path: string, route: CompiledRoute): PathMatch | null {
  const match = route.prefixRegex.exec(path);
  if (!match) return null;
  return {
    params: extractParams(match, route.paramNames),
    path: match[0],
    exact: false,
  };
}

function extractParams(
  match: RegExpExecArray,
  paramNames: string[]
): RouteParams {
  const params: RouteParams = {};
  for (let i = 0; i < paramNames.length; i++) {
    const value = match[i + 1];
    const paramName = paramNames[i];
    if (value !== undefined && paramName !== undefined) {
      params[paramName] = safeDecode(value);
    }
  }
  return params;
}

//=============================================
// Route Compilation
//=============================================

/**
 * Defines a route with its path as a literal, so the loader gets typed
 * params: `:id` is `string`, `:id?` and a wildcard are optional. At runtime it
 * returns the config as it is.
 *
 * @example
 * ```typescript
 * const user = defineRoute({
 *   path: '/users/:id',
 *   component: UserPage,
 *   loader: ({ params }) => fetchUser(params.id), // id: string
 * });
 * ```
 */
export function defineRoute<Path extends string, Data = unknown>(
  config: TypedRouteConfig<Path, Data>
): RouteConfig {
  return config as unknown as RouteConfig;
}

const NO_ALIASES: readonly string[] = [];

/** The absolute path of a route path, absolute or relative to its parent */
function fullRoutePath(parentPath: string, path: string | undefined): string {
  let fullPath = parentPath;
  if (path) {
    fullPath = path.startsWith('/')
      ? path
      : parentPath + (parentPath.endsWith('/') ? '' : '/') + path;
  }
  if (fullPath !== '/' && fullPath.endsWith('/')) {
    fullPath = fullPath.slice(0, -1);
  }
  return fullPath || '/';
}

/**
 * Compiles a route configuration tree into flat compiled routes.
 *
 * @param routes - Route configuration array
 * @param parentPath - Parent path for nested routes
 * @param parent - Parent compiled route
 * @returns Array of compiled routes
 */
export function compileRoutes(
  routes: RouteConfig[],
  parentPath: string = '',
  parent?: CompiledRoute
): CompiledRoute[] {
  const compiled: CompiledRoute[] = [];

  for (const route of routes) {
    // The main path first (index -1), then each alias. Children compile under
    // each one.
    const aliases =
      route.alias === undefined ? NO_ALIASES : [route.alias].flat();

    for (let index = -1; index < aliases.length; index++) {
      const fullPath = fullRoutePath(
        parentPath,
        index === -1 ? route.path : aliases[index]
      );

      // Compile the path
      const compiledPath = compilePath(fullPath);

      const compiledRoute: CompiledRoute = {
        config: route,
        paramNames: compiledPath.paramNames,
        regex: compiledPath.regex,
        prefixRegex: compiledPath.prefixRegex,
        score: compiledPath.score,
        parent,
        fullPath,
      };
      if (index !== -1 || parent?.isAlias) compiledRoute.isAlias = true;

      compiled.push(compiledRoute);

      // Recursively compile children
      if (route.children?.length) {
        const childRoutes = compileRoutes(
          route.children,
          fullPath,
          compiledRoute
        );
        compiled.push(...childRoutes);
      }
    }
  }

  // Sort by score (most specific first)
  // When scores are equal, prioritize child routes (with parent) over parent routes
  // This ensures index routes (path: '') match before their parent layouts
  return compiled.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    // Calculate depth (number of ancestors)
    const depthA = getRouteDepth(a);
    const depthB = getRouteDepth(b);
    // Deeper routes (children) come first
    return depthB - depthA;
  });
}

/**
 * Calculate the depth of a route in the hierarchy.
 * Root routes have depth 0, children have depth 1, grandchildren 2, etc.
 */
function getRouteDepth(route: CompiledRoute): number {
  let depth = 0;
  let current = route.parent;
  while (current) {
    depth++;
    current = current.parent;
  }
  return depth;
}

//=============================================
// Route Resolution
//=============================================

/**
 * Resolves a path to a fully resolved route.
 *
 * @param path - URL path (can include query and hash)
 * @param compiledRoutes - Array of compiled routes
 * @returns Resolved route or null if no match
 */
export function resolvePath(
  path: string,
  compiledRoutes: CompiledRoute[]
): ResolvedRoute | null {
  // Parse path parts
  let pathname = path;
  let search = '';
  let hash = '';

  const hashIndex = pathname.indexOf('#');
  if (hashIndex >= 0) {
    hash = pathname.slice(hashIndex + 1);
    pathname = pathname.slice(0, hashIndex);
  }

  const queryIndex = pathname.indexOf('?');
  if (queryIndex >= 0) {
    search = pathname.slice(queryIndex + 1);
    pathname = pathname.slice(0, queryIndex);
  }

  // Find matching route
  const matched: MatchedRoute[] = [];
  let combinedParams: RouteParams = {};
  let combinedMeta: RouteMeta = {};
  let matchedRoute: CompiledRoute | null = null;

  // One spelling, so /caf%C3%A9 matches /café and compares equal to it
  pathname = normalizeEncoding(pathname);
  path =
    pathname +
    (queryIndex >= 0 ? `?${search}` : '') +
    (hashIndex >= 0 ? `#${hash}` : '');
  const normalized = normalizeMatchPath(pathname);
  for (const route of compiledRoutes) {
    const match = route.regex.exec(normalized);

    if (match) {
      matchedRoute = route;

      // Build match chain (for nested routes)
      let current: CompiledRoute | undefined = route;
      const matchChain: CompiledRoute[] = [];

      while (current) {
        matchChain.unshift(current);
        current = current.parent;
      }

      // Build matched array
      for (const r of matchChain) {
        // For parent routes, use prefix matching (pathname starts with parent path)
        // For the final route, use exact matching
        const isLeafRoute = r === route;

        if (isLeafRoute) {
          const params = extractParams(match, r.paramNames);
          matched.push({ route: r, params });

          // Combine params and meta
          combinedParams = { ...combinedParams, ...params };
          if (r.config.meta) {
            combinedMeta = { ...combinedMeta, ...r.config.meta };
          }
        } else {
          // A parent matches the start of the path, up to a segment boundary
          const parentMatch = matchPathPrefix(normalized, r);

          if (parentMatch) {
            matched.push({
              route: r,
              params: parentMatch.params,
            });

            // Combine params and meta
            combinedParams = { ...combinedParams, ...parentMatch.params };
            if (r.config.meta) {
              combinedMeta = { ...combinedMeta, ...r.config.meta };
            }
          }
        }
      }

      break;
    }
  }

  if (!matchedRoute) return null;

  return {
    path: pathname,
    matched,
    params: combinedParams,
    query: parseQuery(search),
    hash,
    fullPath: path,
    name: matchedRoute.config.name,
    meta: combinedMeta,
  };
}

//=============================================
// Query String Utilities
//=============================================

/**
 * Parses a query string into an object.
 *
 * Handles:
 * - Simple values: `foo=bar` -> `{ foo: 'bar' }`
 * - Arrays: `foo=1&foo=2` -> `{ foo: ['1', '2'] }`
 * - Empty values: `foo` -> `{ foo: '' }`
 * - URL encoding: `foo=%20bar` and `foo=+bar` -> `{ foo: ' bar' }`
 *
 * @param search - Query string (with or without leading ?)
 * @returns Parsed query parameters
 *
 * @example
 * ```typescript
 * parseQuery('foo=bar&baz=qux');
 * // { foo: 'bar', baz: 'qux' }
 *
 * parseQuery('ids=1&ids=2&ids=3');
 * // { ids: ['1', '2', '3'] }
 * ```
 */
export function parseQuery(search: string): QueryParams {
  if (!search) return {};
  if (search.startsWith('?')) search = search.slice(1);

  const params: QueryParams = {};

  for (const part of search.split('&')) {
    if (!part) continue;

    // Split on the first "=" only, values may contain more
    const eq = part.indexOf('=');
    const rawKey = eq === -1 ? part : part.slice(0, eq);
    const rawValue = eq === -1 ? '' : part.slice(eq + 1);

    const key = decodeQueryPart(rawKey);
    const value = decodeQueryPart(rawValue);

    // Own keys only, so ?toString= stays plain data. An assignment to
    // __proto__ would set the prototype, so that one key is defined
    if (!hasOwn.call(params, key)) {
      if (key === '__proto__') {
        Object.defineProperty(params, key, {
          value,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      } else {
        params[key] = value;
      }
      continue;
    }
    // Own and set above, so a string or an array
    const existing = params[key] as string | string[];
    if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      params[key] = [existing, value];
    }
  }

  return params;
}

/** Form encoding writes a space as `+`, so it is decoded before the escapes */
function decodeQueryPart(value: string): string {
  if (value.includes('+')) value = value.replace(/\+/g, ' ');
  return value.includes('%') ? safeDecode(value) : value;
}

/**
 * Stringifies a query object into a query string.
 *
 * @param query - Query parameters object
 * @returns Query string (without leading ?)
 *
 * @example
 * ```typescript
 * stringifyQuery({ foo: 'bar', baz: 'qux' });
 * // 'foo=bar&baz=qux'
 *
 * stringifyQuery({ ids: ['1', '2', '3'] });
 * // 'ids=1&ids=2&ids=3'
 * ```
 */
export function stringifyQuery(query: QueryParams): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;

    const encodedKey = encodeURIComponent(key);

    if (Array.isArray(value)) {
      for (const v of value) {
        parts.push(`${encodedKey}=${encodeURIComponent(v)}`);
      }
    } else {
      parts.push(`${encodedKey}=${encodeURIComponent(value)}`);
    }
  }

  return parts.join('&');
}

//=============================================
// Path Utilities
//=============================================

/**
 * Normalizes a path (removes duplicate slashes, trailing slash).
 *
 * @param path - Path to normalize
 * @returns Normalized path
 */
export function normalizePath(path: string): string {
  // Ensure leading slash
  if (!path.startsWith('/')) path = '/' + path;

  // Remove duplicate slashes
  path = path.replace(/\/+/g, '/');

  // Remove trailing slash (except for root)
  if (path !== '/' && path.endsWith('/')) {
    path = path.slice(0, -1);
  }

  return path;
}

/**
 * Joins path segments.
 *
 * @param paths - Path segments to join
 * @returns Joined path
 */
export function joinPaths(...paths: string[]): string {
  return normalizePath(paths.filter(Boolean).join('/'));
}

/**
 * Generates a path from a pattern and params.
 *
 * @param pattern - Route path pattern
 * @param params - Parameters to substitute
 * @returns Generated path
 *
 * @example
 * ```typescript
 * generatePath('/users/:id/posts/:postId', { id: '123', postId: '456' });
 * // '/users/123/posts/456'
 * ```
 */
export function generatePath<Path extends string>(
  pattern: Path,
  params: PathParams<Path> = {} as PathParams<Path>
): string {
  let path: string = pattern;

  // A wildcard takes the rest of the path: each segment is encoded and the
  // slashes stay. Without a value it is dropped, like an optional param.
  path = path.replace(/\/\*([^/]*)/g, (_, name: string) => {
    const value = (params as Record<string, string | undefined>)[name || '*'];
    return value
      ? '/' + value.split('/').map(encodeURIComponent).join('/')
      : '';
  });

  // Replace parameters
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    // The lookahead stops :id from matching the start of :idx
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    path = path.replace(
      new RegExp(`:${escaped}\\??(?![\\w])`, 'g'),
      encodeURIComponent(value)
    );
  }

  // Remove unfilled optional parameters
  path = path.replace(/\/:[^/]+\?/g, '');

  return normalizePath(path);
}

/**
 * Builds the path of a navigation target from its path, query and hash.
 * Named targets need the router, see Router.toPath().
 *
 * @param to - Path string or navigation target
 * @returns The path, with query and hash
 */
export function targetToPath(to: string | NavigationTarget): string {
  if (typeof to === 'string') return to;
  let path = to.path || '/';
  if (to.query && Object.keys(to.query).length > 0) {
    path += '?' + stringifyQuery(to.query);
  }
  if (to.hash) path += '#' + to.hash;
  return path;
}

/**
 * Whether an href leaves the app: a scheme (`https:`, `mailto:`, `tel:`) or a
 * protocol relative `//host` URL.
 */
export function isExternalHref(href: string): boolean {
  return /^([a-z][a-z\d+.-]*:|\/\/)/i.test(href);
}
