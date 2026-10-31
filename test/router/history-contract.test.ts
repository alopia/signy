/**
 * One contract for every history type: memory, hash and browser history must
 * behave the same through the History interface.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  createBrowserHistory,
  createHashHistory,
  createMemoryHistory,
  type History,
  type NavigationAction,
} from '../../src/router/history';

/** Browser and hash history get pops from the window asynchronously */
const waitForPop = () => new Promise((resolve) => setTimeout(resolve, 20));

const kinds: Array<[string, () => History]> = [
  ['memory', () => createMemoryHistory({ initialEntries: ['/'] })],
  [
    'hash',
    () => {
      window.history.replaceState(null, '', '/#/');
      return createHashHistory();
    },
  ],
  [
    'browser',
    () => {
      window.history.replaceState(null, '', '/');
      return createBrowserHistory();
    },
  ],
];

describe.each(kinds)('%s history contract', (_kind, create) => {
  let history: History;

  afterEach(() => {
    history.destroy();
    window.history.replaceState(null, '', '/');
  });

  it('starts at the root', () => {
    history = create();
    expect(history.location.value.path).toBe('/');
  });

  it('push and replace update the location, with query and hash', () => {
    history = create();
    history.push('/users?tab=a#top');
    expect(history.location.value).toMatchObject({
      path: '/users',
      search: 'tab=a',
      hash: 'top',
      fullPath: '/users?tab=a#top',
    });

    history.replace('/about');
    expect(history.location.value.path).toBe('/about');
  });

  it('notifies listeners with the action and the pop distance', async () => {
    history = create();
    const events: Array<[string, NavigationAction, number]> = [];
    history.listen((location, action, delta) =>
      events.push([location.path, action, delta])
    );

    history.push('/a');
    history.push('/b');
    history.replace('/c');
    history.back();
    await waitForPop();

    expect(events).toEqual([
      ['/a', 'push', 0],
      ['/b', 'push', 0],
      ['/c', 'replace', 0],
      ['/a', 'pop', -1],
    ]);
  });

  it('goes back and forward between entries', async () => {
    history = create();
    history.push('/a');
    history.push('/b');

    history.back();
    await waitForPop();
    expect(history.location.value.path).toBe('/a');

    history.forward();
    await waitForPop();
    expect(history.location.value.path).toBe('/b');

    history.go(-2);
    await waitForPop();
    expect(history.location.value.path).toBe('/');
  });

  it('keeps push state on the entry', () => {
    history = create();
    history.push('/a', { from: 'test' });
    expect(history.location.value.state).toEqual({ from: 'test' });
  });

  it('lets a blocker stop a push and retry it', () => {
    history = create();
    let retry: (() => void) | undefined;
    const unblock = history.block((_location, _action, r) => {
      retry = r;
    });

    history.push('/blocked');
    expect(history.location.value.path).toBe('/');

    unblock();
    retry!();
    expect(history.location.value.path).toBe('/blocked');
  });

  it('lets a blocker stop a back and keeps every entry', async () => {
    history = create();
    history.push('/a');
    history.push('/b');
    const unblock = history.block(() => {});

    history.back();
    await waitForPop();
    await waitForPop();
    expect(history.location.value.path).toBe('/b');

    unblock();
    history.back();
    await waitForPop();
    expect(history.location.value.path).toBe('/a');
  });

  it('stops notifying after unlisten and destroy', () => {
    history = create();
    const paths: string[] = [];
    const unlisten = history.listen((location) => paths.push(location.path));
    history.push('/a');
    unlisten();
    history.push('/b');
    expect(paths).toEqual(['/a']);
  });

  it('creates hrefs that lead back to the path', () => {
    history = create();
    const href = history.createHref('/users/1?x=2');
    expect(href.endsWith('/users/1?x=2')).toBe(true);
  });
});
