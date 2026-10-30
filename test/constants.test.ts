import { describe, it, expect, vi } from 'vitest';
import {
  VERSION,
  ENV,
  EVENTS,
  isServer,
  isClient,
  isDev,
  isProd,
} from '../src/constants';

describe('Constants', () => {
  it('should export VERSION', () => {
    expect(VERSION).toBe('1.0.0');
  });

  it('should export ENV constants', () => {
    expect(ENV.DEV).toBe('development');
    expect(ENV.PROD).toBe('production');
    expect(ENV.TEST).toBe('test');
  });

  it('should export EVENTS constants', () => {
    expect(EVENTS.MOUNT).toBe('mount');
    expect(EVENTS.UPDATE).toBe('update');
    expect(EVENTS.UNMOUNT).toBe('unmount');
    expect(EVENTS.NAVIGATE).toBe('navigate');
  });
});

describe('Environment Detection', () => {
  it('detects a browser in jsdom', () => {
    expect(isServer).toBe(false);
    expect(isClient).toBe(true);
  });

  it('is neither dev nor prod when NODE_ENV is test', () => {
    expect(isDev).toBe(false);
    expect(isProd).toBe(false);
  });

  it.each([
    ['development', true, false],
    ['production', false, true],
  ])('reads NODE_ENV=%s at load time', async (env, dev, prod) => {
    vi.stubEnv('NODE_ENV', env);
    vi.resetModules();
    const constants = await import('../src/constants');
    expect(constants.isDev).toBe(dev);
    expect(constants.isProd).toBe(prod);
  });
});
