/**
 * Link Component
 *
 * A navigation component that renders an anchor element with client-side
 * navigation behavior. Prevents full page reload and uses the router
 * for navigation.
 *
 * @module router/components/link
 *
 * @example
 * ```typescript
 * import { Component, html, Link } from 'signy';
 *
 * class Navigation extends Component {
 *   protected render() {
 *     return html`
 *       <nav>
 *         <${Link} to="/">Home</${Link}>
 *         <${Link} to="/about" class="nav-link">About</${Link}>
 *         <${Link} to="/users/123" activeClass="active">User 123</${Link}>
 *       </nav>
 *     `;
 *   }
 * }
 * ```
 *
 * ## Known limitations
 *
 * None.
 */

import { Component } from '../../component/component';
import type { Router } from '../router';
import type { NavigationTarget } from '../types';
import { ROUTER_KEY } from '../types';
import { isExternalHref, normalizeEncoding, targetToPath } from '../route';
import { setAttribute } from '../../views/attributes';
import { insert } from '../../views/insert';
import { createRenderEffect } from '../../reactivity/render';
import { Computed } from '../../reactivity/signal';
import { onCleanup } from '../../reactivity/effect';
import { untrack } from '../../reactivity/signal/subtle';
import { mergeProps } from '../../component/props';

//=============================================
// Types
//=============================================

/** A value, or a function that returns it, to follow a change in html */
export type MaybeAccessor<T> = T | (() => T);

/**
 * Props for the Link component
 */
export interface LinkProps {
  /** Target path or navigation target, or a function returning one */
  to: MaybeAccessor<string | NavigationTarget>;

  /** Whether to replace instead of push */
  replace?: boolean;

  /** CSS class for active state */
  activeClass?: string;

  /** CSS class for exact active state */
  exactActiveClass?: string;

  /**
   * aria-current value set on the exact active link, so assistive
   * technology and CSS can tell the current page (default: 'page')
   */
  ariaCurrentValue?: 'page' | 'step' | 'location' | 'date' | 'time' | 'true';

  /** Additional CSS classes */
  class?: MaybeAccessor<string | undefined>;

  /** Custom active check function */
  isActive?: (currentPath: string, to: string) => boolean;

  /** Target attribute (e.g., '_blank') */
  target?: string;

  /** Rel attribute */
  rel?: string;

  /** Whether link is disabled */
  disabled?: MaybeAccessor<boolean | undefined>;

  /**
   * Get the target route ready when the pointer or focus reaches the link:
   * its lazy components load and its loader starts, see `router.prefetch()`.
   */
  prefetch?: boolean;

  /** Click handler (in addition to navigation) */
  onClick?: (event: MouseEvent) => void;

  /** Children content */
  children?: Node | Node[] | string | number;

  /** Additional attributes to pass to anchor */
  [key: string]: unknown;
}

//=============================================
// Link Component
//=============================================

/**
 * Navigation link component with client-side routing.
 *
 * Renders an `<a>` element that uses the router for navigation instead
 * of triggering a full page reload. Supports active state styling.
 *
 * @example
 * ```typescript
 * // Basic usage
 * html`<${Link} to="/about">About</${Link}>`
 *
 * // With active class
 * html`<${Link} to="/users" activeClass="is-active">Users</${Link}>`
 *
 * // With navigation target
 * html`<${Link} to=${{ path: '/users', query: { page: '2' } }}>
 *   Page 2
 * </${Link}>`
 *
 * // Loads the target's components and data when the pointer or focus arrives
 * html`<${Link} to="/reports" prefetch>Reports</${Link}>`
 *
 * // External link (opens in new tab)
 * html`<${Link} to="https://example.com" target="_blank">
 *   External Site
 * </${Link}>`
 * ```
 */
export class Link extends Component {
  //=============================================
  // Private Fields
  //=============================================

  /** Link props */
  private _props: LinkProps;

  //=============================================
  // Constructor
  //=============================================

  constructor(props: LinkProps) {
    super();
    this._props = props;
  }

  //=============================================
  // Lifecycle
  //=============================================

  protected render(): Element | DocumentFragment | void {
    // Read where they are used, so a JSX getter or an html accessor is live
    const props = this._props;
    const anchor = document.createElement('a');
    const router = this.inject<Router>(ROUTER_KEY) ?? null;

    const resolve = (): {
      to: string | NavigationTarget;
      external: boolean;
      path: string;
    } => {
      const to = read(props.to);
      // A string with a scheme (https:, mailto:, tel:) or // leaves the app
      const external = typeof to === 'string' && isExternalHref(to);
      const path = external
        ? to
        : router
          ? router.toPath(to)
          : targetToPath(to);
      return { to, external, path };
    };
    // A plain value never changes, so the links of a menu skip the effects
    const isLive = (key: string): boolean =>
      typeof props[key] === 'function' ||
      !!Object.getOwnPropertyDescriptor(props, key)?.get;
    const follow = (key: string, apply: () => void): void => {
      if (isLive(key)) createRenderEffect(apply);
      else apply();
    };
    const liveTo = isLive('to');
    let target: {
      readonly value: ReturnType<typeof resolve>;
      peek(): ReturnType<typeof resolve>;
    };
    if (liveTo) {
      const computed = new Computed(resolve);
      onCleanup(() => computed.dispose());
      target = computed;
    } else {
      const fixed = resolve();
      target = { value: fixed, peek: () => fixed };
    }
    const disabled = (): boolean => !!read(props.disabled);

    follow('to', () => {
      const { external, path } = target.value;
      // Through the binding check, so a javascript: URL is never set
      setAttribute(
        anchor,
        'href',
        external || !router ? path : router.createHref(path)
      );
    });
    follow('target', () => setAttribute(anchor, 'target', props.target));
    follow('rel', () => setAttribute(anchor, 'rel', props.rel));

    // Only the classes it added, so the active classes stay
    let classes: string[] = [];
    follow('class', () => {
      const next = (read(props.class) ?? '').split(/\s+/).filter(Boolean);
      for (const name of classes) {
        if (!next.includes(name)) anchor.classList.remove(name);
      }
      anchor.classList.add(...next);
      classes = next;
    });

    // Same attribute and children handling as h(), unsafe values included
    for (const key of Object.keys(props)) {
      if (!LINK_PROPS.has(key)) setAttribute(anchor, key, props[key]);
    }
    const children = props.children;
    if (children != null) insert(anchor, children);

    // Undoes only what it set, so a tabindex of the page's own stays
    let wasDisabled = false;
    follow('disabled', () => {
      const isDisabled = disabled();
      if (isDisabled === wasDisabled) return;
      wasDisabled = isDisabled;
      if (isDisabled) {
        anchor.setAttribute('aria-disabled', 'true');
        // Pointer events off stops the mouse only, so the keyboard needs this too
        anchor.setAttribute('tabindex', '-1');
        anchor.style.pointerEvents = 'none';
      } else {
        anchor.removeAttribute('aria-disabled');
        anchor.removeAttribute('tabindex');
        anchor.style.pointerEvents = '';
      }
    });

    if (props.prefetch && router) {
      const warm = (): void => {
        const { to, external } = target.peek();
        if (!external && !untrack(disabled)) void router.prefetch(to);
      };
      anchor.addEventListener('mouseenter', warm);
      anchor.addEventListener('focus', warm);
      anchor.addEventListener('touchstart', warm, { passive: true });
    }

    anchor.addEventListener('click', (event) => {
      // Not a link while disabled: no handler runs, and the browser must not
      // follow the href when something clicks it anyway
      if (untrack(disabled)) {
        event.preventDefault();
        return;
      }

      untrack(() => props.onClick)?.(event);
      if (event.defaultPrevented) return;

      // Don't handle if modifier key pressed
      if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey)
        return;

      const { to, external } = target.peek();
      const frame = untrack(() => props.target);
      if ((frame && frame !== '_self') || external) return;

      event.preventDefault();
      if (!router) return;
      if (untrack(() => props.replace)) router.replace(to);
      else router.push(to);
    });

    if (router) {
      const {
        activeClass = 'router-link-active',
        exactActiveClass = 'router-link-exact-active',
        ariaCurrentValue = 'page',
        isActive: customIsActive,
      } = props;
      const fixedPath = liveTo ? null : pathname(target.peek().path);
      createRenderEffect(() => {
        const currentPath = router.route.value.path;
        const linkPath = fixedPath ?? pathname(target.value.path);

        const isExact = currentPath === linkPath;
        const isPartial = customIsActive
          ? customIsActive(currentPath, linkPath)
          : linkPath === '/'
            ? currentPath === '/'
            : currentPath === linkPath ||
              currentPath.startsWith(
                linkPath.endsWith('/') ? linkPath : `${linkPath}/`
              );

        anchor.classList.toggle(exactActiveClass, isExact);
        anchor.classList.toggle(activeClass, isPartial);
        if (isExact) {
          anchor.setAttribute('aria-current', ariaCurrentValue);
        } else {
          anchor.removeAttribute('aria-current');
        }
      });
    }

    return anchor;
  }
}

/** The props Link handles itself, the rest go to the anchor */
const LINK_PROPS = new Set([
  'to',
  'replace',
  'activeClass',
  'exactActiveClass',
  'ariaCurrentValue',
  'class',
  'isActive',
  'target',
  'rel',
  'disabled',
  'prefetch',
  'onClick',
  'children',
]);

function read<T>(value: MaybeAccessor<T>): T {
  return typeof value === 'function' ? (value as () => T)() : value;
}

/**
 * The path without query and hash, for active state comparison.
 */
function pathname(path: string): string {
  const end = path.search(/[?#]/);
  return normalizeEncoding(end === -1 ? path : path.slice(0, end));
}

//=============================================
// RouterLink Alias
//=============================================

/**
 * Alias for Link component (Vue-style naming)
 */
export const RouterLink = Link;

//=============================================
// NavLink Component
//=============================================

/**
 * Navigation link with enhanced active state detection.
 *
 * Similar to Link but with more control over active state matching.
 * Use this when you need custom active detection logic.
 *
 * @example
 * ```typescript
 * html`<${NavLink}
 *   to="/users"
 *   isActive=${(current, to) => current.startsWith(to)}
 * >
 *   Users Section
 * </${NavLink}>`
 * ```
 */
export class NavLink extends Link {
  constructor(props: LinkProps) {
    // mergeProps() keeps the getters of JSX props, a spread would read them
    super(
      mergeProps<LinkProps>(
        {
          activeClass: 'nav-link-active',
          exactActiveClass: 'nav-link-exact-active',
        },
        props
      )
    );
  }
}
