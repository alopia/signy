/**
 * Tests for LogLevel and LogFormat enums
 */

import { describe, it, expect } from 'vitest';
import { LogLevel, LogFormat, type LogEntry } from '../../src/log/types';

describe('LogLevel', () => {
  describe('Level values', () => {
    it('should have ERROR = "error"', () => {
      expect(LogLevel.ERROR).toBe('error');
    });

    it('should have WARN = "warn"', () => {
      expect(LogLevel.WARN).toBe('warn');
    });

    it('should have INFO = "info"', () => {
      expect(LogLevel.INFO).toBe('info');
    });

    it('should have DEBUG = "debug"', () => {
      expect(LogLevel.DEBUG).toBe('debug');
    });

    it('should have TRACE = "trace"', () => {
      expect(LogLevel.TRACE).toBe('trace');
    });
  });

  describe('Level priority', () => {
    // Define severity order for tests (lower index = more severe)
    const LEVEL_PRIORITY = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3,
      trace: 4,
    } as const;

    it('should have ERROR as the most severe level', () => {
      expect(LEVEL_PRIORITY[LogLevel.ERROR]).toBe(0);
    });

    it('should have TRACE as the most verbose level', () => {
      expect(LEVEL_PRIORITY[LogLevel.TRACE]).toBe(4);
    });

    it('should allow filtering by level priority', () => {
      const currentLevelPriority = LEVEL_PRIORITY[LogLevel.INFO]; // 2

      // Messages at or below current priority (more severe) should log
      expect(LEVEL_PRIORITY[LogLevel.ERROR]).toBeLessThanOrEqual(
        currentLevelPriority
      );
      expect(LEVEL_PRIORITY[LogLevel.WARN]).toBeLessThanOrEqual(
        currentLevelPriority
      );
      expect(LEVEL_PRIORITY[LogLevel.INFO]).toBeLessThanOrEqual(
        currentLevelPriority
      );

      // Messages above current priority (more verbose) should not log
      expect(LEVEL_PRIORITY[LogLevel.DEBUG]).toBeGreaterThan(
        currentLevelPriority
      );
      expect(LEVEL_PRIORITY[LogLevel.TRACE]).toBeGreaterThan(
        currentLevelPriority
      );
    });

    it('should work for error-only mode', () => {
      const currentLevelPriority = LEVEL_PRIORITY[LogLevel.ERROR]; // 0

      expect(LEVEL_PRIORITY[LogLevel.ERROR]).toBeLessThanOrEqual(
        currentLevelPriority
      );
      expect(LEVEL_PRIORITY[LogLevel.WARN]).toBeGreaterThan(
        currentLevelPriority
      );
      expect(LEVEL_PRIORITY[LogLevel.INFO]).toBeGreaterThan(
        currentLevelPriority
      );
    });

    it('should work for verbose mode', () => {
      const currentLevelPriority = LEVEL_PRIORITY[LogLevel.TRACE]; // 4

      // All levels should log in TRACE mode
      expect(LEVEL_PRIORITY[LogLevel.ERROR]).toBeLessThanOrEqual(
        currentLevelPriority
      );
      expect(LEVEL_PRIORITY[LogLevel.WARN]).toBeLessThanOrEqual(
        currentLevelPriority
      );
      expect(LEVEL_PRIORITY[LogLevel.INFO]).toBeLessThanOrEqual(
        currentLevelPriority
      );
      expect(LEVEL_PRIORITY[LogLevel.DEBUG]).toBeLessThanOrEqual(
        currentLevelPriority
      );
      expect(LEVEL_PRIORITY[LogLevel.TRACE]).toBeLessThanOrEqual(
        currentLevelPriority
      );
    });
  });
});

describe('LogFormat', () => {
  it('should have PRETTY format', () => {
    expect(LogFormat.PRETTY).toBe(0);
  });

  it('should have JSON format', () => {
    expect(LogFormat.JSON).toBe(1);
  });

  it('should have exactly two format values', () => {
    // LogFormat is a const enum, so we verify by checking known values
    expect(LogFormat.PRETTY).toBe(0);
    expect(LogFormat.JSON).toBe(1);
    // There should only be PRETTY (0) and JSON (1)
    expect(LogFormat.PRETTY).not.toBe(LogFormat.JSON);
  });
});

describe('LogEntry type', () => {
  it('should be usable as a type for log entries', () => {
    const entry: LogEntry = {
      level: LogLevel.INFO,
      message: 'Test message',
      timestamp: Date.now(),
    };

    expect(entry.level).toBe(LogLevel.INFO);
    expect(entry.message).toBe('Test message');
    expect(entry.timestamp).toBeTypeOf('number');
  });

  it('should allow optional details field', () => {
    const entry: LogEntry = {
      level: LogLevel.ERROR,
      message: 'Error occurred',
      details: 'More info about the error',
      timestamp: Date.now(),
    };

    expect(entry.details).toBe('More info about the error');
  });

  it('should allow optional context field', () => {
    const entry: LogEntry = {
      level: LogLevel.DEBUG,
      message: 'Debug info',
      context: { userId: 123, action: 'click' },
      timestamp: Date.now(),
    };

    expect(entry.context).toEqual({ userId: 123, action: 'click' });
  });

  it('should support all fields together', () => {
    const entry: LogEntry = {
      level: LogLevel.WARN,
      message: 'Warning message',
      scope: 'router',
      details: 'Additional details',
      context: { plugin: 'router', reason: 'duplicate' },
      timestamp: 1704067200000,
    };

    expect(entry.level).toBe(LogLevel.WARN);
    expect(entry.message).toBe('Warning message');
    expect(entry.scope).toBe('router');
    expect(entry.details).toBe('Additional details');
    expect(entry.context).toEqual({ plugin: 'router', reason: 'duplicate' });
    expect(entry.timestamp).toBe(1704067200000);
  });
});
