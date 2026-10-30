/**
 * Attribute and URL checks shared by every place that writes an attribute
 * from a value: bindings, spreads, `setAttributeNS`, the dom helpers and
 * router links.
 *
 * @module dom/unsafe-attribute
 * @internal
 */

/** Attributes and properties a browser loads or navigates to */
const URL_NAMES = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'xlink:href',
  'poster',
  'data',
]);

/** Browsers ignore controls and spaces around and inside the scheme */
const CONTROLS = /[\u0000- ]/g;

const SCRIPT_SCHEME = /^(?:javascript|vbscript):/i;

/** data: URLs other than images can carry a document */
const DATA_SCHEME = /^data:(?!image\/)/i;

/**
 * Whether a URL would run script or load a document when followed.
 *
 * @internal
 */
export function isUnsafeUrl(value: string): boolean {
  const url = value.replace(CONTROLS, '');
  return SCRIPT_SCHEME.test(url) || DATA_SCHEME.test(url);
}

/**
 * Whether writing `value` to the attribute or property `name` can run
 * script: an `on*` handler from a string, `srcdoc` markup, or an unsafe URL.
 *
 * @internal
 */
export function isUnsafeAttribute(name: string, value: string): boolean {
  const lower = name.toLowerCase();
  if (lower.startsWith('on') || lower === 'srcdoc') return true;
  return URL_NAMES.has(lower) && isUnsafeUrl(value);
}
