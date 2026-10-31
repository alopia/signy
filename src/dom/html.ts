/**
 * HTML Sanitization Utilities
 *
 * Provides utilities for HTML string manipulation, escaping, and sanitization.
 * Essential for preventing XSS attacks when working with user-generated content.
 *
 * @module dom/html
 *
 * @example
 * ```typescript
 * import { escapeHtml, stripHtml, sanitizeHtml } from 'signy';
 *
 * // Escape user input for safe display
 * const safeText = escapeHtml(userInput);
 *
 * // Strip HTML tags to get plain text
 * const plainText = stripHtml('<div>Hello <b>World</b></div>');
 *
 * // Sanitize while allowing specific tags
 * const safe = sanitizeHtml(html, ['b', 'i', 'a']);
 * ```
 *
 * ## Known limitations
 *
 * None.
 */

/**
 * Parses HTML into an inert fragment. Scripts, images and handlers in a
 * template's content never run or load.
 */
function parseInert(html: string): DocumentFragment {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content;
}

/** Elements without content or a closing tag */
const VOID_TAGS = new Set(['br', 'hr', 'wbr', 'img', 'col', 'area', 'source']);

/** Elements whose contents are code or markup, never text to show */
const RAW_CONTENT = new Set([
  'script',
  'style',
  'template',
  'noscript',
  'iframe',
  'object',
  'embed',
]);

/** The text of a fragment, without the contents of RAW_CONTENT elements */
function visibleText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (
    node.nodeType === Node.ELEMENT_NODE &&
    RAW_CONTENT.has((node as Element).tagName.toLowerCase())
  ) {
    return '';
  }
  let text = '';
  for (const child of Array.from(node.childNodes)) text += visibleText(child);
  return text;
}

const HTML_SPECIAL = /[&<>"']/g;

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escapes HTML special characters to prevent XSS attacks.
 * Converts dangerous characters to their HTML entity equivalents.
 *
 * @param value - Value to escape (any type will be converted to string)
 * @returns Escaped string, safe in text and in quoted attribute values
 *
 * @example
 * ```typescript
 * escapeHtml('<script>alert("xss")</script>');
 * // Returns: '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
 *
 * escapeHtml('Hello & goodbye');
 * // Returns: 'Hello &amp; goodbye'
 *
 * escapeHtml(null);
 * // Returns: ''
 * ```
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(HTML_SPECIAL, (char) => HTML_ESCAPES[char]!);
}

/**
 * Unescapes HTML entities back to their original characters.
 * Reverse operation of escapeHtml().
 *
 * @param value - HTML string with entities to unescape
 * @returns Unescaped string
 *
 * @example
 * ```typescript
 * unescapeHtml('&lt;div&gt;Hello&lt;/div&gt;');
 * // Returns: '<div>Hello</div>'
 *
 * unescapeHtml('Hello &amp; goodbye');
 * // Returns: 'Hello & goodbye'
 * ```
 */
export function unescapeHtml(value: string): string {
  if (!value) return '';

  // The parser turns a carriage return into a line feed and drops NUL. A
  // numeric reference keeps the carriage return, and NUL is split out.
  return value
    .split('\u0000')
    .map((part) => parseInert(part.replace(/\r/g, '&#13;')).textContent || '')
    .join('\u0000');
}

/**
 * Strips all HTML tags from a string, leaving only text content.
 * Useful for sanitizing user input or extracting plain text.
 *
 * @param html - HTML string to strip
 * @returns Plain text without HTML tags
 *
 * @example
 * ```typescript
 * stripHtml('<div>Hello <strong>World</strong></div>');
 * // Returns: 'Hello World'
 *
 * stripHtml('<script>alert("xss")</script>Text');
 * // Returns: 'Text'
 * ```
 */
export function stripHtml(html: string): string {
  if (!html) return '';

  return visibleText(parseInert(html));
}

/**
 * Sanitizes HTML by escaping and optionally allowing specific safe tags.
 * More flexible than escapeHtml() for rich text scenarios.
 *
 * @param html - HTML string to sanitize
 * @param allowedTags - Array of tag names to preserve (e.g., ['b', 'i', 'a'])
 * @returns Sanitized HTML string
 *
 * @example
 * ```typescript
 * sanitizeHtml('<div>Hello <script>alert("xss")</script></div>');
 * // Returns: '&lt;div&gt;Hello &lt;script&gt;alert("xss")&lt;/script&gt;&lt;/div&gt;'
 *
 * sanitizeHtml('<div>Hello <b>World</b></div>', ['b', 'i']);
 * // Returns: 'Hello <b>World</b>' (div stripped, b preserved)
 * ```
 */
export function sanitizeHtml(html: string, allowedTags: string[] = []): string {
  if (!html) return '';

  if (allowedTags.length === 0) {
    return escapeHtml(html);
  }

  const root = parseInert(html);
  // Tags match lowercased, and raw content tags are never kept: their
  // escaped text would still run as code inside them
  const allowed = new Set(
    allowedTags
      .map((tag) => tag.toLowerCase())
      .filter((tag) => !RAW_CONTENT.has(tag))
  );

  const sanitize = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return escapeHtml(node.textContent);
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      const tagName = element.tagName.toLowerCase();

      // Script and style contents are code, not text to keep
      if (RAW_CONTENT.has(tagName)) return '';

      if (allowed.has(tagName)) {
        if (VOID_TAGS.has(tagName)) return `<${tagName}>`;
        const children = Array.from(element.childNodes)
          .map((child) => sanitize(child))
          .join('');
        return `<${tagName}>${children}</${tagName}>`;
      }

      return Array.from(element.childNodes)
        .map((child) => sanitize(child))
        .join('');
    }

    return '';
  };

  return Array.from(root.childNodes)
    .map((child) => sanitize(child))
    .join('');
}
