/**
 * Tagged template function for JSX-like syntax without compilation
 * Built on htm library by Preact team
 *
 * The first call of a template builds its static parts once. Each call then
 * clones them and fills in the values, so a row of a list costs one
 * cloneNode() instead of one h() per element. A template with a component
 * tag, a tag or xmlns from a value, a spread or a value inside an attribute
 * string renders through h().
 *
 * @module views/html
 *
 * ## Known limitations
 *
 * None.
 */

import htm from 'htm';
import {
  applyProp,
  childrenInSvg,
  createTagElement,
  hLazy,
  inSvgNamespace,
} from './hyperscript';
import { isLateProp } from './directives';
import { insert } from './insert';
import { DELEGATED_EVENTS, delegateEvent } from './events';
import { unescapeHtml } from '../dom/html';
import { setBounded } from '../utils/bounded-cache';

//=============================================
// Template compiling
//=============================================

/** Marks a value position while a template is described */
const HOLE = Symbol('hole');

/** What a hole turns into inside a string, so a mixed attribute is found */
const HOLE_TEXT = '\u0000hole\u0000';

interface Hole {
  [HOLE]: number;
}

/** Brands what describe() returns, so a value from the page is never one */
const DESCRIBED = Symbol('described');

/** One element as htm sees it, with holes in place of the values */
interface Described {
  [DESCRIBED]: true;
  type: unknown;
  props: Record<string | symbol, unknown> | null;
  children: unknown[];
}

function describe(
  this: unknown[],
  type: unknown,
  props: Record<string, unknown> | null,
  ...children: unknown[]
): Described {
  // htm would cache a fully static template, and reuse its nodes
  this[0] = 3;
  // A plain string here is the template's own text: values arrive wrapped
  if (props) {
    for (const key in props) props[key] = decode(props[key]);
  }
  return { [DESCRIBED]: true, type, props, children: children.map(decode) };
}

const decoded = new Map<string, string>();

const CHARACTER_REFERENCE = /&(?:#\d+|#x[\da-f]+|[a-z][\da-z]*);?/gi;

/** Decodes the character references of template text, as HTML does */
function decode(value: unknown): unknown {
  if (typeof value !== 'string' || !value.includes('&')) return value;
  let text = decoded.get(value);
  if (text === undefined) {
    // Each reference alone, so text such as "a <b> c" stays as written
    text = value.replace(CHARACTER_REFERENCE, (ref) => unescapeHtml(ref));
    setBounded(decoded, value, text);
  }
  return text;
}

const describeTemplate = htm.bind(describe);

/** Marks a wrapped function or string, so a mixed attribute can find it after htm */
const FN = Symbol('fn');
const FN_MARK = '\u0000fn';
const FN_SPLIT = /\u0000fn(\d+)\u0000/;

interface FnRef {
  [FN]: unknown;
}

/**
 * Wraps functions, which htm would join as source text, and strings, which
 * would read as the template's own text and be decoded. Alone, a value comes
 * back as the wrapper and is unwrapped. Inside a quoted attribute, htm joins
 * its toString() marker.
 */
function wrapValues(values: unknown[], fns: unknown[]): unknown[] {
  return values.map((value) => {
    if (typeof value !== 'function' && typeof value !== 'string') return value;
    const index = fns.push(value) - 1;
    return { [FN]: value, toString: () => `${FN_MARK}${index}\u0000` };
  });
}

/** What `html` returns: the root, or the roots of a template with several */
type HtmlResult = Element | DocumentFragment;

/**
 * Builds a described template top down, for one the fast path cannot take. A
 * component gets its children built on demand, under it, as JSX does.
 */
function materialize(value: unknown, fns: unknown[], inSvg = false): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => materialize(item, fns, inSvg));
  }
  if (typeof value !== 'object' || value === null) return value;
  if (FN in value) return (value as FnRef)[FN];
  if (!(DESCRIBED in value)) return value;
  const described = value as Described;
  const type = materialize(described.type, fns) as string;
  let props = described.props && materializeProps(described.props, fns);
  // An element's namespace is known here, before its children are built
  let svgChildren = false;
  if (typeof type === 'string') {
    if (inSvg) props = inSvgNamespace(props);
    svgChildren = childrenInSvg(type, props, inSvg);
  }
  const { children } = described;
  return hLazy(
    type,
    props,
    children.length > 0
      ? () => children.map((child) => materialize(child, fns, svgChildren))
      : null
  );
}

function materializeProps(
  props: Record<string | symbol, unknown>,
  fns: unknown[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    const value = props[key];
    out[key] =
      typeof value === 'string' && value.includes(FN_MARK)
        ? mixedValue(value, fns)
        : materialize(value, fns);
  }
  return out;
}

/**
 * A mixed attribute with a function in it, `class="a ${() => x}"`: htm joined
 * the parts as text, so the marker of each function is read back and the
 * joined value is bound
 */
function mixedValue(text: string, fns: unknown[]): string | (() => string) {
  const parts = text.split(FN_SPLIT);
  const join = (): string => {
    let out = '';
    for (let i = 0; i < parts.length; i++) {
      // Odd parts are the index of a value
      if (i % 2 === 0) {
        out += parts[i];
      } else {
        const value = fns[Number(parts[i])];
        out += String((typeof value === 'function' ? value() : value) ?? '');
      }
    }
    return out;
  };
  // A binding only when a function is among the parts
  for (let i = 1; i < parts.length; i += 2) {
    if (typeof fns[Number(parts[i])] === 'function') return join;
  }
  return join();
}

const enum SlotKind {
  PROP,
  CHILD,
  /** A prop named like a delegated event, `$$click` precomputed */
  DELEGATED,
  /** A static prop the clone would lose, its value in `Template.consts` */
  STATIC,
}

/**
 * Where one value goes: a prop of the node at `node`, or a child of it
 * before the node at `marker` (-1 for the end). Both index `Template.paths`.
 */
interface Slot {
  kind: SlotKind;
  node: number;
  marker: number;
  key: string;
  hole: number;
}

interface Template {
  roots: Node[];
  consts: unknown[];
  /**
   * The slots for rendering, flat: kind, node, marker and hole per slot, and
   * the key in `keys` (the `$$name` property for a delegated event).
   */
  ops: number[];
  keys: string[];
  /** Event names of the DELEGATED slots, in `keys` order */
  events: string[];
  /** Child index paths from a root, the first entry picks the root */
  paths: number[][];
  /**
   * How to find each path's node: [parent path, child index] pairs, parent
   * -1 for a root. Parents come first, see order().
   */
  walk: number[];
  /** In the order h() would bind them: children first, then props */
  slots: Slot[];
}

/** Thrown while compiling a template that has to render through h() */
const FALLBACK = Symbol('fallback');

const templates = new WeakMap<TemplateStringsArray, Template | null>();

function isHole(value: unknown): value is Hole {
  return typeof value === 'object' && value !== null && HOLE in value;
}

function compile(strings: TemplateStringsArray): Template | null {
  const holes = Array.from({ length: strings.length - 1 }, (_, i) => ({
    [HOLE]: i,
    toString: () => HOLE_TEXT,
  }));
  const described = describeTemplate(strings, ...holes) as unknown;
  const list = Array.isArray(described) ? described : [described];

  const template: Template = {
    roots: [],
    consts: [],
    ops: [],
    keys: [],
    events: [],
    paths: [],
    walk: [],
    slots: [],
  };
  try {
    list.forEach((root, i) => template.roots.push(build(template, root, [i])));
  } catch (error) {
    if (error === FALLBACK) return null;
    throw error;
  }
  order(template);
  flatten(template);
  return template;
}

/** Fills `ops`, `keys` and `events` from the slots, once per template */
function flatten(template: Template): void {
  for (const { kind, node, marker, key, hole } of template.slots) {
    let op = kind;
    let opKey = key;
    if (
      kind === SlotKind.PROP &&
      !key.startsWith('on:') &&
      key.startsWith('on')
    ) {
      const name = key.slice(2).toLowerCase();
      if (DELEGATED_EVENTS.has(name)) {
        op = SlotKind.DELEGATED;
        opKey = `$$${name}`;
        template.events.push(name);
      }
    }
    template.ops.push(op, node, marker, hole);
    template.keys.push(opKey);
  }
}

/**
 * Sorts the paths so a parent comes before its children, renumbers the
 * slots to match, and fills `walk`.
 */
function order(template: Template): void {
  template.walk = [];
  const sorted = template.paths
    .map((path, i) => ({ path, i }))
    .sort((a, b) => a.path.length - b.path.length);
  const renumber: number[] = [];
  sorted.forEach(({ i }, to) => (renumber[i] = to));
  template.paths = sorted.map(({ path }) => path);
  for (const s of template.slots) {
    s.node = renumber[s.node]!;
    if (s.marker !== -1) s.marker = renumber[s.marker]!;
  }

  // Every prefix of a path is a path too, so the parent is always found
  const keys = template.paths.map((path) => path.join());
  for (const path of template.paths) {
    const parent =
      path.length === 1 ? -1 : keys.indexOf(path.slice(0, -1).join());
    if (path.length > 1 && parent === -1) {
      template.paths.push(path.slice(0, -1));
      return order(template);
    }
    template.walk.push(parent, path[path.length - 1]!);
  }
}

function build(
  template: Template,
  value: unknown,
  path: number[],
  inSvg = false
): Node {
  if (typeof value !== 'object' || value === null || isHole(value)) {
    throw FALLBACK;
  }
  const { type, props, children } = value as Described;
  if (typeof type !== 'string') throw FALLBACK;

  const staticProps: Record<string, unknown> = {};
  const propSlots: Slot[] = [];
  if (props) {
    // A spread copied the hole's own keys into the props
    if (HOLE in props) throw FALLBACK;
    for (const key in props) {
      const prop = props[key];
      if (isHole(prop)) {
        if (key === 'xmlns') throw FALLBACK;
        propSlots.push(slot(template, SlotKind.PROP, path, -1, key, prop));
      } else if (typeof prop === 'string' && prop.includes(HOLE_TEXT)) {
        throw FALLBACK;
      } else if (key.startsWith('prop:')) {
        // cloneNode() copies attributes, not properties, so each clone sets it
        const index = template.consts.push(prop) - 1;
        const hole = { [HOLE]: index };
        propSlots.push(slot(template, SlotKind.STATIC, path, -1, key, hole));
      } else {
        staticProps[key] = prop;
      }
    }
  }

  const element = createTagElement(
    type,
    inSvg ? inSvgNamespace(staticProps) : staticProps
  );
  const svgChildren = childrenInSvg(type, staticProps, inSvg);
  for (const key in staticProps) {
    applyProp(element, key, staticProps[key], true);
  }

  // A value goes before the next static child, so its index is known once
  // the children are built
  const pending: { hole: Hole; before: number }[] = [];
  let index = 0;
  for (const child of children) {
    if (isHole(child)) {
      pending.push({ hole: child, before: index });
      continue;
    }
    element.appendChild(
      typeof child === 'object' && child !== null
        ? build(template, child, [...path, index], svgChildren)
        : document.createTextNode(String(child))
    );
    index++;
  }

  // Bindings and directives come after the children, see isLateProp()
  template.slots.push(...propSlots.filter((s) => !isLateProp(s.key)));
  for (const { hole, before } of pending) {
    const marker = before < index ? pathIndex(template, [...path, before]) : -1;
    template.slots.push(slot(template, SlotKind.CHILD, path, marker, '', hole));
  }
  template.slots.push(...propSlots.filter((s) => isLateProp(s.key)));
  return element;
}

function slot(
  template: Template,
  kind: SlotKind,
  path: number[],
  marker: number,
  key: string,
  hole: Hole
): Slot {
  return {
    kind,
    node: pathIndex(template, path),
    marker,
    key,
    hole: hole[HOLE],
  };
}

function pathIndex(template: Template, path: number[]): number {
  const key = path.join();
  const found = template.paths.findIndex((p) => p.join() === key);
  return found === -1 ? template.paths.push(path) - 1 : found;
}

//=============================================
// Rendering
//=============================================

function instantiate(template: Template, values: unknown[]): unknown {
  const single = template.roots.length === 1;
  const root = single ? template.roots[0]!.cloneNode(true) : null;
  const roots = single
    ? null
    : template.roots.map((node) => node.cloneNode(true));

  // Find every node before any value moves the children around
  const { walk, ops, keys, events, consts } = template;
  const nodes = new Array<Node>(walk.length / 2);
  for (let i = 0; i < walk.length; i += 2) {
    const parent = walk[i]!;
    let index = walk[i + 1]!;
    if (parent === -1) {
      nodes[i / 2] = root ?? roots![index]!;
      continue;
    }
    let node = nodes[parent]!.firstChild!;
    while (index-- > 0) node = node.nextSibling!;
    nodes[i / 2] = node;
  }

  let event = 0;
  for (let i = 0, k = 0; i < ops.length; i += 4, k++) {
    const kind = ops[i]!;
    const node = nodes[ops[i + 1]!]!;
    const hole = ops[i + 3]!;
    const value = kind === SlotKind.STATIC ? consts[hole] : values[hole];
    if (kind === SlotKind.CHILD) {
      const marker = ops[i + 2]!;
      insert(node, value, marker === -1 ? null : nodes[marker]);
    } else if (kind === SlotKind.DELEGATED && typeof value === 'function') {
      (node as unknown as Record<string, unknown>)[keys[k]!] = value;
      delegateEvent(events[event++]!);
    } else {
      if (kind === SlotKind.DELEGATED) event++;
      applyProp(node as Element, template.slots[k]!.key, value, true);
    }
  }
  return root ?? roots;
}

/**
 * Tagged template function that provides JSX-like syntax without a build step.
 * Uses htm to parse the template. The static parts are built once and cloned,
 * see the module header.
 *
 * @example
 * ```typescript
 * import { html } from 'signy';
 *
 * // Simple elements
 * const greeting = html`<h1>Hello World</h1>`;
 *
 * // With variables
 * const name = 'Alice';
 * const message = html`<p>Hello ${name}</p>`;
 *
 * // With conditionals
 * const showBadge = true;
 * const card = html`
 *   <div class="card">
 *     <h2>${title}</h2>
 *     ${showBadge && html`<span class="badge">New</span>`}
 *   </div>
 * `;
 *
 * // With loops
 * const items = ['Apple', 'Banana', 'Cherry'];
 * const list = html`
 *   <ul>
 *     ${items.map(item => html`<li>${item}</li>`)}
 *   </ul>
 * `;
 *
 * // With components
 * class MyComponent extends Component {
 *   render() {
 *     return html`
 *       <div class="component">
 *         <${ChildComponent} prop=${value} />
 *       </div>
 *     `;
 *   }
 * }
 * ```
 */
export const html = ((strings: TemplateStringsArray, ...values: unknown[]) => {
  let template = templates.get(strings);
  if (template === undefined) {
    template = compile(strings);
    templates.set(strings, template);
  }
  if (template) return instantiate(template, values);
  const fns: unknown[] = [];
  return materialize(
    describeTemplate(strings, ...wrapValues(values, fns)),
    fns
  );
}) as (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => HtmlResult | HtmlResult[];
