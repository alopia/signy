/**
 * Component lookup for dependency injection
 *
 * Finds the component that is currently rendering or setting up, by walking up
 * the reactive owner chain. There is one ownership tree: components, render
 * roots, effects and control flow branches all live in it.
 *
 * Inspired by Solid.js's owner chain pattern.
 *
 * @module context/owner
 */

import type { Component } from '../component/component';
import { getOwner, type Owner } from '../reactivity/effect';

/**
 * Brand set on every component, so the owner chain can be searched without
 * importing the Component class here.
 *
 * @internal
 */
export const IS_COMPONENT: unique symbol = Symbol('signy.component');

/**
 * Methods through which createContext() reaches the protected provide() and
 * inject() of a component.
 *
 * @internal
 */
export const CONTEXT_PROVIDE: unique symbol = Symbol('signy.contextProvide');

/** @internal */
export const CONTEXT_INJECT: unique symbol = Symbol('signy.contextInject');

/**
 * A component as createContext() sees it.
 *
 * @internal
 */
export interface ContextHost {
  [CONTEXT_PROVIDE](key: symbol, value: unknown): void;
  [CONTEXT_INJECT](key: symbol): unknown;
}

/**
 * Gets the nearest component in the current owner chain.
 *
 * @returns The component being rendered or set up, or null
 */
export function getCurrentComponent(): Component | null {
  let owner: Owner | null = getOwner();
  while (owner) {
    if ((owner as { [IS_COMPONENT]?: true })[IS_COMPONENT]) {
      return owner as unknown as Component;
    }
    owner = owner.owner;
  }
  return null;
}
