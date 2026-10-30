/**
 * Tests for components/props module
 */

import { describe, it, expect } from 'vitest';
import {
  mergeProps,
  splitProps,
  splitPropsMultiple,
  withDefaults,
} from '../../src/component/props';

describe('mergeProps', () => {
  describe('basic merging', () => {
    it('should merge two objects', () => {
      const a = { foo: 1, bar: 2 };
      const b = { baz: 3 };

      const result = mergeProps(a, b as unknown as typeof a);

      expect(result).toEqual({ foo: 1, bar: 2, baz: 3 });
    });

    it('should override earlier props with later ones', () => {
      const defaults = { size: 'medium', color: 'blue' };
      const userProps = { size: 'large', color: 'blue' };

      const result = mergeProps(defaults, userProps);

      expect(result.size).toBe('large');
      expect(result.color).toBe('blue');
    });

    it('should handle multiple sources', () => {
      const a = { a: 1, b: 0, c: 0 };
      const b = { a: 0, b: 2, c: 0 };
      const c = { a: 0, b: 0, c: 3 };

      const result = mergeProps(a, b, c);

      expect(result).toEqual({ a: 0, b: 0, c: 3 });
    });

    it('should skip null and undefined sources', () => {
      const a = { foo: 1, bar: 0 };

      const result = mergeProps(
        a,
        null as unknown as typeof a,
        undefined as unknown as typeof a,
        { foo: 0, bar: 2 }
      );

      expect(result).toEqual({ foo: 0, bar: 2 });
    });

    it('should return empty object when no sources', () => {
      const result = mergeProps();
      expect(result).toEqual({});
    });
  });

  describe('getter preservation', () => {
    it('should preserve getters', () => {
      let value = 'initial';

      const props = {
        static: 'static',
        get dynamic() {
          return value;
        },
      };

      const merged = mergeProps({ static: 'other', dynamic: '' }, props);

      expect(merged.dynamic).toBe('initial');

      value = 'changed';

      expect(merged.dynamic).toBe('changed');
    });

    it('should override getters with later values', () => {
      const propsWithGetter = {
        get value() {
          return 'getter';
        },
      };

      const propsWithValue = { value: 'plain' };

      const result = mergeProps(propsWithGetter, propsWithValue);

      expect(result.value).toBe('plain');
    });

    it('should override values with later getters', () => {
      const propsWithValue = { value: 'plain' };
      const propsWithGetter = {
        get value() {
          return 'getter';
        },
      };

      const result = mergeProps(propsWithValue, propsWithGetter);

      expect(result.value).toBe('getter');
    });
  });

  describe('type safety', () => {
    it('should work with typed props', () => {
      interface ButtonProps {
        size: 'small' | 'medium' | 'large';
        disabled: boolean;
        onClick?: () => void;
      }

      const defaults: Partial<ButtonProps> = {
        size: 'medium',
        disabled: false,
      };

      const userProps: Partial<ButtonProps> = {
        size: 'large',
        onClick: () => {},
      };

      const result = mergeProps(defaults, userProps);

      expect(result['size']).toBe('large');
      expect(result['disabled']).toBe(false);
      expect(typeof result['onClick']).toBe('function');
    });
  });
});

describe('splitProps', () => {
  describe('basic splitting', () => {
    it('should split props into two groups', () => {
      const props = { a: 1, b: 2, c: 3, d: 4 };

      const [picked, rest] = splitProps(props, ['a', 'c']);

      expect(picked).toEqual({ a: 1, c: 3 });
      expect(rest).toEqual({ b: 2, d: 4 });
    });

    it('should handle empty keys array', () => {
      const props = { a: 1, b: 2 };

      const [picked, rest] = splitProps(props, []);

      expect(picked).toEqual({});
      expect(rest).toEqual({ a: 1, b: 2 });
    });

    it('should handle all keys being picked', () => {
      const props = { a: 1, b: 2 };

      const [picked, rest] = splitProps(props, ['a', 'b']);

      expect(picked).toEqual({ a: 1, b: 2 });
      expect(rest).toEqual({});
    });

    it('should handle missing keys gracefully', () => {
      const props = { a: 1, b: 2 };

      const [picked, rest] = splitProps(props, ['a', 'c' as never]);

      expect(picked).toEqual({ a: 1 });
      expect(rest).toEqual({ b: 2 });
    });
  });

  describe('getter preservation', () => {
    it('should preserve getters in picked props', () => {
      let value = 'initial';

      const props = {
        get dynamic() {
          return value;
        },
        static: 'static',
      };

      const [picked, rest] = splitProps(props, ['dynamic']);

      expect(picked.dynamic).toBe('initial');
      value = 'changed';
      expect(picked.dynamic).toBe('changed');

      expect(rest.static).toBe('static');
    });

    it('should preserve getters in rest props', () => {
      let value = 'initial';

      const props = {
        picked: 'picked',
        get dynamic() {
          return value;
        },
      };

      const [picked, rest] = splitProps(props, ['picked']);

      expect(picked.picked).toBe('picked');
      expect((rest as { dynamic?: string }).dynamic).toBe('initial');

      value = 'changed';
      expect((rest as { dynamic?: string }).dynamic).toBe('changed');
    });
  });

  describe('use case: component props', () => {
    it('should separate local and pass-through props', () => {
      interface ButtonProps {
        variant: 'primary' | 'secondary';
        size: 'small' | 'large';
        class?: string;
        id?: string;
        'aria-label'?: string;
      }

      const props: ButtonProps = {
        variant: 'primary',
        size: 'large',
        class: 'my-button',
        id: 'btn-1',
        'aria-label': 'Click me',
      };

      const [local, htmlAttrs] = splitProps(
        props as unknown as Record<string, unknown>,
        ['variant', 'size'] as const
      );

      expect((local as Record<string, unknown>)['variant']).toBe('primary');
      expect((local as Record<string, unknown>)['size']).toBe('large');
      expect((local as Record<string, unknown>)['class']).toBeUndefined();

      expect(htmlAttrs['class']).toBe('my-button');
      expect(htmlAttrs['id']).toBe('btn-1');
      expect(htmlAttrs['aria-label']).toBe('Click me');
    });
  });
});

describe('splitPropsMultiple', () => {
  it('should split into multiple groups', () => {
    const props = {
      onClick: () => {},
      onHover: () => {},
      class: 'btn',
      style: 'color: red',
      id: 'my-btn',
    };

    const [handlers, styles, rest] = splitPropsMultiple(
      props,
      ['onClick', 'onHover'],
      ['class', 'style']
    );

    expect(handlers!['onClick']).toBe(props.onClick);
    expect(handlers!['onHover']).toBe(props.onHover);
    expect(styles!['class']).toBe('btn');
    expect(styles!['style']).toBe('color: red');
    expect(rest!['id']).toBe('my-btn');
  });

  it('should handle overlapping groups (last definition wins)', () => {
    const props = { a: 1, b: 2 };

    const [first, second, rest] = splitPropsMultiple(props, ['a'], ['a', 'b']);

    // 'a' goes to second group (last definition wins in keyToGroup map)
    expect((first as Record<string, unknown>)['a']).toBeUndefined();
    expect(second!['a']).toBe(1);
    expect(second!['b']).toBe(2);
    expect(Object.keys(rest!)).toHaveLength(0);
  });
});

describe('withDefaults', () => {
  it('should apply defaults', () => {
    const defaults = { size: 'medium', disabled: false };
    const props = { size: 'large', disabled: false };

    const result = withDefaults(defaults, props);

    expect(result.size).toBe('large');
    expect(result.disabled).toBe(false);
  });

  it('should allow undefined props to use defaults', () => {
    const defaults = { value: 'default' };
    const props = { value: undefined };

    const result = withDefaults(defaults, props);

    // undefined overrides the default
    expect(result.value).toBeUndefined();
  });

  it('should work with empty user props', () => {
    const defaults = { a: 1, b: 2 };
    const result = withDefaults(defaults, {});

    expect(result).toEqual({ a: 1, b: 2 });
  });
});
