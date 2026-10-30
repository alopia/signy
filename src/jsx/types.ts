/**
 * JSX Type Definitions
 *
 * @module jsx/types
 */

import type { Component } from '../component/component';

/**
 * JSX element result type
 */
export type JSXElement = Element | DocumentFragment | Text | Comment | Node;

/**
 * JSX component type - can be a class component or function component
 */
export type JSXComponent<P = Record<string, unknown>> =
  (new (props: P) => Component) | ((props: P) => JSXElement);

/**
 * Valid JSX child types
 */
export type JSXChild =
  JSXElement | string | number | boolean | null | undefined | JSXChild[];

/**
 * Props with children
 */
export type PropsWithChildren<P = Record<string, unknown>> = P & {
  children?: JSXChild | (() => JSXChild);
};

/**
 * Accessor function type
 */
export type Accessor<T> = () => T;

/**
 * Effect wrapper function signature expected by dom-expressions
 */
export type EffectFunction = <T>(fn: () => T) => void;

/**
 * Memo wrapper function signature expected by dom-expressions
 */
export type MemoFunction = <T>(fn: () => T) => () => T;
