/**
 * JSX Runtime Module
 *
 * Provides the runtime functions required by babel-plugin-jsx-dom-expressions
 * to transform JSX into optimized DOM operations.
 *
 * This module bridges signy's reactivity system with the dom-expressions
 * compilation output, enabling Solid-style JSX compilation for signy.
 *
 * @module jsx
 *
 * ## Usage
 *
 * Configure babel-plugin-jsx-dom-expressions to use this module:
 *
 * ```javascript
 * // babel.config.js
 * module.exports = {
 *   plugins: [
 *     ['babel-plugin-jsx-dom-expressions', {
 *       moduleName: 'signy/jsx',
 *       effectWrapper: 'createRenderEffect',
 *       generate: 'dom',
 *       delegateEvents: true,
 *       wrapConditionals: true,
 *     }]
 *   ]
 * };
 * ```
 *
 * @example
 * ```tsx
 * // With JSX compilation enabled
 * import { Signal } from 'signy';
 *
 * function Counter() {
 *   const count = new Signal(0);
 *   return (
 *     <div>
 *       <span>Count: {count.value}</span>
 *       <button onClick={() => count.set(c => c + 1)}>+</button>
 *     </div>
 *   );
 * }
 * ```
 *
 * ## Known limitations
 *
 * **Detached elements**: Delegated events are attached to `document`, so an
 * event on an element outside the document never reaches its handler. Use
 * `on:event` for those.
 */

// Re-export all runtime functions
export * from './runtime';
export * from './template';
export * from './events';
export * from './components';

// Re-export JSX namespace for type annotations
export type { JSX } from './jsx-runtime';

// Re-export types
export type { Accessor, JSXElement, JSXComponent, JSXChild } from './types';
