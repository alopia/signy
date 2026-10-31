/**
 * Tests for the log module exports
 */

import { describe, it, expect } from 'vitest';
import * as logModule from '../../src/log';
import type { LazyMessage, LogEntry, LogMessage } from '../../src/log';

describe('log module exports', () => {
  describe('error.ts exports', () => {
    it('should export SignyError class', () => {
      expect(typeof logModule.SignyError).toBe('function');
    });

    it('should export panic function', () => {
      expect(typeof logModule.panic).toBe('function');
    });

    it('should export assert function', () => {
      expect(typeof logModule.assert).toBe('function');
    });

    it('should export createError function', () => {
      expect(typeof logModule.createError).toBe('function');
    });
  });

  describe('logger.ts exports', () => {
    it('should export Logger class', () => {
      expect(typeof logModule.Logger).toBe('function');
    });

    it('should export logger singleton', () => {
      expect(logModule.logger).toBeInstanceOf(logModule.Logger);
    });

    it('should export createLogger function', () => {
      expect(typeof logModule.createLogger).toBe('function');
    });

    it('should export shouldLog function', () => {
      expect(typeof logModule.shouldLog).toBe('function');
    });

    it('should re-export LogLevel from logger', () => {
      // LogLevel is a const enum, verify by checking known values exist
      expect(logModule.LogLevel.ERROR).toBe('error');
      expect(logModule.LogLevel.TRACE).toBe('trace');
    });

    it('should re-export LogFormat from logger', () => {
      // LogFormat is a const enum, verify by checking known values exist
      expect(logModule.LogFormat.PRETTY).toBe(0);
      expect(logModule.LogFormat.JSON).toBe(1);
    });
  });

  describe('types.ts exports', () => {
    it('should export LogMessage type', () => {
      // LogMessage is now a string type (compile-time check only)
      // We can verify by assigning a valid log message identifier
      const code: LogMessage = 'test:example';
      expect(code).toBe('test:example');
    });
  });

  describe('level.ts exports', () => {
    it('should export LogLevel enum with correct values', () => {
      // LogLevel is a const enum - verify values directly
      expect(logModule.LogLevel.ERROR).toBe('error');
      expect(logModule.LogLevel.WARN).toBe('warn');
      expect(logModule.LogLevel.INFO).toBe('info');
      expect(logModule.LogLevel.DEBUG).toBe('debug');
      expect(logModule.LogLevel.TRACE).toBe('trace');
    });

    it('should export LogFormat enum with correct values', () => {
      // LogFormat is a const enum - verify values directly
      expect(logModule.LogFormat.PRETTY).toBe(0);
      expect(logModule.LogFormat.JSON).toBe(1);
    });
  });

  describe('Type exports', () => {
    it('should allow using LogEntry type', () => {
      // This is a compile-time check - if it compiles, the type is exported
      const entry: LogEntry = {
        level: logModule.LogLevel.INFO,
        message: 'test',
        timestamp: Date.now(),
      };

      expect(entry.level).toBe(logModule.LogLevel.INFO);
    });

    it('should allow using LazyMessage type', () => {
      // Compile-time type check
      const lazyString: LazyMessage = 'test';
      const lazyFn: LazyMessage = () => 'test';

      expect(typeof lazyString).toBe('string');
      expect(typeof lazyFn).toBe('function');
    });
  });
});
