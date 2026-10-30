/**
 * Tests for Logger and logging functions
 *
 * Uses imaginary test codes to avoid coupling with actual source codes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  Logger,
  logger,
  createLogger,
  shouldLog,
  LogLevel,
  LogFormat,
} from '../../src/log/logger';
import { globalConfig } from '../../src/app/global-config';
import {
  registerMessageResolver,
  clearMessageResolver,
} from '../../src/log/message-resolver';
import { panic } from '../../src/log/error';
import { expectLogged } from '../support/console';

// Test-only log codes (imaginary, not from source)
const TestCodes = {
  GENERIC_ERROR: 'test:generic-error',
  COMPONENT_ERROR: 'test:component-error',
  APP_ERROR: 'test:app-error',
  WARNING: 'test:warning',
} as const;

describe('Logger', () => {
  let consoleSpy: {
    error: ReturnType<typeof vi.spyOn>;
    warn: ReturnType<typeof vi.spyOn>;
    info: ReturnType<typeof vi.spyOn>;
    log: ReturnType<typeof vi.spyOn>;
    debug: ReturnType<typeof vi.spyOn>;
    trace: ReturnType<typeof vi.spyOn>;
  };

  let originalLogLevel: LogLevel;
  let originalLogFormat: LogFormat;

  beforeEach(() => {
    consoleSpy = {
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
      trace: vi.spyOn(console, 'trace').mockImplementation(() => {}),
    };

    // Save original config
    originalLogLevel =
      globalConfig.getValueOr('logLevel', LogLevel.ERROR) ?? LogLevel.ERROR;
    originalLogFormat =
      globalConfig.getValueOr('logFormat', LogFormat.PRETTY) ??
      LogFormat.PRETTY;

    // Set to TRACE level to test all logging
    globalConfig.set('logLevel', LogLevel.TRACE);
    globalConfig.set('logFormat', LogFormat.PRETTY);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Restore original config
    globalConfig.set('logLevel', originalLogLevel);
    globalConfig.set('logFormat', originalLogFormat);
  });

  describe('constructor', () => {
    it('should create logger without scope', () => {
      const log = new Logger();
      expect(log.scope).toBeUndefined();
    });

    it('should create logger with scope', () => {
      const log = new Logger('Router');
      expect(log.scope).toBe('Router');
    });
  });

  describe('error()', () => {
    it('should log error with code only', () => {
      const log = new Logger();
      log.error(TestCodes.GENERIC_ERROR);

      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
      expect(consoleSpy.error.mock.calls[0][0]).toContain(
        TestCodes.GENERIC_ERROR
      );
    });

    it('should log second parameter (second parameter takes precedence)', () => {
      const log = new Logger();
      log.error(TestCodes.COMPONENT_ERROR, 'Failed to mount component');

      // With 2-param API, message identifier takes precedence
      expect(consoleSpy.error.mock.calls[0][0]).toContain(
        'Failed to mount component'
      );
    });

    it('should log error with code and context', () => {
      const log = new Logger();
      const context = { componentId: 'nav' };
      log.error(TestCodes.COMPONENT_ERROR, context);

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining(TestCodes.COMPONENT_ERROR),
        context
      );
    });

    it('should log error with message identifier and context', () => {
      const log = new Logger();
      const context = { tag: 'my-nav' };
      log.error(TestCodes.APP_ERROR, context);

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining(TestCodes.APP_ERROR),
        context
      );
    });

    it('should log error with plain message and context', () => {
      const log = new Logger();
      const context = { tag: 'my-nav' };
      log.error('App not mounted', context);

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining('App not mounted'),
        context
      );
    });

    it('should include scope in output', () => {
      const log = new Logger('MyComponent');
      log.error(TestCodes.APP_ERROR);

      expect(consoleSpy.error.mock.calls[0][0]).toContain('[signy:MyComponent');
    });
  });

  describe('warn()', () => {
    it('should log warning with code', () => {
      const log = new Logger();
      log.warn(TestCodes.WARNING);

      expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
      expect(consoleSpy.warn.mock.calls[0][0]).toContain('test:warning');
    });

    it('should log second parameter (second parameter takes precedence)', () => {
      const log = new Logger();
      log.warn(TestCodes.WARNING, 'Plugin already installed');

      // With 2-param API, message identifier takes precedence
      expect(consoleSpy.warn.mock.calls[0][0]).toContain(
        'Plugin already installed'
      );
    });

    it('should log warning with context', () => {
      const log = new Logger();
      const context = { plugin: 'router' };
      log.warn(TestCodes.WARNING, context);

      expect(consoleSpy.warn).toHaveBeenCalledWith(expect.any(String), context);
    });
  });

  describe('info()', () => {
    it('should log info message', () => {
      const log = new Logger();
      log.info('Application started');

      expect(consoleSpy.info).toHaveBeenCalledTimes(1);
      expect(consoleSpy.info.mock.calls[0][0]).toContain('Application started');
    });

    it('should log info with context', () => {
      const log = new Logger();
      const context = { version: '1.0.0' };
      log.info('App initialized', context);

      expect(consoleSpy.info).toHaveBeenCalledWith(
        expect.stringContaining('App initialized'),
        context
      );
    });

    it('should support lazy message evaluation', () => {
      const log = new Logger();
      const lazyFn = vi.fn(() => 'Computed message');
      log.info(lazyFn);

      expect(lazyFn).toHaveBeenCalled();
      expect(consoleSpy.info.mock.calls[0][0]).toContain('Computed message');
    });

    it('should not evaluate lazy message when log level is too low', () => {
      globalConfig.set('logLevel', LogLevel.ERROR); // Only errors
      const log = new Logger();
      const lazyFn = vi.fn(() => 'Should not be called');
      log.info(lazyFn);

      expect(lazyFn).not.toHaveBeenCalled();
      expect(consoleSpy.info).not.toHaveBeenCalled();
    });
  });

  describe('general info logging', () => {
    it('should log message at INFO level', () => {
      const log = new Logger();
      log.info('General log message');

      expect(consoleSpy.info).toHaveBeenCalledTimes(1);
      expect(consoleSpy.info.mock.calls[0][0]).toContain('General log message');
    });

    it('should log with context', () => {
      const log = new Logger();
      const context = { count: 42 };
      log.info('Processing items', context);

      expect(consoleSpy.info).toHaveBeenCalledWith(expect.any(String), context);
    });

    it('should support lazy message', () => {
      const log = new Logger();
      log.info(() => `Lazy: ${2 + 2}`);

      expect(consoleSpy.info.mock.calls[0][0]).toContain('Lazy: 4');
    });
  });

  describe('debug()', () => {
    it('should log debug message', () => {
      const log = new Logger();
      log.debug('Debug info');

      expect(consoleSpy.debug).toHaveBeenCalledTimes(1);
      expect(consoleSpy.debug.mock.calls[0][0]).toContain('Debug info');
    });

    it('should log debug with context', () => {
      const log = new Logger();
      const context = { state: { count: 1 } };
      log.debug('State changed', context);

      expect(consoleSpy.debug).toHaveBeenCalledWith(
        expect.any(String),
        context
      );
    });

    it('should support lazy message for expensive operations', () => {
      const log = new Logger();
      const expensiveCalc = vi.fn(() => 'expensive result');
      log.debug(() => `Result: ${expensiveCalc()}`);

      expect(expensiveCalc).toHaveBeenCalled();
      expect(consoleSpy.debug.mock.calls[0][0]).toContain('expensive result');
    });

    it('should not call expensive function when debug is disabled', () => {
      globalConfig.set('logLevel', LogLevel.WARN);
      const log = new Logger();
      const expensiveCalc = vi.fn(() => 'expensive');
      log.debug(() => expensiveCalc());

      expect(expensiveCalc).not.toHaveBeenCalled();
    });
  });

  describe('trace()', () => {
    it('should call console.trace in PRETTY format', () => {
      const log = new Logger();
      log.trace('Trace label');

      expect(consoleSpy.trace).toHaveBeenCalledTimes(1);
      expect(consoleSpy.trace.mock.calls[0][0]).toContain('Trace label');
    });

    it('should call console.trace without message', () => {
      const log = new Logger();
      log.trace();

      expect(consoleSpy.trace).toHaveBeenCalledTimes(1);
    });

    it('should support lazy message', () => {
      const log = new Logger();
      log.trace(() => 'Lazy trace');

      expect(consoleSpy.trace.mock.calls[0][0]).toContain('Lazy trace');
    });

    it('should output JSON in JSON format', () => {
      globalConfig.set('logFormat', LogFormat.JSON);
      const log = new Logger();
      log.trace('Trace in JSON');

      expect(consoleSpy.trace).toHaveBeenCalledTimes(1);
      const output = consoleSpy.trace.mock.calls[0]![0] as string;
      expect(() => JSON.parse(output)).not.toThrow();
    });

    it('should include scope in trace prefix without message', () => {
      const log = new Logger('Router');
      log.trace();

      expect(consoleSpy.trace).toHaveBeenCalledTimes(1);
      expect(consoleSpy.trace.mock.calls[0]![0]).toContain(
        '[signy:Router][TRACE]'
      );
    });

    it('should include scope in trace prefix with message', () => {
      const log = new Logger('Router');
      log.trace('navigation');

      expect(consoleSpy.trace.mock.calls[0]![0]).toContain(
        '[signy:Router][TRACE]'
      );
      expect(consoleSpy.trace.mock.calls[0]![0]).toContain('navigation');
    });

    it('should output JSON with scope in JSON format', () => {
      globalConfig.set('logFormat', LogFormat.JSON);
      const log = new Logger('Component');
      log.trace('render');

      const output = consoleSpy.trace.mock.calls[0]![0] as string;
      const parsed = JSON.parse(output) as Record<string, unknown>;
      expect(parsed['scope']).toBe('Component');
      expect(parsed['message']).toBe('render');
    });

    it('should use empty message in JSON format when none provided', () => {
      globalConfig.set('logFormat', LogFormat.JSON);
      const log = new Logger();
      log.trace();

      const output = consoleSpy.trace.mock.calls[0]![0] as string;
      const parsed = JSON.parse(output) as Record<string, unknown>;
      expect(parsed['message']).toBe('');
    });
  });

  describe('child()', () => {
    it('should create child logger with combined scope', () => {
      const parentLog = new Logger('Router');
      const childLog = parentLog.child('Guards');

      expect(childLog.scope).toBe('Router:Guards');
    });

    it('should create child from logger without scope', () => {
      const parentLog = new Logger();
      const childLog = parentLog.child('Component');

      expect(childLog.scope).toBe('Component');
    });

    it('should allow multiple levels of nesting', () => {
      const log1 = new Logger('App');
      const log2 = log1.child('Router');
      const log3 = log2.child('Guards');

      expect(log3.scope).toBe('App:Router:Guards');
    });

    it('should output child scope in logs', () => {
      const parentLog = new Logger('Router');
      const childLog = parentLog.child('Navigation');
      childLog.info('Route changed');

      expect(consoleSpy.info.mock.calls[0][0]).toContain('Router:Navigation');
    });
  });

  describe('JSON format', () => {
    beforeEach(() => {
      globalConfig.set('logFormat', LogFormat.JSON);
    });

    it('should output valid JSON for error', () => {
      const log = new Logger();
      log.error(TestCodes.GENERIC_ERROR);

      const output = consoleSpy.error.mock.calls[0]![0] as string;
      const parsed = JSON.parse(output) as Record<string, unknown>;

      expect(parsed['level']).toBe(LogLevel.ERROR);
      expect(parsed['message']).toContain('test:generic-error');
      expect(parsed['timestamp']).toBeTypeOf('number');
    });

    it('should include scope in JSON output', () => {
      const log = new Logger('Router');
      log.info('Message');

      const output = consoleSpy.info.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.scope).toBe('Router');
    });

    it('should include context in JSON output', () => {
      const log = new Logger();
      log.info('Test', { key: 'value' });

      const output = consoleSpy.info.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.context).toEqual({ key: 'value' });
    });
  });

  describe('Output formatting', () => {
    it('should include level name in prefix for info level', () => {
      const log = new Logger();
      log.info('Test message');

      expect(consoleSpy.info.mock.calls[0][0]).toContain('[signy][INFO]');
    });

    it('should include level name in prefix for debug level', () => {
      const log = new Logger();
      log.debug('Debug message');

      expect(consoleSpy.debug.mock.calls[0][0]).toContain('[signy][DEBUG]');
    });

    it('should include level name for warn level', () => {
      const log = new Logger();
      log.warn(TestCodes.WARNING);

      expect(consoleSpy.warn.mock.calls[0][0]).toContain('[signy][WARN]');
    });

    it('should include level name for error level', () => {
      const log = new Logger();
      log.error(TestCodes.GENERIC_ERROR);

      expect(consoleSpy.error.mock.calls[0][0]).toContain('[signy][ERROR]');
    });

    it('should output info message without context (no code path)', () => {
      const log = new Logger();
      log.info('Simple message');

      // Should be called with just the message string, no second argument
      expect(consoleSpy.info).toHaveBeenCalledWith(
        expect.stringContaining('Simple message')
      );
    });

    it('should output info with scope without code', () => {
      const log = new Logger('Component');
      log.info('Rendering');

      expect(consoleSpy.info.mock.calls[0][0]).toContain('[signy:Component]');
      expect(consoleSpy.info.mock.calls[0][0]).toContain('Rendering');
    });
  });
});

describe('shouldLog', () => {
  let originalLogLevel: LogLevel;

  beforeEach(() => {
    originalLogLevel =
      globalConfig.getValueOr('logLevel', LogLevel.ERROR) ?? LogLevel.ERROR;
  });

  afterEach(() => {
    globalConfig.set('logLevel', originalLogLevel);
  });

  it('should return true when message level is at or below config level', () => {
    globalConfig.set('logLevel', LogLevel.INFO);

    expect(shouldLog(LogLevel.ERROR)).toBe(true);
    expect(shouldLog(LogLevel.WARN)).toBe(true);
    expect(shouldLog(LogLevel.INFO)).toBe(true);
  });

  it('should return false when message level is above config level', () => {
    globalConfig.set('logLevel', LogLevel.INFO);

    expect(shouldLog(LogLevel.DEBUG)).toBe(false);
    expect(shouldLog(LogLevel.TRACE)).toBe(false);
  });

  it('defaults to warnings in dev builds', () => {
    globalConfig.reset();

    expect(shouldLog(LogLevel.WARN)).toBe(true);
    expect(shouldLog(LogLevel.INFO)).toBe(false);
  });

  it('should always log errors', () => {
    globalConfig.set('logLevel', LogLevel.ERROR);

    expect(shouldLog(LogLevel.ERROR)).toBe(true);
  });

  it('should log all levels when set to TRACE', () => {
    globalConfig.set('logLevel', LogLevel.TRACE);

    expect(shouldLog(LogLevel.ERROR)).toBe(true);
    expect(shouldLog(LogLevel.WARN)).toBe(true);
    expect(shouldLog(LogLevel.INFO)).toBe(true);
    expect(shouldLog(LogLevel.DEBUG)).toBe(true);
    expect(shouldLog(LogLevel.TRACE)).toBe(true);
  });
});

describe('Global logger singleton', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let originalLogLevel: LogLevel;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    originalLogLevel =
      globalConfig.getValueOr('logLevel', LogLevel.ERROR) ?? LogLevel.ERROR;
    globalConfig.set('logLevel', LogLevel.TRACE);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalConfig.set('logLevel', originalLogLevel);
  });

  it('should be a Logger instance', () => {
    expect(logger).toBeInstanceOf(Logger);
  });

  it('should not have a scope', () => {
    expect(logger.scope).toBeUndefined();
  });

  it('should be usable for logging', () => {
    logger.info('Test from global logger');

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Test from global logger')
    );
  });
});

describe('createLogger', () => {
  it('should create a scoped logger', () => {
    const log = createLogger('MyComponent');

    expect(log).toBeInstanceOf(Logger);
    expect(log.scope).toBe('MyComponent');
  });

  it('should create independent loggers', () => {
    const log1 = createLogger('Component1');
    const log2 = createLogger('Component2');

    expect(log1.scope).toBe('Component1');
    expect(log2.scope).toBe('Component2');
  });
});

describe('readable message text', () => {
  afterEach(() => clearMessageResolver());

  it('prints the text next to the id when a resolver is registered', () => {
    registerMessageResolver((id) =>
      id === 'app:not-mounted' ? 'Application is not mounted.' : ''
    );
    logger.error('app:not-mounted');
    expectLogged('error', '[app:not-mounted] Application is not mounted.');
  });

  it('puts the text in the SignyError message', () => {
    registerMessageResolver(() => 'Readable.');
    expect(() => panic('app:not-mounted')).toThrow(
      '[app:not-mounted] Readable.'
    );
  });
});
