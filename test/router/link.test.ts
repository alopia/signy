/**
 * Link rendering, navigation and active classes through a mounted app.
 */

import { describe, it, expect, vi } from 'vitest';
import { within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { Component, Link, Signal, html, type RenderResult } from '../../src';
import type { LinkProps } from '../../src/router/components/link';
import type { RouteConfig } from '../../src/router/types';
import { mount } from '../support/mount';
import { createTestRouter } from '../support/router';
import { settle, settleAsync } from '../support/tick';
import { expectLogged } from '../support/console';

const page = (name: string) =>
  class extends Component {
    protected render(): RenderResult {
      return html`<p>${name}</p>`;
    }
  };

const routes: RouteConfig[] = [
  { path: '/', component: page('home') },
  { path: '/users', component: page('users') },
  { path: '/users/:id', name: 'user', component: page('user') },
  { path: '/user', component: page('user singular') },
];

async function renderLink(props: LinkProps, initial = '/') {
  const router = createTestRouter(routes, { initialEntries: [initial] });
  class Root extends Component {
    protected render(): RenderResult {
      return html`<nav><${Link} ...${props}>go</${Link}></nav>`;
    }
  }
  const { root } = mount(Root, { plugins: [router] });
  await settleAsync();
  const link = within(root).getByRole('link') as HTMLAnchorElement;
  return { router, root, link };
}

describe('Link', () => {
  it('renders an anchor with href and children', async () => {
    const { link } = await renderLink({ to: '/users' });
    expect(link.getAttribute('href')).toBe('/users');
    expect(link.textContent).toBe('go');
  });

  it('builds href from a navigation target', async () => {
    const { link } = await renderLink({
      to: {
        path: '/users',
        query: { page: '2', tag: ['a', 'b'] },
        hash: 'top',
      },
    });
    expect(link.getAttribute('href')).toBe('/users?page=2&tag=a&tag=b#top');
  });

  it('navigates on click with push', async () => {
    const { link, router } = await renderLink({ to: '/users' });
    const push = vi.spyOn(router, 'push');

    await userEvent.click(link);
    await settleAsync();

    expect(push).toHaveBeenCalledWith('/users');
    expect(router.route.value.path).toBe('/users');
  });

  it('uses replace when asked', async () => {
    const { link, router } = await renderLink({ to: '/users', replace: true });
    const replace = vi.spyOn(router, 'replace');
    const push = vi.spyOn(router, 'push');

    await userEvent.click(link);
    expect(replace).toHaveBeenCalledWith('/users');
    expect(push).not.toHaveBeenCalled();
  });

  it.each([['{Meta>}'], ['{Control>}'], ['{Shift>}'], ['{Alt>}']])(
    'leaves modified clicks (%s) to the browser',
    async (modifier) => {
      const { link, router } = await renderLink({ to: '/users' });
      const push = vi.spyOn(router, 'push');

      const user = userEvent.setup();
      await user.keyboard(modifier);
      await user.click(link);

      expect(push).not.toHaveBeenCalled();
    }
  );

  it('leaves target=_blank links to the browser', async () => {
    const { link, router } = await renderLink({
      to: '/users',
      target: '_blank',
    });
    const push = vi.spyOn(router, 'push');

    await userEvent.click(link);
    expect(push).not.toHaveBeenCalled();
    expect(link.target).toBe('_blank');
  });

  it('leaves external links to the browser', async () => {
    const { link, router } = await renderLink({ to: 'https://example.com' });
    const push = vi.spyOn(router, 'push');

    await userEvent.click(link);
    expect(push).not.toHaveBeenCalled();
  });

  it('does nothing when disabled', async () => {
    const { link, router } = await renderLink({ to: '/users', disabled: true });
    const push = vi.spyOn(router, 'push');

    link.click();
    expect(push).not.toHaveBeenCalled();
    expect(link.getAttribute('aria-disabled')).toBe('true');
  });

  it('stops the browser from following the href of a disabled link', async () => {
    const { link, router } = await renderLink({ to: '/users', disabled: true });
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    await settleAsync();
    expect(event.defaultPrevented).toBe(true);
    expect(router.route.value.path).toBe('/');
  });

  it('takes a disabled link out of the tab order', async () => {
    const { link } = await renderLink({ to: '/users', disabled: true });
    expect(link.getAttribute('tabindex')).toBe('-1');
    expect(link.getAttribute('aria-disabled')).toBe('true');
  });

  it('skips a disabled link when tabbing', async () => {
    const router = createTestRouter(routes, { initialEntries: ['/'] });
    class Root extends Component {
      protected render(): RenderResult {
        return html`<nav>
          <${Link} to="/users" disabled>off</${Link}>
          <${Link} to="/user">on</${Link}>
        </nav>`;
      }
    }
    mount(Root, { plugins: [router] });
    await settleAsync();
    await userEvent.tab();
    expect(document.activeElement?.textContent).toBe('on');
  });

  it('does not call onClick of a disabled link', async () => {
    const onClick = vi.fn();
    const { link } = await renderLink({
      to: '/users',
      disabled: true,
      onClick,
    });
    link.click();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('leaves an enabled link with a modifier key to the browser', async () => {
    const { link, router } = await renderLink({ to: '/users' });
    const event = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
    });
    link.dispatchEvent(event);
    await settleAsync();
    expect(event.defaultPrevented).toBe(false);
    expect(router.route.value.path).toBe('/');
  });

  it('calls onClick and respects preventDefault', async () => {
    const onClick = vi.fn((e: MouseEvent) => e.preventDefault());
    const { link, router } = await renderLink({ to: '/users', onClick });
    const push = vi.spyOn(router, 'push');

    await userEvent.click(link);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  describe('active classes', () => {
    it('marks exact and partial matches', async () => {
      const { link, router } = await renderLink({ to: '/users' }, '/users');
      expect(link.classList.contains('router-link-active')).toBe(true);
      expect(link.classList.contains('router-link-exact-active')).toBe(true);

      await router.push('/users/5');
      settle();
      expect(link.classList.contains('router-link-active')).toBe(true);
      expect(link.classList.contains('router-link-exact-active')).toBe(false);

      await router.push('/');
      settle();
      expect(link.classList.contains('router-link-active')).toBe(false);
    });

    it('only marks the root link active on the root path', async () => {
      const { link } = await renderLink({ to: '/' }, '/users');
      expect(link.classList.contains('router-link-active')).toBe(false);
    });

    it('uses custom class names', async () => {
      const { link } = await renderLink(
        { to: '/users', activeClass: 'on', exactActiveClass: 'here' },
        '/users'
      );
      expect(link.className).toContain('on');
      expect(link.className).toContain('here');
    });

    it('uses a custom isActive', async () => {
      const isActive = vi.fn(() => true);
      const { link } = await renderLink({ to: '/users', isActive }, '/');
      expect(isActive).toHaveBeenCalledWith('/', '/users');
      expect(link.classList.contains('router-link-active')).toBe(true);
    });

    it('sets aria-current="page" on the exact match only', async () => {
      const { link, router } = await renderLink({ to: '/users' }, '/users');
      expect(link.getAttribute('aria-current')).toBe('page');

      await router.push('/users/5');
      settle();
      expect(link.hasAttribute('aria-current')).toBe(false);

      await router.push('/users');
      settle();
      expect(link.getAttribute('aria-current')).toBe('page');
    });

    it('takes another aria-current value', async () => {
      const { link } = await renderLink(
        { to: '/users', ariaCurrentValue: 'step' },
        '/users'
      );
      expect(link.getAttribute('aria-current')).toBe('step');
    });

    it('matches whole path segments, so /user is not active on /users', async () => {
      const { link } = await renderLink({ to: '/user' }, '/users');
      expect(link.classList.contains('router-link-active')).toBe(false);
    });
  });
});

describe('Link targets', () => {
  it('resolves a named target', async () => {
    const { link } = await renderLink({
      to: { name: 'user', params: { id: '7' }, query: { tab: 'a' } },
    });
    expect(link.getAttribute('href')).toBe('/users/7?tab=a');
  });

  it('leaves mailto: and tel: links to the browser', async () => {
    for (const to of ['mailto:a@example.com', 'tel:+123']) {
      const { link, router } = await renderLink({ to });
      expect(link.getAttribute('href')).toBe(to);
      const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      });
      link.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(router.route.value.path).toBe('/');
    }
  });
});

describe('Link with an unsafe URL', () => {
  it.each(['javascript:alert(1)', ' JaVaScRiPt:alert(1)'])(
    'never renders the href %j',
    async (to) => {
      const router = createTestRouter(routes);
      class Root extends Component {
        protected render(): RenderResult {
          return html`<${Link} to=${to}>go</${Link}>`;
        }
      }
      const { root } = mount(Root, { plugins: [router] });
      await settleAsync();
      expectLogged('warn', 'view:unsafe-attribute');
      expect(root.querySelector('a')!.hasAttribute('href')).toBe(false);
    }
  );
});

describe('Link prefetch', () => {
  it('prefetches the target on hover, focus and touch', async () => {
    const { router, link } = await renderLink({ to: '/users', prefetch: true });
    const prefetch = vi.spyOn(router, 'prefetch').mockResolvedValue();
    link.dispatchEvent(new MouseEvent('mouseenter'));
    link.dispatchEvent(new FocusEvent('focus'));
    link.dispatchEvent(new Event('touchstart'));
    expect(prefetch).toHaveBeenCalledTimes(3);
    expect(prefetch).toHaveBeenCalledWith('/users');
  });

  it('passes a navigation target as it is', async () => {
    const target = { name: 'user', params: { id: '4' } };
    const { router, link } = await renderLink({ to: target, prefetch: true });
    const prefetch = vi.spyOn(router, 'prefetch').mockResolvedValue();
    link.dispatchEvent(new MouseEvent('mouseenter'));
    expect(prefetch).toHaveBeenCalledWith(target);
  });

  it('does nothing without the prop', async () => {
    const { router, link } = await renderLink({ to: '/users' });
    const prefetch = vi.spyOn(router, 'prefetch').mockResolvedValue();
    link.dispatchEvent(new MouseEvent('mouseenter'));
    link.dispatchEvent(new FocusEvent('focus'));
    expect(prefetch).not.toHaveBeenCalled();
  });

  it('does nothing for a disabled link', async () => {
    const { router, link } = await renderLink({
      to: '/users',
      prefetch: true,
      disabled: true,
    });
    const prefetch = vi.spyOn(router, 'prefetch').mockResolvedValue();
    link.dispatchEvent(new MouseEvent('mouseenter'));
    expect(prefetch).not.toHaveBeenCalled();
  });

  it('does nothing for an external link', async () => {
    const { router, link } = await renderLink({
      to: 'https://example.com',
      prefetch: true,
    });
    const prefetch = vi.spyOn(router, 'prefetch').mockResolvedValue();
    link.dispatchEvent(new MouseEvent('mouseenter'));
    expect(prefetch).not.toHaveBeenCalled();
  });

  it('does not write prefetch to the anchor', async () => {
    const { link } = await renderLink({ to: '/users', prefetch: true });
    expect(link.hasAttribute('prefetch')).toBe(false);
  });
});

describe('Link with encoded characters', () => {
  it('is active for the same path written raw or encoded', async () => {
    const router = createTestRouter(
      [{ path: '/café', component: page('cafe') }],
      { initialEntries: ['/caf%C3%A9'] }
    );
    class Root extends Component {
      protected render(): RenderResult {
        return html`<nav><${Link} to="/café">go</${Link}></nav>`;
      }
    }
    const { root } = mount(Root, { plugins: [router] });
    await settleAsync();
    expect(within(root).getByRole('link').getAttribute('aria-current')).toBe(
      'page'
    );
  });
});

describe('Link with props that change', () => {
  it('follows a to accessor: href, active state and navigation', async () => {
    const to = new Signal('/users');
    const { link, router } = await renderLink({ to: () => to.value }, '/user');
    expect(link.getAttribute('href')).toBe('/users');
    expect(link.classList.contains('router-link-exact-active')).toBe(false);

    to.value = '/user';
    settle();
    expect(link.getAttribute('href')).toBe('/user');
    expect(link.classList.contains('router-link-exact-active')).toBe(true);

    to.value = '/users/7';
    settle();
    await userEvent.click(link);
    await settleAsync();
    expect(router.route.value.path).toBe('/users/7');
  });

  it('follows class and disabled accessors, and keeps the active classes', async () => {
    const extra = new Signal('a');
    const disabled = new Signal(true);
    const { link, router } = await renderLink({
      to: '/',
      class: () => extra.value,
      disabled: () => disabled.value,
    });
    expect(link.className).toContain('a');
    expect(link.getAttribute('aria-disabled')).toBe('true');
    expect(link.getAttribute('tabindex')).toBe('-1');

    extra.value = 'b';
    disabled.value = false;
    settle();
    expect(link.classList.contains('a')).toBe(false);
    expect(link.classList.contains('b')).toBe(true);
    expect(link.classList.contains('router-link-active')).toBe(true);
    expect(link.hasAttribute('aria-disabled')).toBe(false);
    expect(link.hasAttribute('tabindex')).toBe(false);
    expect(link.style.pointerEvents).toBe('');

    const push = vi.spyOn(router, 'push');
    await userEvent.click(link);
    expect(push).toHaveBeenCalledWith('/');
  });

  it('keeps a tabindex of its own while enabled', async () => {
    const { link } = await renderLink({ to: '/', tabindex: '3' });
    expect(link.getAttribute('tabindex')).toBe('3');
  });
});
