/**
 * Tests for the factory functions in reactivity/primitives
 */

import { describe, it, expect } from 'vitest';
import {
  Signal,
  Computed,
  signal,
  computed,
  store,
  resource,
  createRoot,
} from '../../src/reactivity';
import { Resource } from '../../src/reactivity/resource';
import { Component } from '../../src/component/component';
import { Application, application } from '../../src/app/application';
import { settle, tick } from '../support/tick';

describe('primitive factories', () => {
  it('signal() creates a Signal', () => {
    const s = signal(1);
    expect(s).toBeInstanceOf(Signal);
    s.value = 2;
    expect(s.value).toBe(2);
  });

  it('signal() honors a custom equals', () => {
    const s = signal({ id: 1 }, { equals: (a, b) => a.id === b.id });
    const before = s.version;
    s.value = { id: 1 };
    expect(s.version).toBe(before);
  });

  it('computed() derives from signals', () => {
    const a = signal(2);
    const double = computed(() => a.value * 2);
    expect(double).toBeInstanceOf(Computed);
    a.value = 5;
    expect(double.value).toBe(10);
  });

  it('store() creates a reactive object', () => {
    const s = store({ count: 1 });
    s.set('count', 2);
    expect(s.state.count).toBe(2);
  });

  it('resource() with only a fetcher fetches right away', async () => {
    const r = resource(async () => 'data');
    expect(r).toBeInstanceOf(Resource);
    await tick();
    expect(r.value).toBe('data');
  });

  it('resource() with a source passes the source to the fetcher', async () => {
    const id = signal(4);
    const r = createRoot(() =>
      resource(
        () => id.value,
        async (n: number) => n * 10
      )
    );
    settle();
    await tick();
    expect(r.value).toBe(40);
  });

  it('application() wraps a root component', () => {
    class Root extends Component {
      protected render() {
        return document.createElement('div');
      }
    }
    expect(application(Root)).toBeInstanceOf(Application);
  });
});
