/**
 * Tests for utils/id module
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useId,
  createIdGenerator,
  useIds,
  resetIdCounter,
  getIdCounter,
} from '../../src/utils/id';

describe('useId', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it('should generate unique IDs with default prefix', () => {
    const id1 = useId();
    const id2 = useId();
    const id3 = useId();

    expect(id1).toBe('signy-1');
    expect(id2).toBe('signy-2');
    expect(id3).toBe('signy-3');
  });

  it('should generate IDs with custom prefix', () => {
    const id1 = useId('menu');
    const id2 = useId('button');
    const id3 = useId('dialog');

    expect(id1).toBe('menu-1');
    expect(id2).toBe('button-2');
    expect(id3).toBe('dialog-3');
  });

  it('should increment counter globally', () => {
    useId('a');
    useId('b');
    useId('c');

    expect(getIdCounter()).toBe(3);
  });

  it('should return string IDs', () => {
    const id = useId();
    expect(typeof id).toBe('string');
  });
});

describe('createIdGenerator', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it('should create a generator with a fixed prefix', () => {
    const generator = createIdGenerator('field');

    const id1 = generator();
    const id2 = generator();
    const id3 = generator();

    expect(id1).toBe('field-1');
    expect(id2).toBe('field-2');
    expect(id3).toBe('field-3');
  });

  it('should share counter with useId', () => {
    useId('first');
    const generator = createIdGenerator('second');

    expect(generator()).toBe('second-2');
    expect(useId()).toBe('signy-3');
  });

  it('should return a function', () => {
    const generator = createIdGenerator('test');
    expect(typeof generator).toBe('function');
  });
});

describe('useIds', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it('should generate multiple IDs at once', () => {
    const ids = useIds(3);

    expect(ids).toHaveLength(3);
    expect(ids[0]).toBe('signy-1');
    expect(ids[1]).toBe('signy-2');
    expect(ids[2]).toBe('signy-3');
  });

  it('should generate IDs with custom prefix', () => {
    const ids = useIds(2, 'form');

    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe('form-1');
    expect(ids[1]).toBe('form-2');
  });

  it('should return empty array for count 0', () => {
    const ids = useIds(0);
    expect(ids).toHaveLength(0);
  });

  it('should return an array', () => {
    const ids = useIds(2);
    expect(Array.isArray(ids)).toBe(true);
  });

  it('should work with destructuring', () => {
    const [labelId, inputId, errorId] = useIds(3, 'field');

    expect(labelId).toBe('field-1');
    expect(inputId).toBe('field-2');
    expect(errorId).toBe('field-3');
  });
});

describe('resetIdCounter', () => {
  it('should reset counter to 0', () => {
    resetIdCounter(); // Ensure clean state
    useId();
    useId();
    useId();

    expect(getIdCounter()).toBe(3);

    resetIdCounter();

    expect(getIdCounter()).toBe(0);
  });

  it('should cause IDs to restart from 1', () => {
    resetIdCounter(); // Ensure clean state
    const id1 = useId();
    resetIdCounter();
    const id2 = useId();

    expect(id1).toBe('signy-1');
    expect(id2).toBe('signy-1');
  });
});

describe('getIdCounter', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it('should return 0 initially', () => {
    expect(getIdCounter()).toBe(0);
  });

  it('should return current counter value', () => {
    useId();
    expect(getIdCounter()).toBe(1);

    useId();
    useId();
    expect(getIdCounter()).toBe(3);
  });
});
