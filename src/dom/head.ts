/**
 * Document head management.
 *
 * `useHead()` sets the title, `<meta>` and `<link>` tags from a component or
 * any owner, and puts the page back when the owner is disposed. Several
 * calls stack: the latest wins per title and per tag, and removing it brings
 * the previous one back, so a layout sets defaults and a page overrides them.
 *
 * @module dom/head
 *
 * ## Known limitations
 *
 * - Client side only. A crawler that does not run scripts sees the tags in
 *   the HTML file.
 * - A tag is matched by `name`, `property`, `http-equiv`, `itemprop` or
 *   `charset` for `<meta>`, and by `rel` and `href` for `<link>` (`rel`
 *   alone for `canonical` and `manifest`). Other tags are not deduplicated.
 */

import { createRenderEffect } from '../reactivity/render';
import { onCleanup } from '../reactivity/effect';
import { DATA_ATTR_HEAD } from '../constants';
import { logger } from '../log';
import { ViewLogMessages } from '../views/log-messages';
import { isUnsafeAttribute } from './unsafe-attribute';

/** The attributes of one `<meta>` or `<link>` tag. A missing value is skipped. */
export type HeadTag = Record<string, string | null | undefined>;

export interface HeadInput {
  /** The document title */
  title?: string;
  /** Wraps the winning title: a string with `%s`, or a function */
  titleTemplate?: string | ((title: string) => string);
  meta?: HeadTag[];
  link?: HeadTag[];
}

interface WantedTag {
  tag: 'meta' | 'link';
  attrs: Record<string, string>;
}

/** A tag in the document that useHead() writes to */
interface AppliedTag {
  element: Element;
  /** Attributes useHead() wrote, to remove or restore them later */
  written: Set<string>;
  /** Attributes of a tag that was already in the page, null for one we made */
  original: Map<string, string> | null;
}

/** In call order: later entries win */
const entries: { input: HeadInput }[] = [];
const applied = new Map<string, AppliedTag>();
/** The title before the first override, null while none is active */
let originalTitle: string | null = null;

const KEY_ATTRS = ['name', 'property', 'http-equiv', 'itemprop', 'charset'];
const SINGLE_LINKS = new Set(['canonical', 'manifest']);

function tagKey(tag: string, attrs: Record<string, string>): string | null {
  if (tag === 'meta') {
    for (const name of KEY_ATTRS) {
      if (name in attrs)
        return `meta:${name}:${name === 'charset' ? '' : attrs[name]}`;
    }
    return null;
  }
  const rel = attrs['rel'];
  if (!rel) return null;
  if (SINGLE_LINKS.has(rel)) return `link:${rel}`;
  return `link:${rel}:${attrs['href'] ?? ''}:${attrs['hreflang'] ?? ''}`;
}

function attributesOf(element: Element): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const { name, value } of Array.from(element.attributes)) {
    attrs[name] = value;
  }
  return attrs;
}

function applyTitle(): void {
  let title: string | undefined;
  let template: HeadInput['titleTemplate'];
  for (const { input } of entries) {
    if (input.title !== undefined) title = input.title;
    if (input.titleTemplate !== undefined) template = input.titleTemplate;
  }
  if (title === undefined) {
    if (originalTitle !== null) {
      document.title = originalTitle;
      originalTitle = null;
    }
    return;
  }
  originalTitle ??= document.title;
  document.title =
    typeof template === 'function'
      ? template(title)
      : template
        ? template.replace('%s', () => title)
        : title;
}

function wantedTags(): Map<string, WantedTag> {
  const wanted = new Map<string, WantedTag>();
  let loose = 0;
  for (const { input } of entries) {
    for (const tag of ['meta', 'link'] as const) {
      for (const source of input[tag] ?? []) {
        const attrs: Record<string, string> = {};
        for (const name in source) {
          const value = source[name];
          if (value === undefined || value === null) continue;
          if (isUnsafeAttribute(name, value)) {
            if (__DEV__)
              logger.warn(ViewLogMessages.UNSAFE_ATTRIBUTE, { name });
            continue;
          }
          attrs[name] = value;
        }
        wanted.set(tagKey(tag, attrs) ?? `${tag}:loose:${loose++}`, {
          tag,
          attrs,
        });
      }
    }
  }
  return wanted;
}

/** Takes a matching tag that is already in the page, or makes one */
function acquire(key: string, { tag, attrs }: WantedTag): AppliedTag {
  const existing = Array.from(document.head.querySelectorAll(tag)).find(
    (element) =>
      !element.hasAttribute(DATA_ATTR_HEAD) &&
      tagKey(tag, attributesOf(element)) === key
  );
  if (existing) {
    return {
      element: existing,
      written: new Set(),
      original: new Map(Object.entries(attributesOf(existing))),
    };
  }
  const element = document.createElement(tag);
  element.setAttribute(DATA_ATTR_HEAD, '');
  document.head.appendChild(element);
  return { element, written: new Set(Object.keys(attrs)), original: null };
}

function write(entry: AppliedTag, attrs: Record<string, string>): void {
  for (const name of entry.written) {
    if (name in attrs) continue;
    const before = entry.original?.get(name);
    if (before === undefined) entry.element.removeAttribute(name);
    else entry.element.setAttribute(name, before);
    entry.written.delete(name);
  }
  for (const name in attrs) {
    if (entry.element.getAttribute(name) !== attrs[name]) {
      entry.element.setAttribute(name, attrs[name]!);
    }
    entry.written.add(name);
  }
}

function release(entry: AppliedTag): void {
  if (!entry.original) {
    entry.element.remove();
    return;
  }
  write(entry, {});
}

function apply(): void {
  applyTitle();
  const wanted = wantedTags();
  for (const [key, entry] of applied) {
    if (wanted.has(key)) continue;
    release(entry);
    applied.delete(key);
  }
  for (const [key, want] of wanted) {
    let entry = applied.get(key);
    if (!entry) {
      entry = acquire(key, want);
      applied.set(key, entry);
    }
    write(entry, want.attrs);
  }
}

/**
 * Sets the document title and head tags for as long as the current owner
 * lives. Pass a function to follow signals: it re-runs when they change.
 *
 * @example
 * ```typescript
 * class Inbox extends Component {
 *   private unread = new Signal(3);
 *
 *   protected setup(): void {
 *     useHead(() => ({
 *       title: `Inbox (${this.unread.value})`,
 *       meta: [{ name: 'description', content: 'Your messages' }],
 *     }));
 *   }
 * }
 * ```
 */
export function useHead(input: HeadInput | (() => HeadInput)): void {
  const entry = { input: {} as HeadInput };
  entries.push(entry);
  createRenderEffect(() => {
    entry.input = typeof input === 'function' ? input() : input;
    apply();
  });
  onCleanup(() => {
    const index = entries.indexOf(entry);
    if (index !== -1) entries.splice(index, 1);
    apply();
  });
}
