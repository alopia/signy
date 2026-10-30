/**
 * Tests for views/children module
 */

import { describe, it, expect } from 'vitest';
import {
  children,
  resolveChildren,
  flattenChildren,
  countChildren,
  isEmptyChildren,
  getElementChildren,
  mapChildren,
  elementChildren,
} from '../../src/views/children';
import { Signal, createRoot } from '../../src/reactivity';

// Helper to create a DOM element
function createElement(tag: string, textContent?: string): HTMLElement {
  const el = document.createElement(tag);
  if (textContent) {
    el.textContent = textContent;
  }
  return el;
}

describe('resolveChildren', () => {
  describe('basic types', () => {
    it('should resolve string children', () => {
      const result = resolveChildren('hello');
      expect(result).toEqual(['hello']);
    });

    it('should resolve number children', () => {
      const result = resolveChildren(42);
      expect(result).toEqual([42]);
    });

    it('should resolve Element children', () => {
      const div = createElement('div');
      const result = resolveChildren(div);
      expect(result).toEqual([div]);
    });

    it('should filter out null', () => {
      const result = resolveChildren(null);
      expect(result).toEqual([]);
    });

    it('should filter out undefined', () => {
      const result = resolveChildren(undefined);
      expect(result).toEqual([]);
    });

    it('should filter out boolean true', () => {
      const result = resolveChildren(true);
      expect(result).toEqual([]);
    });

    it('should filter out boolean false', () => {
      const result = resolveChildren(false);
      expect(result).toEqual([]);
    });
  });

  describe('arrays', () => {
    it('should flatten array children', () => {
      const result = resolveChildren(['a', 'b', 'c']);
      expect(result).toEqual(['a', 'b', 'c']);
    });

    it('should flatten nested arrays', () => {
      const result = resolveChildren(['a', ['b', ['c']]]);
      expect(result).toEqual(['a', 'b', 'c']);
    });

    it('should filter nullish from arrays', () => {
      const result = resolveChildren(['a', null, 'b', undefined, 'c']);
      expect(result).toEqual(['a', 'b', 'c']);
    });

    it('should handle mixed content', () => {
      const div = createElement('div');
      const result = resolveChildren(['text', div, 42, null, true]);
      expect(result).toEqual(['text', div, 42]);
    });
  });

  describe('functions', () => {
    it('should call function children', () => {
      const result = resolveChildren(() => 'hello');
      expect(result).toEqual(['hello']);
    });

    it('should handle nested functions', () => {
      const result = resolveChildren(() => () => 'nested');
      expect(result).toEqual(['nested']);
    });

    it('should handle functions returning arrays', () => {
      const result = resolveChildren(() => ['a', 'b']);
      expect(result).toEqual(['a', 'b']);
    });

    it('should handle functions returning null', () => {
      const result = resolveChildren(() => null);
      expect(result).toEqual([]);
    });
  });
});

describe('flattenChildren', () => {
  it('should flatten nested arrays', () => {
    const result = flattenChildren([1, [2, [3, 4]], 5]);
    expect(result).toEqual([1, 2, 3, 4, 5]);
  });

  it('should resolve functions while flattening', () => {
    const result = flattenChildren([1, () => [2, 3], 4]);
    expect(result).toEqual([1, 2, 3, 4]);
  });
});

describe('countChildren', () => {
  it('should count resolved children', () => {
    expect(countChildren(['a', 'b', 'c'])).toBe(3);
    expect(countChildren([null, 'a', undefined])).toBe(1);
    expect(countChildren(null)).toBe(0);
    expect(countChildren('single')).toBe(1);
  });
});

describe('isEmptyChildren', () => {
  it('should return true for empty children', () => {
    expect(isEmptyChildren(null)).toBe(true);
    expect(isEmptyChildren(undefined)).toBe(true);
    expect(isEmptyChildren([])).toBe(true);
    expect(isEmptyChildren([null, undefined])).toBe(true);
    expect(isEmptyChildren(false)).toBe(true);
  });

  it('should return false for non-empty children', () => {
    expect(isEmptyChildren('text')).toBe(false);
    expect(isEmptyChildren(0)).toBe(false);
    expect(isEmptyChildren(['a'])).toBe(false);
    expect(isEmptyChildren(createElement('div'))).toBe(false);
  });
});

describe('getElementChildren', () => {
  it('should return only Element children', () => {
    const div = createElement('div');
    const span = createElement('span');

    const result = getElementChildren(['text', div, 42, span, null]);

    expect(result).toHaveLength(2);
    expect(result[0]).toBe(div);
    expect(result[1]).toBe(span);
  });

  it('should return empty array for no elements', () => {
    const result = getElementChildren(['text', 42, null]);
    expect(result).toEqual([]);
  });
});

describe('mapChildren', () => {
  it('should map over resolved children', () => {
    const result = mapChildren(['a', 'b', 'c'], (child, index) => ({
      value: child,
      index,
    }));

    expect(result).toEqual([
      { value: 'a', index: 0 },
      { value: 'b', index: 1 },
      { value: 'c', index: 2 },
    ]);
  });

  it('should skip nullish values before mapping', () => {
    const result = mapChildren(['a', null, 'b'], (child) => child);
    expect(result).toEqual(['a', 'b']);
  });

  it('should handle Element children', () => {
    const div = createElement('div');

    const result = mapChildren([div], (child) => {
      if (child instanceof Element) {
        return child.tagName;
      }
      return String(child);
    });

    expect(result).toEqual(['DIV']);
  });
});

describe('children (reactive)', () => {
  it('should create a memoized children accessor', () => {
    createRoot(() => {
      let callCount = 0;
      const childrenFn = () => {
        callCount++;
        return ['a', 'b', 'c'];
      };

      const resolved = children(childrenFn);

      // First access
      const first = resolved();
      expect(first).toEqual(['a', 'b', 'c']);

      // Second access should use memoized value
      const second = resolved();
      expect(second).toEqual(['a', 'b', 'c']);

      // Memo caches the result
      expect(callCount).toBe(1);
    });
  });

  it('should update when signal changes', () => {
    createRoot(() => {
      const items = new Signal(['a', 'b']);

      const resolved = children(() => items.value);

      expect(resolved()).toEqual(['a', 'b']);

      items.value = ['x', 'y', 'z'];

      // Note: memos update lazily on next read
      expect(resolved()).toEqual(['x', 'y', 'z']);
    });
  });

  it('should resolve function children reactively', () => {
    createRoot(() => {
      const show = new Signal(true);

      const resolved = children(() => (show.value ? 'visible' : null));

      expect(resolved()).toEqual(['visible']);

      show.value = false;

      expect(resolved()).toEqual([]);
    });
  });
});

describe('elementChildren (reactive)', () => {
  it('should reactively filter to Element children only', () => {
    createRoot(() => {
      const div = createElement('div');
      const span = createElement('span');
      const items = new Signal<(string | Element)[]>(['text', div, span]);

      const elements = elementChildren(() => items.value);

      expect(elements()).toHaveLength(2);
      expect(elements()[0]).toBe(div);
      expect(elements()[1]).toBe(span);

      // Update to only text
      items.value = ['text only'];
      expect(elements()).toHaveLength(0);
    });
  });
});
