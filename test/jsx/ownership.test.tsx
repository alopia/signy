/**
 * A JSX conditional keeps one live binding, however often it toggles.
 */

import { it, expect } from 'vitest';
import { Signal, type RenderResult } from '../../src';
import { mount } from '../support/mount';
import { settle } from '../support/tick';

it('a toggled conditional keeps one binding', () => {
  const show = new Signal(true);
  const name = new Signal('a');
  const { unmount } = mount(
    () => (<div>{show.value ? <p>{name.value}</p> : null}</div>) as RenderResult
  );

  for (let i = 0; i < 6; i++) {
    show.value = !show.value;
    settle();
  }
  expect(name.subscriberCount).toBe(1);

  unmount();
  expect(name.subscriberCount).toBe(0);
  expect(show.subscriberCount).toBe(0);
});

it('a reactive spread keeps one listener per event', () => {
  const title = new Signal('a');
  let clicks = 0;
  const { root } = mount(
    () =>
      (
        <button {...{ title: title.value, onClick: () => clicks++ }}>x</button>
      ) as RenderResult
  );
  title.value = 'b';
  settle();
  title.value = 'c';
  settle();
  const button = root.querySelector('button')!;
  expect(button.title).toBe('c');
  button.click();
  expect(clicks).toBe(1);
});
