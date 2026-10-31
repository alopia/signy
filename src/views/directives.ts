/**
 * Directives and two way bindings for h() and html.
 *
 * `use:name=${directive}` runs a directive on the element. `bind:value=${signal}`
 * and `bind:checked=${signal}` keep a form control and a signal in sync. The
 * JSX compiler has no `bind:`, so JSX uses the `bind` directive:
 * `<input use:bind={signal} />`.
 *
 * @module views/directives
 *
 * ## Known limitations
 *
 * - A binding supports `value` and `checked`. Radio groups and `<select multiple>`
 *   are not covered.
 */

import { getOwner, onCleanup } from '../reactivity/effect';
import { renderEffect } from '../reactivity/render';
import { untrack } from '../reactivity/signal/subtle';
import { logger } from '../log';
import { ViewLogMessages } from './log-messages';

/** What a binding writes to: a Signal, or anything with a writable `value` */
export interface BindTarget<T = unknown> {
  value: T;
}

/**
 * Props that write a property which depends on the rest of the element: a
 * select value needs its options, a range value its limits. They run after the
 * children and the other props, in the order they were written.
 */
export function isLateProp(key: string): boolean {
  // b, u and p start every one of them, so most keys stop at the first check
  const first = key.charCodeAt(0);
  if (first !== 98 && first !== 117 && first !== 112) return false;
  return (
    key.startsWith('bind:') ||
    key.startsWith('use:') ||
    key === 'prop:value' ||
    key === 'prop:selectedIndex'
  );
}

/** The form control properties a binding can keep in sync */
export type BindProperty = 'value' | 'checked';

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function isBindTarget(target: unknown): target is BindTarget {
  return typeof target === 'object' && target !== null && 'value' in target;
}

/** Number inputs bind to a number, `null` while the field is empty or invalid */
function isNumeric(control: Control): boolean {
  return control.type === 'number' || control.type === 'range';
}

/**
 * Runs a directive on an element, untracked. The value is the directive
 * function, or `[directive, argument]`. The directive receives the element and
 * an accessor for the argument; a function argument is that accessor.
 */
export function applyDirective(element: Element, value: unknown): void {
  const [directive, argument] = Array.isArray(value) ? value : [value];
  if (typeof directive !== 'function') {
    if (__DEV__) logger.warn(ViewLogMessages.INVALID_DIRECTIVE);
    return;
  }
  const accessor =
    typeof argument === 'function'
      ? (argument as () => unknown)
      : () => argument;
  untrack(() =>
    (directive as (el: Element, a: () => unknown) => void)(element, accessor)
  );
}

/**
 * Keeps one property of a form control and a target in sync. The control is
 * only written when its value differs, so typing never moves the caret.
 */
export function bindControl(
  element: Element,
  property: string,
  target: unknown
): void {
  if (
    (property !== 'value' && property !== 'checked') ||
    !isBindTarget(target)
  ) {
    if (__DEV__) logger.warn(ViewLogMessages.INVALID_BINDING, { property });
    return;
  }
  const control = element as Control;
  const checked = property === 'checked';
  const event = checked || control.localName === 'select' ? 'change' : 'input';

  control.addEventListener(event, () => {
    const input = control as HTMLInputElement;
    if (checked) {
      target.value = input.checked;
    } else if (isNumeric(control)) {
      target.value = Number.isNaN(input.valueAsNumber)
        ? null
        : input.valueAsNumber;
    } else {
      target.value = control.value;
    }
  });

  renderEffect(() => {
    const value = target.value;
    const input = control as HTMLInputElement;
    if (checked) {
      input.checked = Boolean(value);
    } else if (isNumeric(control) && typeof value === 'number') {
      if (input.valueAsNumber !== value) input.valueAsNumber = value;
    } else {
      const text = value == null ? '' : String(value);
      if (control.value !== text) control.value = text;
    }
  });

  // Options that arrive after the binding ran, from a fetch or a list that
  // renders later, are selected once they are there
  if (!checked && control.localName === 'select') {
    const observer = new MutationObserver(() => {
      const value = untrack(() => target.value);
      const text = value == null ? '' : String(value);
      if (control.value !== text) control.value = text;
    });
    observer.observe(control, { childList: true, subtree: true });
    if (getOwner()) onCleanup(() => observer.disconnect());
  }
}

/**
 * The `bind` directive, for JSX where `bind:` does not compile. The argument
 * is a signal, bound to `checked` on a checkbox and to `value` elsewhere, or
 * `[signal, 'value' | 'checked']` to pick the property.
 *
 * @example
 * ```tsx
 * <input use:bind={name} />
 * <input type="checkbox" use:bind={done} />
 * <input type="checkbox" use:bind={[done, 'checked']} />
 * ```
 */
export function bind(element: Element, accessor: () => unknown): void {
  const argument = accessor();
  if (Array.isArray(argument)) {
    bindControl(element, argument[1] as string, argument[0]);
  } else {
    const checkbox = (element as HTMLInputElement).type === 'checkbox';
    bindControl(element, checkbox ? 'checked' : 'value', argument);
  }
}
