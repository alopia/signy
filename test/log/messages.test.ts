/**
 * Every log message code in the framework, checked for format and uniqueness.
 */

import { describe, it, expect } from 'vitest';
import { AppLogMessages } from '../../src/app/log-messages';
import { InstallableLogMessages } from '../../src/app/installable-log-messages';
import { ComponentLogMessages } from '../../src/component/log-messages';
import { ContextLogMessages } from '../../src/context/log-messages';
import {
  CoreLogMessages,
  FeatureLogMessages,
} from '../../src/core/log-messages';
import { ReactiveLogMessages } from '../../src/reactivity/log-messages';
import { RouterLogMessages } from '../../src/router/log-messages';
import { ViewLogMessages } from '../../src/views/log-messages';

const groups: Record<string, [namespace: string, Record<string, string>]> = {
  AppLogMessages: ['app', AppLogMessages],
  InstallableLogMessages: ['installable', InstallableLogMessages],
  ComponentLogMessages: ['component', ComponentLogMessages],
  ContextLogMessages: ['context', ContextLogMessages],
  CoreLogMessages: ['core', CoreLogMessages],
  FeatureLogMessages: ['feature', FeatureLogMessages],
  ReactiveLogMessages: ['reactivity', ReactiveLogMessages],
  RouterLogMessages: ['router', RouterLogMessages],
  ViewLogMessages: ['view', ViewLogMessages],
};

describe('log message codes', () => {
  for (const [group, [namespace, messages]] of Object.entries(groups)) {
    it(`${group} codes are "${namespace}:kebab-case"`, () => {
      for (const code of Object.values(messages)) {
        expect(code).toMatch(new RegExp(`^${namespace}:[a-z]+(-[a-z]+)*$`));
      }
    });
  }

  it('no two messages share a code', () => {
    const codes = Object.values(groups).flatMap(([, messages]) =>
      Object.values(messages)
    );
    expect(new Set(codes).size).toBe(codes.length);
  });
});
