/**
 * Config class tests
 *
 * Tests for the generic and reusable configuration management class.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Config } from '../../src/utils/config';

interface TestConfig extends Record<string, unknown> {
  debug: boolean;
  apiUrl: string;
  port: number;
  timeout?: number;
}

describe('Config', () => {
  let config: Config<TestConfig>;

  beforeEach(() => {
    config = new Config<TestConfig>();
  });

  //=============================================
  // Constructor and Factory
  //=============================================

  describe('constructor', () => {
    it('creates an empty config by default', () => {
      const c = new Config<TestConfig>();
      expect(c.isEmpty).toBe(true);
      expect(c.size).toBe(0);
    });

    it('creates a config with defaults', () => {
      const c = new Config<TestConfig>({
        debug: true,
        apiUrl: 'http://api.test',
      });
      expect(c.getValue('debug')).toBe(true);
      expect(c.getValue('apiUrl')).toBe('http://api.test');
      expect(c.size).toBe(2);
    });
  });

  describe('static create', () => {
    it('creates a new Config instance', () => {
      const c = Config.create<TestConfig>();
      expect(c).toBeInstanceOf(Config);
      expect(c.isEmpty).toBe(true);
    });

    it('creates a Config with defaults', () => {
      const c = Config.create<TestConfig>({ debug: false });
      expect(c.getValue('debug')).toBe(false);
    });
  });

  //=============================================
  // Getters
  //=============================================

  describe('all', () => {
    it('returns a readonly copy of all options', () => {
      config.configure({ debug: true, apiUrl: 'http://test.com', port: 3000 });
      const all = config.all;

      expect(all.debug).toBe(true);
      expect(all.apiUrl).toBe('http://test.com');
      expect(all.port).toBe(3000);
    });

    it('returns a copy, not the original object', () => {
      config.configure({ debug: true, apiUrl: 'http://test.com', port: 3000 });
      const all1 = config.all;
      const all2 = config.all;

      expect(all1).not.toBe(all2);
      expect(all1).toEqual(all2);
    });
  });

  describe('size', () => {
    it('returns 0 for empty config', () => {
      expect(config.size).toBe(0);
    });

    it('returns correct count after adding options', () => {
      config.configure({ debug: true, apiUrl: 'http://test.com', port: 3000 });
      expect(config.size).toBe(3);
    });
  });

  describe('isEmpty', () => {
    it('returns true for empty config', () => {
      expect(config.isEmpty).toBe(true);
    });

    it('returns false after adding options', () => {
      config.set('debug', true);
      expect(config.isEmpty).toBe(false);
    });
  });

  //=============================================
  // Configuration Methods
  //=============================================

  describe('configure', () => {
    it('sets options from partial config', () => {
      config.configure({ debug: true });
      expect(config.getValue('debug')).toBe(true);
    });

    it('merges with existing options', () => {
      config.configure({ debug: true, apiUrl: 'http://first.com', port: 3000 });
      config.configure({ apiUrl: 'http://second.com' });

      expect(config.getValue('debug')).toBe(true);
      expect(config.getValue('apiUrl')).toBe('http://second.com');
      expect(config.getValue('port')).toBe(3000);
    });

    it('returns this for method chaining', () => {
      const result = config.configure({ debug: true });
      expect(result).toBe(config);
    });
  });

  describe('getValue', () => {
    it('returns the value for a set key', () => {
      config.set('port', 8080);
      expect(config.getValue('port')).toBe(8080);
    });

    it('returns undefined for unset keys', () => {
      expect(config.getValue('timeout')).toBeUndefined();
    });
  });

  describe('getValueOr', () => {
    it('returns the value when key exists', () => {
      config.set('port', 8080);
      expect(config.getValueOr('port', 3000)).toBe(8080);
    });

    it('returns the default when key does not exist', () => {
      expect(config.getValueOr('timeout', 5000)).toBe(5000);
    });

    it('returns the value when value is falsy but defined', () => {
      config.set('debug', false);
      expect(config.getValueOr('debug', true)).toBe(false);
    });
  });

  describe('set', () => {
    it('sets a single value', () => {
      config.set('debug', true);
      expect(config.getValue('debug')).toBe(true);
    });

    it('overwrites existing values', () => {
      config.set('port', 3000);
      config.set('port', 8080);
      expect(config.getValue('port')).toBe(8080);
    });

    it('returns this for method chaining', () => {
      const result = config.set('debug', true);
      expect(result).toBe(config);
    });
  });

  describe('reset', () => {
    it('clears all options', () => {
      config.configure({ debug: true, apiUrl: 'http://test.com', port: 3000 });
      config.reset();

      expect(config.isEmpty).toBe(true);
      expect(config.getValue('debug')).toBeUndefined();
    });

    it('accepts new defaults', () => {
      config.configure({ debug: true, apiUrl: 'http://old.com', port: 3000 });
      config.reset({ apiUrl: 'http://new.com' });

      expect(config.getValue('debug')).toBeUndefined();
      expect(config.getValue('apiUrl')).toBe('http://new.com');
    });

    it('returns this for method chaining', () => {
      const result = config.reset();
      expect(result).toBe(config);
    });
  });

  describe('has', () => {
    it('returns true for existing keys', () => {
      config.set('debug', false);
      expect(config.has('debug')).toBe(true);
    });

    it('returns false for non-existent keys', () => {
      expect(config.has('timeout')).toBe(false);
    });
  });

  describe('isEnabled', () => {
    it('returns true for truthy values', () => {
      config.set('debug', true);
      expect(config.isEnabled('debug')).toBe(true);
    });

    it('returns false for falsy values', () => {
      config.set('debug', false);
      expect(config.isEnabled('debug')).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(config.isEnabled('timeout')).toBe(false);
    });

    it('returns true for non-boolean truthy values', () => {
      config.set('port', 8080);
      expect(config.isEnabled('port')).toBe(true);
    });
  });

  describe('remove', () => {
    it('removes an existing key', () => {
      config.set('debug', true);
      config.remove('debug');

      expect(config.has('debug')).toBe(false);
      expect(config.getValue('debug')).toBeUndefined();
    });

    it('is a no-op for non-existent keys', () => {
      const sizeBefore = config.size;
      config.remove('timeout');
      expect(config.size).toBe(sizeBefore);
    });

    it('returns this for method chaining', () => {
      const result = config.remove('debug');
      expect(result).toBe(config);
    });
  });

  describe('forEach', () => {
    it('iterates over all entries', () => {
      config.configure({ debug: true, apiUrl: 'http://test.com', port: 3000 });
      const entries: Array<[string, unknown]> = [];

      config.forEach((value, key) => {
        entries.push([key as string, value]);
      });

      expect(entries).toHaveLength(3);
      expect(entries).toContainEqual(['debug', true]);
      expect(entries).toContainEqual(['apiUrl', 'http://test.com']);
      expect(entries).toContainEqual(['port', 3000]);
    });

    it('handles empty config', () => {
      const entries: Array<[string, unknown]> = [];
      config.forEach((value, key) => {
        entries.push([key as string, value]);
      });

      expect(entries).toHaveLength(0);
    });
  });

  //=============================================
  // Method Chaining
  //=============================================

  describe('method chaining', () => {
    it('supports fluent API', () => {
      const result = config
        .set('debug', true)
        .set('port', 8080)
        .configure({ apiUrl: 'http://chain.test' })
        .remove('debug')
        .reset({ port: 3000 });

      expect(result).toBe(config);
      expect(config.getValue('port')).toBe(3000);
      expect(config.getValue('debug')).toBeUndefined();
      expect(config.getValue('apiUrl')).toBeUndefined();
    });
  });
});

describe('Config with keys an object inherits', () => {
  it('does not see toString or constructor as set', () => {
    const config = new Config<Record<string, unknown>>();
    expect(config.has('toString')).toBe(false);
    expect(config.getValue('constructor')).toBeUndefined();
    expect(config.getValueOr('constructor', 'fallback')).toBe('fallback');
    expect(config.isEnabled('valueOf')).toBe(false);

    config.set('constructor', 1);
    expect(config.has('constructor')).toBe(true);
    expect(config.getValue('constructor')).toBe(1);
  });
});
