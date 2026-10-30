/**
 * signy - A modern TypeScript UI library
 *
 * This is the main entry point that exports everything from signy.
 * For smaller bundles, use the subexports:
 *
 * - `signy/core` - Reactivity primitives, no DOM
 * - `signy/web` - Core + DOM + Views + Components
 * - `signy/router` - Router addon
 * - `signy/store` - Deep reactive store
 * - `signy/app` - Application framework
 * - `signy/jsx` - Runtime for compiled JSX
 *
 * For development tools (profiler, inspector, event logger), use the
 * separate `signy-dev` package which auto-enables human-readable error
 * messages when imported.
 *
 * @module signy
 *
 * @example Using the full bundle
 * ```typescript
 * import {
 *   application,
 *   Signal,
 *   Component,
 *   Router,
 *   html
 * } from 'signy';
 * ```
 *
 * @example Using subexports for smaller bundles
 * ```typescript
 * // Just reactivity
 * import { Signal, effect } from 'signy/core';
 *
 * // DOM + Components
 * import { html, For, Component } from 'signy/web';
 *
 * // Router
 * import { router, Link } from 'signy/router';
 * ```
 *
 * @example Using development tools
 * ```typescript
 * import { application } from 'signy';
 * import { enableDevTools } from 'signy-dev';
 *
 * if (import.meta.env.DEV) {
 *   enableDevTools();
 * }
 * ```
 */

//=============================================
// Core - Reactivity Primitives
//=============================================

export * from './core';

//=============================================
// Web - DOM + Views + Components
// (re-exports core, so no duplication)
//=============================================

// DOM (DOM utilities, refs, event listeners)
export * from './dom';

// Views
export * from './views';

// Components
export * from './component';

// Context (DI and owner tracking)
export * from './context';

//=============================================
// Additional Reactivity (store, transitions, etc.)
//=============================================

// Full reactivity module (includes store, transitions, resources)
export * from './reactivity';

//=============================================
// Application Framework
//=============================================

export * from './app';

//=============================================
// Router
//=============================================

export * from './router';

//=============================================
// JSX Types
//=============================================

export type { JSX } from './jsx';

//=============================================
// Utilities
//=============================================

// Logging
export * from './log';

// Utils (config, ID generation)
export * from './utils';

// Types
export type * from './types';

// Constants
export * from './constants';

// Version
export { VERSION } from './constants';
