/**
 * Custom elements from components.
 *
 * `defineElement('x-counter', Counter)` registers a custom element that mounts
 * a component when it is connected to the page and unmounts it when it is
 * removed. Each element is its own application, so it works in any page or
 * framework.
 *
 * @module app/define-element
 *
 * ## Known limitations
 *
 * - Props come from attributes (string, number or boolean) and from
 *   properties. A property does not reflect back to its attribute.
 * - A component with light DOM content adds its output after the children the
 *   element already has.
 */

import { construct } from '../component/component';
import { panic } from '../log';
import { Signal } from '../reactivity/signal';
import type { ComponentClass } from '../types';
import { application, type Application } from './application';
import { AppLogMessages } from './log-messages';

/** How an attribute turns into a prop */
export type AttributeType =
  StringConstructor | NumberConstructor | BooleanConstructor;

export interface DefineElementOptions {
  /**
   * The props to take from attributes and properties. A name alone is a
   * string, an object picks the type per prop. `maxItems` reads the
   * `max-items` attribute.
   */
  props?: readonly string[] | Record<string, AttributeType>;
  /** Runs for each element before its app mounts, to install plugins */
  setup?: (app: Application, element: HTMLElement) => void;
}

function toAttributeName(prop: string): string {
  return prop.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function toProp(value: string | null, type: AttributeType): unknown {
  if (type === Boolean) return value !== null;
  if (value === null) return undefined;
  return type === Number ? Number(value) : value;
}

/**
 * Registers a custom element that renders a component.
 *
 * A prop is a getter over a signal, so read it inside a binding to follow
 * changes: `${() => this.props.label}`. Events from `emit()` fire on the
 * element and cross the shadow boundary.
 *
 * @example
 * ```typescript
 * class Counter extends Component<{ start?: number }> {
 *   private count = new Signal(this.props.start ?? 0);
 *   protected render() {
 *     return html`<button onClick=${() => this.count.value++}>${() => this.count.value}</button>`;
 *   }
 * }
 *
 * defineElement('x-counter', Counter, { props: { start: Number } });
 * // <x-counter start="5"></x-counter>
 * ```
 *
 * @throws When a prop has the name of a property every element has, such as
 *   `title`, `id`, `hidden` or `children`. Pick another name.
 *
 * @returns The element class, as `customElements.define` got it
 */
export function defineElement(
  tag: string,
  component: ComponentClass,
  options: DefineElementOptions = {}
): CustomElementConstructor {
  const types = new Map<string, AttributeType>(
    Array.isArray(options.props)
      ? options.props.map((name): [string, AttributeType] => [name, String])
      : Object.entries(options.props ?? {})
  );
  // A prop is defined on the element, so one named like a native property,
  // title or id for example, would replace it
  for (const prop of types.keys()) {
    if (prop in HTMLElement.prototype) {
      panic(AppLogMessages.ELEMENT_RESERVED_PROP, { prop, tag });
    }
  }
  const attributes = new Map(
    [...types.keys()].map((prop) => [toAttributeName(prop), prop])
  );

  class SignyElement extends HTMLElement {
    static observedAttributes = [...attributes.keys()];

    /** @internal */
    readonly values = new Map<string, Signal<unknown>>();

    private _app: Application | null = null;

    constructor() {
      super();
      for (const prop of types.keys()) {
        const own = Object.getOwnPropertyDescriptor(this, prop);
        const initial = own
          ? own.value
          : types.get(prop) === Boolean
            ? false
            : undefined;
        this.values.set(prop, new Signal<unknown>(initial));
        // A property set before the element was defined shadows the accessor
        if (own) delete (this as unknown as Record<string, unknown>)[prop];
      }
    }

    attributeChangedCallback(
      name: string,
      _: string | null,
      value: string | null
    ) {
      const prop = attributes.get(name)!;
      this.values.get(prop)!.value = toProp(value, types.get(prop)!);
    }

    connectedCallback(): void {
      if (this._app) return;
      const props: Record<string, unknown> = {};
      for (const [prop, signal] of this.values) {
        Object.defineProperty(props, prop, {
          get: () => signal.value,
          enumerable: true,
        });
      }
      const root = construct(component, props);
      const app = application(root);
      options.setup?.(app, this);
      app.mount(this);
      // Only a mounted app is kept: one that threw has nothing to unmount, and
      // the element can mount again when it is connected next
      this._app = app;
    }

    disconnectedCallback(): void {
      // Moving the element disconnects and reconnects it in the same task
      queueMicrotask(() => {
        if (this.isConnected || !this._app) return;
        this._app.unmount();
        this._app = null;
      });
    }
  }

  for (const prop of types.keys()) {
    Object.defineProperty(SignyElement.prototype, prop, {
      get(this: SignyElement) {
        return this.values.get(prop)!.value;
      },
      set(this: SignyElement, value: unknown) {
        this.values.get(prop)!.value = value;
      },
    });
  }

  customElements.define(tag, SignyElement);
  return SignyElement;
}
