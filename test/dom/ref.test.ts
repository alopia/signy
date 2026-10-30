/**
 * Tests for createRef, createRefWithValue, and isRef
 */

import { describe, it, expect, vi } from 'vitest';
import { createRef, createRefWithValue, isRef } from '../../src/dom/ref';

describe('createRef', () => {
  it('should create a ref with null initial value', () => {
    const ref = createRef<HTMLDivElement>();
    expect(ref.current).toBeNull();
  });

  it('should allow setting current value', () => {
    const ref = createRef<HTMLDivElement>();
    const div = document.createElement('div');
    ref.current = div;
    expect(ref.current).toBe(div);
  });

  it('should allow setting current to null', () => {
    const ref = createRef<HTMLDivElement>();
    const div = document.createElement('div');
    ref.current = div;
    ref.current = null;
    expect(ref.current).toBeNull();
  });

  it('should work with non-element types', () => {
    const ref = createRef<number>();
    ref.current = 42;
    expect(ref.current).toBe(42);
  });

  it('should be a stable reference', () => {
    const ref = createRef<string>();
    const original = ref;
    ref.current = 'test';
    expect(ref).toBe(original);
  });

  it('should default to HTMLElement type', () => {
    const ref = createRef();
    // TypeScript should infer HTMLElement | null
    const element: HTMLElement | null = ref.current;
    expect(element).toBeNull();
  });
});

describe('createRefWithValue', () => {
  it('should create a ref with the provided initial value', () => {
    const ref = createRefWithValue(42);
    expect(ref.current).toBe(42);
  });

  it('should work with objects', () => {
    const obj = { name: 'test' };
    const ref = createRefWithValue(obj);
    expect(ref.current).toBe(obj);
  });

  it('should allow updating the value', () => {
    const ref = createRefWithValue(0);
    ref.current = 100;
    expect(ref.current).toBe(100);
  });

  it('should work with functions', () => {
    const fn = vi.fn();
    const ref = createRefWithValue(fn);
    ref.current();
    expect(fn).toHaveBeenCalled();
  });

  it('should preserve type information', () => {
    const ref = createRefWithValue<number | string>(42);
    ref.current = 'string';
    expect(ref.current).toBe('string');
  });
});

describe('isRef', () => {
  it('should return true for createRef result', () => {
    const ref = createRef<HTMLDivElement>();
    expect(isRef(ref)).toBe(true);
  });

  it('should return true for createRefWithValue result', () => {
    const ref = createRefWithValue(42);
    expect(isRef(ref)).toBe(true);
  });

  it('should return true for plain object with current property', () => {
    const obj = { current: null };
    expect(isRef(obj)).toBe(true);
  });

  it('should return false for null', () => {
    expect(isRef(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isRef(undefined)).toBe(false);
  });

  it('should return false for primitives', () => {
    expect(isRef(42)).toBe(false);
    expect(isRef('string')).toBe(false);
    expect(isRef(true)).toBe(false);
  });

  it('should return false for objects without current property', () => {
    expect(isRef({})).toBe(false);
    expect(isRef({ value: null })).toBe(false);
  });

  it('should return false for arrays', () => {
    expect(isRef([1, 2, 3])).toBe(false);
  });

  it('should return false for functions', () => {
    expect(isRef(() => {})).toBe(false);
  });
});
