/**
 * JSX compiled by babel-plugin-jsx-dom-expressions, the way users build it.
 */

import { describe, it, expect, vi } from 'vitest';
import { within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import {
  Component,
  Signal,
  Show,
  Switch,
  Match,
  For,
  Dynamic,
  bind,
  mergeProps,
  splitProps,
  createRef,
  createContext,
  onCleanup,
  type RenderResult,
} from '../../src';
import type { Accessor, JSX } from '../../src/jsx';
import { NavLink } from '../../src/router';
import { mount } from '../support/mount';
import { createTestRouter } from '../support/router';
import { settle } from '../support/tick';

// The compiler calls a use: directive by name, which TypeScript does not see
void bind;

const render = (fn: () => unknown) => mount(() => fn() as RenderResult).root;

describe('JSX elements', () => {
  it('renders static markup', () => {
    const root = render(() => (
      <a href="/x" title="go">
        link
      </a>
    ));
    expect(root.innerHTML).toBe('<a href="/x" title="go">link</a>');
  });

  it('updates text and attributes reactively', () => {
    const count = new Signal(1);
    const root = render(() => (
      <p data-count={count.value} class={count.value > 1 ? 'many' : 'one'}>
        {count.value}
      </p>
    ));
    const p = root.querySelector('p')!;

    count.value = 3;
    settle();
    expect(p.textContent).toBe('3');
    expect(p.getAttribute('data-count')).toBe('3');
    expect(p.className).toBe('many');
  });

  it('applies style objects and classList', () => {
    const on = new Signal(false);
    const root = render(() => (
      <div
        style={{ color: on.value ? 'red' : 'blue' }}
        classList={{ active: on.value }}
      />
    ));
    const div = root.querySelector('div')!;
    expect(div.style.color).toBe('blue');
    expect(div.classList.contains('active')).toBe(false);

    on.value = true;
    settle();
    expect(div.style.color).toBe('red');
    expect(div.classList.contains('active')).toBe(true);
  });

  it('renders conditionals and lists of nodes', () => {
    const show = new Signal(true);
    const items = new Signal(['a', 'b']);
    const root = render(() => (
      <div>
        {show.value ? <b>yes</b> : <i>no</i>}
        <ul>
          {items.value.map((i) => (
            <li>{i}</li>
          ))}
        </ul>
      </div>
    ));
    expect(root.querySelector('b')?.textContent).toBe('yes');
    expect(root.querySelectorAll('li')).toHaveLength(2);

    show.value = false;
    items.value = ['c'];
    settle();
    expect(root.querySelector('i')?.textContent).toBe('no');
    expect(root.querySelectorAll('li')).toHaveLength(1);
  });

  it('renders fragments', () => {
    const root = render(() => (
      <>
        <a />
        <b />
      </>
    ));
    expect(root.innerHTML).toBe('<a></a><b></b>');
  });

  it('creates SVG elements in the SVG namespace', () => {
    const root = render(() => (
      <svg viewBox="0 0 10 10">
        <circle cx="5" cy="5" r="4" />
      </svg>
    ));
    const circle = root.querySelector('circle')!;
    expect(circle.namespaceURI).toBe('http://www.w3.org/2000/svg');
  });

  it('removes a namespaced attribute when its value goes away', () => {
    const xlink = 'http://www.w3.org/1999/xlink';
    const href = new Signal<string | undefined>('#a');
    const root = render(() => (
      <svg>
        <use xlink:href={href.value} />
      </svg>
    ));
    const use = root.querySelector('use')!;
    expect(use.getAttributeNS(xlink, 'href')).toBe('#a');
    href.value = '#b';
    settle();
    expect(use.getAttributeNS(xlink, 'href')).toBe('#b');
    href.value = undefined;
    settle();
    expect(use.hasAttributeNS(xlink, 'href')).toBe(false);
  });

  it('keeps classList and class: classes when class changes', () => {
    const cls = new Signal('a');
    const on = new Signal(true);
    const root = render(() => (
      <div>
        <p class={cls.value} classList={{ lit: on.value }} />
        <i class={cls.value} class:lit={on.value} />
        <svg>
          <circle class={cls.value} class:lit={on.value} />
        </svg>
      </div>
    ));
    const nodes = [
      root.querySelector('p')!,
      root.querySelector('i')!,
      root.querySelector('circle')!,
    ];
    cls.value = 'b c';
    settle();
    for (const node of nodes) {
      expect(node.classList.contains('lit')).toBe(true);
      expect(node.classList.contains('a')).toBe(false);
      expect(node.classList.contains('c')).toBe(true);
    }
    on.value = false;
    cls.value = '';
    settle();
    for (const node of nodes) expect(node.classList.length).toBe(0);
  });

  it('keeps style: properties when a style string changes', () => {
    const css = new Signal<string | Record<string, string>>('width: 1px');
    const root = render(() => (
      <p style={css.value as string} style:color="red" />
    ));
    const p = root.querySelector('p')!;
    css.value = 'width: 2px';
    settle();
    expect(p.style.width).toBe('2px');
    expect(p.style.color).toBe('red');

    css.value = { width: '3px' };
    settle();
    expect(p.style.width).toBe('3px');
    expect(p.style.color).toBe('red');
  });

  it('disposes a binding among the roots of a fragment with the root', () => {
    const n = new Signal(1);
    const { root, unmount } = mount(() => (
      <>
        <b>a</b>
        {n.value}
        <i>c</i>
      </>
    ));
    n.value = 2;
    settle();
    expect(root.textContent).toBe('a2c');
    // mount() fails the test when an effect is still live after this
    unmount();
  });

  it('sets a bool: attribute', () => {
    const on = new Signal(true);
    const root = render(() => <div bool:hidden={on.value} />);
    const div = root.querySelector('div')!;
    expect(div.hasAttribute('hidden')).toBe(true);

    on.value = false;
    settle();
    expect(div.hasAttribute('hidden')).toBe(false);
  });

  it('creates a MathML root outside <math> in the MathML namespace', () => {
    const MathRow = () => (
      <mrow>
        <mi>x</mi>
      </mrow>
    );
    const root = render(() => (
      <p>
        <MathRow />
      </p>
    ));
    const mi = root.querySelector('mi')!;
    expect(root.querySelector('mrow')!.namespaceURI).toBe(
      'http://www.w3.org/1998/Math/MathML'
    );
    expect(mi.namespaceURI).toBe('http://www.w3.org/1998/Math/MathML');
  });

  it('spreads props', () => {
    const props = { id: 'x', title: 't', 'data-a': '1' };
    const root = render(() => <span {...props} />);
    const span = root.querySelector('span')!;
    expect(span.id).toBe('x');
    expect(span.title).toBe('t');
    expect(span.dataset['a']).toBe('1');
  });

  it('renders the children of spread props', () => {
    const label = new Signal('a');
    const Box = (props: JSX.HTMLAttributes<HTMLDivElement>) => (
      <div {...props} />
    );
    const root = render(() => (
      <Box id="b">
        <i>{label.value}</i>
      </Box>
    ));
    expect(root.innerHTML).toBe('<div id="b"><i>a</i></div>');

    label.value = 'b';
    settle();
    expect(root.innerHTML).toBe('<div id="b"><i>b</i></div>');
  });

  it('follows the keys of a dynamic spread', () => {
    const on = new Signal(false);
    let clicks = 0;
    const base = { id: 'x' };
    const extra = () => ({
      title: 'a',
      class: 'on',
      style: { color: 'red' },
      'class:lit': true,
      'on:click': () => clicks++,
    });
    const root = render(() => (
      <p {...base} {...(on.value ? extra() : {})}>
        x
      </p>
    ));
    const p = root.querySelector('p')!;
    expect(p.hasAttribute('title')).toBe(false);

    on.value = true;
    settle();
    expect(p.id).toBe('x');
    expect(p.title).toBe('a');
    expect(p.className).toBe('on lit');
    expect(p.style.color).toBe('red');
    p.click();
    expect(clicks).toBe(1);

    on.value = false;
    settle();
    expect(p.id).toBe('x');
    expect(p.hasAttribute('title')).toBe(false);
    expect(p.className).toBe('');
    expect(p.style.color).toBe('');
    p.click();
    expect(clicks).toBe(1);
  });

  it('empties an input when a dynamic spread drops prop:value', () => {
    const on = new Signal(true);
    const root = render(() => (
      <input {...(on.value ? { 'prop:value': 'x' } : {})} />
    ));
    const input = root.querySelector('input')!;
    expect(input.value).toBe('x');
    on.value = false;
    settle();
    expect(input.value).toBe('');
  });

  it('follows a dynamic spread that starts with no keys', () => {
    const on = new Signal(false);
    const root = render(() => <p {...(on.value ? { title: 'a' } : {})}>x</p>);
    on.value = true;
    settle();
    expect(root.querySelector('p')!.title).toBe('a');
  });

  describe('keys a dynamic spread gains, through a copy of the props', () => {
    const cases: [string, (props: Record<string, unknown>) => JSX.Element][] = [
      [
        'a spread with a prop beside it',
        (props) => <p {...props} class="box" />,
      ],
      [
        'splitProps()',
        (props) => {
          const [, rest] = splitProps(props, ['x']);
          return <p {...rest} />;
        },
      ],
      [
        'mergeProps()',
        (props) => {
          const merged = mergeProps({ id: 'd' }, props);
          return <p {...merged} />;
        },
      ],
      ['Dynamic', (props) => <Dynamic component="p" {...props} />],
    ];
    it.each(cases)('reach the element through %s', (_name, Box) => {
      const on = new Signal(false);
      const root = render(() => <Box {...(on.value ? { title: 'a' } : {})} />);
      on.value = true;
      settle();
      expect(root.querySelector('p')!.title).toBe('a');
      on.value = false;
      settle();
      expect(root.querySelector('p')!.hasAttribute('title')).toBe(false);
    });

    it('keep the ref of a tag Dynamic renders', () => {
      const on = new Signal(false);
      const ref = createRef<HTMLElement>();
      const root = render(() => (
        <Dynamic component="p" ref={ref} {...(on.value ? { id: 'a' } : {})} />
      ));
      expect(ref.current).toBe(root.querySelector('p'));
    });

    it('reach a component Dynamic renders', () => {
      const on = new Signal(false);
      const Label = (props: { title?: string }) => (
        <b>{'title' in props ? props.title : 'none'}</b>
      );
      const root = render(() => (
        <Dynamic
          component={() => Label}
          {...(on.value ? { title: 'a' } : {})}
        />
      ));
      expect(root.textContent).toBe('none');
      on.value = true;
      settle();
      expect(root.textContent).toBe('a');
    });
  });

  it('follows the props of a Link', async () => {
    const router = createTestRouter([
      { path: '/' },
      { path: '/a' },
      { path: '/b' },
    ]);
    const to = new Signal('/a');
    const open = new Signal(false);
    const { root } = mount(
      () => (
        <nav>
          <NavLink to={to.value} class={open.value ? 'open' : 'shut'}>
            x
          </NavLink>
        </nav>
      ),
      { plugins: [router] }
    );
    const link = root.querySelector('a')!;
    to.value = '/b';
    open.value = true;
    settle();
    expect(link.getAttribute('href')).toBe('/b');
    expect(link.classList.contains('open')).toBe(true);
    expect(link.classList.contains('shut')).toBe(false);
  });

  it('gives a component the keys a dynamic spread gains', () => {
    const on = new Signal(false);
    const Label = (props: { title?: string }) => (
      <b>{'title' in props ? props.title : 'none'}</b>
    );
    const root = render(() => <Label {...(on.value ? { title: 'a' } : {})} />);
    expect(root.textContent).toBe('none');
    on.value = true;
    settle();
    expect(root.textContent).toBe('a');
  });

  describe('a ref in a spread', () => {
    it('is filled through a component that spreads its props', () => {
      const ref = createRef<HTMLInputElement>();
      let el: HTMLInputElement | undefined;
      const Box = (props: JSX.HTMLAttributes<HTMLInputElement>) => (
        <input {...props} />
      );
      const root = render(() => (
        <div>
          <Box ref={ref} />
          <Box ref={(e: HTMLInputElement) => (el = e)} />
        </div>
      ));
      const inputs = root.querySelectorAll('input');
      expect(ref.current).toBe(inputs[0]);
      expect(el).toBe(inputs[1]);
    });

    it('is filled from a spread object, once', () => {
      const ref = createRef<HTMLParagraphElement>();
      let calls = 0;
      const on = new Signal(false);
      const callback = () => calls++;
      const props = { ref, id: 'x' };
      const root = render(() => (
        <div>
          <p {...props} />
          <i {...{ ref: callback }} {...(on.value ? { title: 't' } : {})} />
        </div>
      ));
      expect(ref.current).toBe(root.querySelector('p'));
      on.value = true;
      settle();
      expect(root.querySelector('i')!.title).toBe('t');
      expect(calls).toBe(1);
    });
  });

  it('keeps its own children over the children of spread props', () => {
    const props = { children: 'ignored', title: 't' };
    const root = render(() => <p {...props}>own</p>);
    expect(root.innerHTML).toBe('<p title="t">own</p>');
  });

  it('fills refs', () => {
    const ref = createRef<HTMLInputElement>();
    let callbackEl: HTMLInputElement | undefined;
    const root = render(() => (
      <div>
        <input ref={ref} />
        <input ref={(el) => (callbackEl = el)} />
      </div>
    ));
    const inputs = root.querySelectorAll('input');
    expect(ref.current).toBe(inputs[0]);
    expect(callbackEl).toBe(inputs[1]);
  });
});

describe('JSX events', () => {
  it('handles delegated events', async () => {
    const onClick = vi.fn();
    const root = render(() => <button onClick={onClick}>go</button>);
    await userEvent.click(within(root).getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('passes bound data with the array form', async () => {
    const onClick = vi.fn();
    const root = render(() => <button onClick={[onClick, 42]}>go</button>);
    await userEvent.click(within(root).getByRole('button'));
    expect(onClick).toHaveBeenCalledWith(42, expect.any(MouseEvent));
  });

  it('bubbles delegated events to ancestors until stopped', async () => {
    const outer = vi.fn();
    const inner = vi.fn((e: MouseEvent) => e.stopPropagation());
    const root = render(() => (
      <div onClick={outer}>
        <button onClick={inner}>stop</button>
        <span>pass</span>
      </div>
    ));

    await userEvent.click(within(root).getByText('stop'));
    expect(outer).not.toHaveBeenCalled();

    await userEvent.click(within(root).getByText('pass'));
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it('attaches non-delegated on: handlers directly', () => {
    const handler = vi.fn();
    const root = render(() => <div on:custom={handler} />);
    root.querySelector('div')!.dispatchEvent(new CustomEvent('custom'));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('JSX components', () => {
  it('calls function components with reactive props', () => {
    const name = new Signal('Ada');
    const Greeting = (props: { name: string }) => <p>Hello {props.name}</p>;
    const root = render(() => <Greeting name={name.value} />);
    expect(root.textContent).toBe('Hello Ada');

    name.value = 'Grace';
    settle();
    expect(root.textContent).toBe('Hello Grace');
  });

  it('passes children', () => {
    const Card = (props: { children?: JSX.Element }) => (
      <section>{props.children}</section>
    );
    const root = render(() => (
      <Card>
        <p>body</p>
      </Card>
    ));
    expect(root.querySelector('section > p')?.textContent).toBe('body');
  });

  it('renders class components and runs setup', () => {
    const setup = vi.fn();
    class Badge extends Component<{ label: string }> {
      protected setup(): void {
        setup();
      }
      protected render(): RenderResult {
        return (<span class="badge">{this.props.label}</span>) as RenderResult;
      }
    }

    const root = render(() => <Badge label="new" />);
    expect(root.querySelector('.badge')?.textContent).toBe('new');
    expect(setup).toHaveBeenCalledTimes(1);
  });

  it('runs onCleanup of a class component when its parent unmounts', () => {
    const cleanup = vi.fn();
    class Child extends Component {
      protected setup(): void {
        onCleanup(cleanup);
      }
      protected render(): RenderResult {
        return (<i>child</i>) as RenderResult;
      }
    }
    class Parent extends Component {
      protected render(): RenderResult {
        return (
          <div>
            <Child />
          </div>
        ) as RenderResult;
      }
    }

    const { unmount } = mount(Parent);
    unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('keeps a component in a binding when a signal it read changes', () => {
    const show = new Signal(true);
    const count = new Signal(0);
    let fnRuns = 0;
    let classRuns = 0;
    function Counter() {
      fnRuns++;
      const at = count.value;
      return <p>{at}</p>;
    }
    class Label extends Component {
      private start = count.value;
      protected render(): RenderResult {
        classRuns++;
        const at = count.value;
        return (<i>{this.start + at}</i>) as RenderResult;
      }
    }
    render(() => (
      <div>
        {show.value && <Counter />}
        {show.value && <Label />}
      </div>
    ));

    count.value = 1;
    settle();
    expect(fnRuns).toBe(1);
    expect(classRuns).toBe(1);
  });

  it('accepts accessors typed with Accessor', () => {
    const count = new Signal(2);
    const Doubled = (props: { value: Accessor<number> }) => (
      <b>{props.value() * 2}</b>
    );
    const root = render(() => <Doubled value={() => count.value} />);
    expect(root.textContent).toBe('4');

    count.value = 5;
    settle();
    expect(root.textContent).toBe('10');
  });
});

describe('JSX control flow', () => {
  it('renders Show and For', () => {
    const visible = new Signal(false);
    const items = new Signal(['a']);
    const root = render(() => (
      <div>
        <Show when={visible.value} fallback={<i>hidden</i>}>
          {() => <b>shown</b>}
        </Show>
        <ul>
          <For each={items.value}>{(item: string) => <li>{item}</li>}</For>
        </ul>
      </div>
    ));
    settle();
    expect(root.querySelector('i')?.textContent).toBe('hidden');
    expect(root.querySelectorAll('li')).toHaveLength(1);

    visible.value = true;
    items.value = ['a', 'b', 'c'];
    settle();
    expect(root.querySelector('b')?.textContent).toBe('shown');
    expect(root.querySelectorAll('li')).toHaveLength(3);
  });

  it('builds only the Match that shows, once', () => {
    const built: string[] = [];
    const Page = (props: { name: string }) => {
      built.push(props.name);
      return <p>{props.name}</p>;
    };
    const tab = new Signal(1);
    const root = render(() => (
      <div>
        <Switch fallback={<i>none</i>}>
          <Match when={tab.value === 1}>
            <Page name="one" />
          </Match>
          <Match when={tab.value === 2}>
            <Page name="two" />
          </Match>
        </Switch>
      </div>
    ));
    expect(root.textContent).toBe('one');

    tab.value = 3;
    settle();
    expect(root.textContent).toBe('none');
    tab.value = 2;
    settle();
    expect(root.textContent).toBe('two');
    expect(built).toEqual(['one', 'two']);
  });

  it('keeps events on node children of Show', async () => {
    const onClick = vi.fn();
    const root = render(() => (
      <div>
        <Show when={true}>
          <button onClick={onClick}>x</button>
        </Show>
      </div>
    ));
    settle();
    await userEvent.click(within(root).getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('keeps events on function children of Show', async () => {
    const onClick = vi.fn();
    const root = render(() => (
      <div>
        <Show when={true}>{() => <button onClick={onClick}>x</button>}</Show>
      </div>
    ));
    settle();
    await userEvent.click(within(root).getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('JSX Shadow DOM components', () => {
  it('renders into a shadow root', () => {
    class Widget extends Component {
      protected shadow = true;
      protected render(): RenderResult {
        return (<p class="inside">w</p>) as RenderResult;
      }
    }
    const root = render(() => (
      <div>
        <Widget />
      </div>
    ));
    const host = root.querySelector('[data-signy-shadow]');
    expect(host?.shadowRoot?.querySelector('.inside')).not.toBeNull();
  });

  it('delivers delegated events inside the shadow root', async () => {
    const onClick = vi.fn();
    class Widget extends Component {
      protected shadow = true;
      protected render(): RenderResult {
        return (<button onClick={onClick}>in shadow</button>) as RenderResult;
      }
    }
    const root = render(() => (
      <div>
        <Widget />
      </div>
    ));
    const host = root.querySelector('[data-signy-shadow]')!;
    await userEvent.click(host.shadowRoot!.querySelector('button')!);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('JSX class components render like h()', () => {
  it('renders every node of an array result', () => {
    class Pair extends Component {
      protected render(): RenderResult {
        return [<i>a</i>, <b>b</b>] as unknown as RenderResult;
      }
    }
    const root = render(() => (
      <div>
        <Pair />
      </div>
    ));
    expect(root.querySelector('div')!.innerHTML).toBe('<i>a</i><b>b</b>');
  });

  it('forwards on* props to the shadow host for composed events', () => {
    const onPing = vi.fn();
    class Widget extends Component {
      protected shadow = true;
      protected setup(): void {
        this.onMount(() => {
          this.emit('ping');
        });
      }
      protected render(): RenderResult {
        return (<p>w</p>) as RenderResult;
      }
    }
    render(() => (
      <div>
        <Widget onping={onPing} />
      </div>
    ));
    expect(onPing).toHaveBeenCalledTimes(1);
  });
});

describe('JSX shadow components and event props', () => {
  it('runs a forwarded onClick once, and hears emit() through a prop', () => {
    let clicks = 0;
    const heard: number[] = [];
    let rating!: Rating;
    class Rating extends Component<{
      onClick?: () => void;
      onRate?: (event: CustomEvent<number>) => void;
    }> {
      protected shadow = true;
      protected setup(): void {
        rating = this;
      }
      rate(): void {
        this.emit('rate', 4);
      }
      protected render(): RenderResult {
        return (
          <button onClick={() => this.props.onClick?.()}>go</button>
        ) as RenderResult;
      }
    }
    const root = render(() => (
      <div>
        <Rating
          onClick={() => clicks++}
          onRate={(event) => heard.push(event.detail)}
        />
      </div>
    ));
    const host = root.querySelector('signy-rating')!;
    host.shadowRoot!.querySelector('button')!.click();
    rating.rate();
    expect(clicks).toBe(1);
    expect(heard).toEqual([4]);
  });
});

describe('JSX class component lifecycle', () => {
  it('runs this.onMount() and its cleanup, like html children', () => {
    const events: string[] = [];
    let instance: Component | undefined;
    class Widget extends Component {
      protected setup(): void {
        instance = this;
        this.onMount(() => {
          events.push('mount');
          return () => events.push('cleanup');
        });
      }
      protected render(): RenderResult {
        return (<i>w</i>) as RenderResult;
      }
    }
    class Parent extends Component {
      protected render(): RenderResult {
        return (
          <div>
            <Widget />
          </div>
        ) as RenderResult;
      }
    }

    const { unmount } = mount(Parent);
    expect(events).toEqual(['mount']);
    expect(instance?.isMounted).toBe(true);

    unmount();
    expect(events).toEqual(['mount', 'cleanup']);
  });
});

describe('JSX directives and Dynamic', () => {
  it('keeps the props of a component Dynamic renders live', () => {
    const title = new Signal('a');
    class Title extends Component<{ title: string }> {
      protected render(): RenderResult {
        return (<p>{this.props.title}</p>) as RenderResult;
      }
    }
    const root = render(() => (
      <div>
        <Dynamic component={Title} title={title.value} />
      </div>
    ));
    title.value = 'b';
    settle();
    expect(root.textContent).toBe('b');
  });

  it('gives Dynamic children the context of the component it renders', () => {
    const Theme = createContext('default');
    class Provider extends Component<{ children?: JSX.Element }> {
      protected setup(): void {
        Theme.provide(this, 'dark');
      }
      protected render(): RenderResult {
        return (<section>{this.props.children}</section>) as RenderResult;
      }
    }
    class Consumer extends Component {
      protected render(): RenderResult {
        return (<p>{Theme.inject(this)}</p>) as RenderResult;
      }
    }
    const root = render(() => (
      <div>
        <Dynamic component={Provider}>
          <Consumer />
        </Dynamic>
      </div>
    ));
    expect(root.textContent).toBe('dark');
  });

  it('binds an input with use:bind', () => {
    const name = new Signal('Ada');
    const done = new Signal(false);
    const root = render(() => (
      <div>
        <input use:bind={name} />
        <input type="checkbox" use:bind={done} />
      </div>
    ));
    const [text, box] = Array.from(root.querySelectorAll('input'));
    expect(text!.value).toBe('Ada');
    text!.value = 'Lin';
    text!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(name.value).toBe('Lin');
    box!.checked = true;
    box!.dispatchEvent(new Event('change', { bubbles: true }));
    expect(done.value).toBe(true);
  });

  it('runs a custom use: directive', () => {
    const tooltip = (el: Element, accessor: () => unknown) => {
      el.setAttribute('title', String(accessor()));
    };
    void tooltip;
    const root = render(() => <p use:tooltip="Hello">text</p>);
    expect(root.querySelector('p')!.getAttribute('title')).toBe('Hello');
  });

  it('keeps getter props reactive on a Dynamic tag', () => {
    const label = new Signal('a');
    const root = render(() => (
      <Dynamic component="p" title={label.value}>
        hi
      </Dynamic>
    ));
    expect(root.querySelector('p')!.title).toBe('a');
    label.value = 'b';
    settle();
    expect(root.querySelector('p')!.title).toBe('b');
  });

  it('swaps a Dynamic component from a signal', () => {
    const tag = new Signal('h1');
    const root = render(() => (
      <Dynamic component={() => tag.value}>title</Dynamic>
    ));
    expect(root.querySelector('h1')!.textContent).toBe('title');
    tag.value = 'h2';
    settle();
    expect(root.querySelector('h2')!.textContent).toBe('title');
    expect(root.querySelector('h1')).toBeNull();
  });
});
