/**
 * Small apps built only from the public entry point, driven like a user would.
 */

import { describe, it, expect } from 'vitest';
import { within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import {
  Component,
  Signal,
  Computed,
  For,
  Show,
  batch,
  html,
  createRef,
  type RenderResult,
} from '../../src';
import { mount } from '../support/mount';
import { settle } from '../support/tick';

const node = (result: unknown) =>
  (Array.isArray(result) ? result[0] : result) as Node;

describe('counter', () => {
  class Counter extends Component {
    private count = new Signal(0);
    private double = new Computed(() => this.count.value * 2);

    protected render(): RenderResult {
      return html`<div>
        <button onClick=${() => this.count.set((c) => c + 1)}>add</button>
        <button onClick=${() => (this.count.value = 0)}>reset</button>
        <output>${() => this.count.value} / ${() => this.double.value}</output>
      </div>`;
    }
  }

  it('increments and resets', async () => {
    const { root } = mount(Counter);
    const screen = within(root);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'add' }));
    await user.click(screen.getByRole('button', { name: 'add' }));
    settle();
    expect(root.querySelector('output')?.textContent).toBe('2 / 4');

    await user.click(screen.getByRole('button', { name: 'reset' }));
    settle();
    expect(root.querySelector('output')?.textContent).toBe('0 / 0');
  });
});

describe('todo list', () => {
  interface Todo {
    id: number;
    text: string;
    done: boolean;
  }

  class Todos extends Component {
    private todos = new Signal<Todo[]>([]);
    private filter = new Signal<'all' | 'open'>('all');
    private input = createRef<HTMLInputElement>();
    private nextId = 1;

    private visible = new Computed(() =>
      this.filter.value === 'open'
        ? this.todos.value.filter((t) => !t.done)
        : this.todos.value
    );

    private add = (e: Event) => {
      e.preventDefault();
      const text = this.input.current!.value.trim();
      if (!text) return;
      this.todos.set((list) => [
        ...list,
        { id: this.nextId++, text, done: false },
      ]);
      this.input.current!.value = '';
    };

    private toggle = (id: number) =>
      this.todos.set((list) =>
        list.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
      );

    private remove = (id: number) =>
      this.todos.set((list) => list.filter((t) => t.id !== id));

    protected render(): RenderResult {
      return html`<section>
        <form onSubmit=${this.add}>
          <input ref=${this.input} aria-label="new todo" />
          <button type="submit">add</button>
        </form>
        <label>
          <input
            type="checkbox"
            aria-label="only open"
            onChange=${(e: Event) =>
              (this.filter.value = (e.target as HTMLInputElement).checked
                ? 'open'
                : 'all')}
          />
        </label>
        <ul>
          ${For({
            each: () => this.visible.value,
            key: (t: Todo) => t.id,
            fallback: node(html`<li>nothing to do</li>`),
            children: (t: Todo) =>
              node(
                html`<li class=${t.done ? 'done' : ''}>
                  <span>${t.text}</span>
                  <button
                    aria-label=${`toggle ${t.text}`}
                    onClick=${() => this.toggle(t.id)}
                  >
                    ✓
                  </button>
                  <button
                    aria-label=${`remove ${t.text}`}
                    onClick=${() => this.remove(t.id)}
                  >
                    ×
                  </button>
                </li>`
              ),
          })}
        </ul>
        <p>${() => `${this.todos.value.filter((t) => !t.done).length} left`}</p>
      </section>`;
    }
  }

  async function addTodo(root: HTMLElement, text: string) {
    const user = userEvent.setup();
    await user.type(within(root).getByLabelText('new todo'), text);
    await user.click(within(root).getByRole('button', { name: 'add' }));
    settle();
  }

  const items = (root: HTMLElement) =>
    Array.from(root.querySelectorAll('li span')).map((s) => s.textContent);

  it('starts empty', () => {
    const { root } = mount(Todos);
    expect(root.querySelector('li')?.textContent).toBe('nothing to do');
    expect(root.querySelector('p')?.textContent).toBe('0 left');
  });

  it('adds, toggles, filters and removes todos', async () => {
    const { root } = mount(Todos);
    const user = userEvent.setup();

    await addTodo(root, 'milk');
    await addTodo(root, 'bread');
    expect(items(root)).toEqual(['milk', 'bread']);
    expect(root.querySelector('p')?.textContent).toBe('2 left');

    await user.click(within(root).getByLabelText('toggle milk'));
    settle();
    expect(root.querySelector('p')?.textContent).toBe('1 left');

    await user.click(within(root).getByLabelText('only open'));
    settle();
    expect(items(root)).toEqual(['bread']);

    await user.click(within(root).getByLabelText('remove bread'));
    settle();
    expect(root.querySelector('li')?.textContent).toBe('nothing to do');
  });

  it('ignores blank input', async () => {
    const { root } = mount(Todos);
    await addTodo(root, '   ');
    expect(items(root)).toEqual([]);
  });
});

describe('form with validation', () => {
  class SignUp extends Component {
    private email = new Signal('');
    private submitted = new Signal<string | null>(null);
    private valid = new Computed(() => /^\S+@\S+\.\S+$/.test(this.email.value));

    protected render(): RenderResult {
      return html`<form
        onSubmit=${(e: Event) => {
          e.preventDefault();
          if (this.valid.value) this.submitted.value = this.email.value;
        }}
      >
        <input
          aria-label="email"
          onInput=${(e: Event) => (this.email.value = (e.target as HTMLInputElement).value)}
        />
        ${Show({
          when: () => this.email.value !== '' && !this.valid.value,
          children: () => node(html`<p role="alert">invalid email</p>`),
        })}
        <button disabled=${() => !this.valid.value}>sign up</button>
        ${Show({
          when: () => this.submitted.value,
          children: (email: string) => node(html`<p>welcome ${email}</p>`),
        })}
      </form>`;
    }
  }

  it('validates while typing and submits a valid value', async () => {
    const { root } = mount(SignUp);
    const screen = within(root);
    const user = userEvent.setup();
    const button = screen.getByRole('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    await user.type(screen.getByLabelText('email'), 'ada@');
    settle();
    expect(screen.getByRole('alert').textContent).toBe('invalid email');

    await user.type(screen.getByLabelText('email'), 'example.com');
    settle();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(button.disabled).toBe(false);

    await user.click(button);
    settle();
    expect(screen.getByText('welcome ada@example.com')).toBeTruthy();
  });
});

describe('batched updates', () => {
  it('renders once per batch', () => {
    const first = new Signal('a');
    const last = new Signal('b');
    let renders = 0;
    const { root } = mount(
      () =>
        html`<p>
          ${() => {
            renders++;
            return `${first.value} ${last.value}`;
          }}
        </p>`
    );
    renders = 0;

    batch(() => {
      first.value = 'x';
      last.value = 'y';
    });
    settle();

    expect(root.textContent).toBe('x y');
    expect(renders).toBe(1);
  });
});
