/**
 * Tests for Resource (async data with loading and error state)
 */

import { describe, it, expect, vi } from 'vitest';
import { Resource } from '../../src/reactivity/resource';
import { Signal, createRoot, effect } from '../../src/reactivity';
import { settle, tick } from '../support/tick';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('Resource', () => {
  describe('without a source', () => {
    it('fetches right away and moves from pending to ready', async () => {
      const d = deferred<string>();
      const resource = new Resource(() => d.promise);

      expect(resource.state).toBe('pending');
      expect(resource.loading).toBe(true);
      expect(resource.value).toBeUndefined();

      d.resolve('done');
      await tick();

      expect(resource.state).toBe('ready');
      expect(resource.loading).toBe(false);
      expect(resource.value).toBe('done');
    });

    it('starts from initialValue', () => {
      const resource = new Resource(() => new Promise<number>(() => {}), {
        initialValue: 1,
      });
      expect(resource.value).toBe(1);
    });

    it('keeps the last value during a refetch, and in bindings', async () => {
      let call = 0;
      const pending: ReturnType<typeof deferred<number>>[] = [];
      const resource = new Resource(() => {
        call++;
        const d = deferred<number>();
        pending.push(d);
        return d.promise;
      });
      const seen: (number | undefined)[] = [];
      const dispose = createRoot((d) => {
        effect(() => {
          seen.push(resource.value);
        });
        return d;
      });
      settle();

      pending[0]!.resolve(1);
      await tick();
      settle();
      void resource.refetch();
      settle();
      expect(resource.state).toBe('refreshing');
      expect(resource.value).toBe(1);

      pending[1]!.resolve(2);
      await tick();
      settle();
      expect(call).toBe(2);
      expect(seen).toEqual([undefined, 1, 2]);
      dispose();
    });

    it('records errors and wraps non-Error rejections', async () => {
      const resource = new Resource(() => Promise.reject('nope'));
      await tick();

      expect(resource.state).toBe('errored');
      expect(resource.error).toBeInstanceOf(Error);
      expect(resource.error?.message).toBe('nope');
      expect(resource.loading).toBe(false);
    });

    it('refetches as refreshing and passes refetch info', async () => {
      const fetcher = vi.fn(
        async (info: { value: unknown; refetching: unknown }) =>
          info.refetching ? 'second' : 'first'
      );
      const resource = new Resource(fetcher);
      await tick();
      expect(resource.value).toBe('first');

      const pending = resource.refetch('manual');
      expect(resource.state).toBe('refreshing');
      expect(await pending).toBe('second');
      expect(fetcher).toHaveBeenLastCalledWith({
        value: 'first',
        refetching: 'manual',
        signal: expect.any(AbortSignal),
      });
    });

    it('stays refreshing when it refetches during a refetch', async () => {
      const seen: unknown[] = [];
      const resource = new Resource(async (info) => {
        seen.push(info.refetching);
        return 'value';
      });
      await tick();

      void resource.refetch();
      void resource.refetch();
      expect(resource.state).toBe('refreshing');
      expect(seen).toEqual([false, true, true]);
      await tick();
      expect(resource.state).toBe('ready');
    });

    it('clears the error after a successful refetch', async () => {
      let fail = true;
      const resource = new Resource(async () => {
        if (fail) throw new Error('boom');
        return 'ok';
      });
      await tick();
      expect(resource.state).toBe('errored');

      fail = false;
      await resource.refetch();
      expect(resource.state).toBe('ready');
      expect(resource.error).toBeUndefined();
    });

    it('mutate sets the value locally without fetching', async () => {
      const fetcher = vi.fn(async () => 1);
      const resource = new Resource(fetcher);
      await tick();

      expect(resource.mutate((prev) => (prev ?? 0) + 10)).toBe(11);
      expect(resource.value).toBe(11);
      expect(resource.state).toBe('ready');
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('keeps only the latest of overlapping fetches', async () => {
      const first = deferred<string>();
      const second = deferred<string>();
      const results = [first, second];
      const resource = new Resource(() => results.shift()!.promise);

      const refetched = resource.refetch();
      second.resolve('new');
      await refetched;
      first.resolve('old');
      await tick();

      expect(resource.value).toBe('new');
    });

    it('exposes its name', () => {
      const resource = new Resource(async () => 1, { name: 'user' });
      expect(resource.name).toBe('user');
    });
  });

  describe('with a source', () => {
    it('fetches with the source value and refetches when it changes', async () => {
      const id = new Signal(1);
      const fetcher = vi.fn(async (source: number) => `user ${source}`);

      const resource = createRoot(() => new Resource(() => id.value, fetcher));
      settle();
      await tick();
      expect(resource.value).toBe('user 1');

      id.value = 2;
      settle();
      await tick();
      expect(resource.value).toBe('user 2');
      expect(fetcher.mock.calls.map((c) => c[0])).toEqual([1, 2]);
    });

    it('waits while the source is null, undefined or false', async () => {
      const id = new Signal<number | null>(null);
      const fetcher = vi.fn(async (source: number | null) => source);

      const resource = createRoot(() => new Resource(() => id.value, fetcher));
      settle();
      await tick();
      expect(fetcher).not.toHaveBeenCalled();
      expect(resource.state).toBe('unresolved');

      id.value = 5;
      settle();
      await tick();
      expect(resource.value).toBe(5);
    });

    it('does not fetch again when only its own state changes', async () => {
      const id = new Signal(1);
      const fetcher = vi.fn(async (source: number) => source);

      createRoot(() => new Resource(() => id.value, fetcher));
      for (let i = 0; i < 5; i++) {
        settle();
        await tick();
      }

      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('ignores a stale response when the source changes mid fetch', async () => {
      const id = new Signal(1);
      const pending = new Map<number, ReturnType<typeof deferred<string>>>();
      const resource = createRoot(
        () =>
          new Resource(
            () => id.value,
            (source: number) => {
              const d = deferred<string>();
              pending.set(source, d);
              return d.promise;
            }
          )
      );
      settle();

      id.value = 2;
      settle();
      pending.get(2)!.resolve('two');
      await tick();
      pending.get(1)!.resolve('one');
      await tick();

      expect(resource.value).toBe('two');
    });
  });
});

describe('Resource cancellation', () => {
  it('aborts the previous fetch when a newer one starts', async () => {
    const signals: AbortSignal[] = [];
    const resource = new Resource((info) => {
      signals.push(info.signal);
      return new Promise<string>(() => {});
    });

    void resource.refetch();
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
    resource.dispose();
    expect(signals[1]!.aborted).toBe(true);
  });

  it('ignores a fetch that resolves after dispose', async () => {
    const d = deferred<string>();
    const resource = new Resource(() => d.promise);
    resource.dispose();
    d.resolve('late');
    await tick();
    expect(resource.value).toBeUndefined();
    expect(resource.disposed).toBe(true);
  });

  it('is not loading after dispose during the first fetch', async () => {
    const d = deferred<string>();
    const resource = new Resource(() => d.promise);
    expect(resource.loading).toBe(true);
    resource.dispose();
    expect(resource.loading).toBe(false);
    expect(resource.state).toBe('unresolved');
    d.resolve('late');
    await tick();
    expect(resource.loading).toBe(false);
    expect(resource.value).toBeUndefined();
  });

  it('keeps its value and is not loading after dispose during a refresh', async () => {
    const calls: ReturnType<typeof deferred<string>>[] = [];
    const resource = new Resource(() => {
      const d = deferred<string>();
      calls.push(d);
      return d.promise;
    });
    calls[0]!.resolve('first');
    await tick();
    expect(resource.value).toBe('first');
    void resource.refetch();
    expect(resource.loading).toBe(true);
    resource.dispose();
    expect(resource.loading).toBe(false);
    expect(resource.state).toBe('ready');
    expect(resource.value).toBe('first');
  });

  it('leaves a settled resource as it is on dispose', async () => {
    const resource = new Resource(async () => 'done');
    await tick();
    expect(resource.state).toBe('ready');
    resource.dispose();
    expect(resource.state).toBe('ready');
    expect(resource.value).toBe('done');
  });

  it('leaves an errored resource as it is on dispose', async () => {
    const resource = new Resource(async () => {
      throw new Error('nope');
    });
    await tick();
    resource.dispose();
    expect(resource.state).toBe('errored');
  });

  it('stops refetching on source changes after dispose', async () => {
    const id = new Signal(1);
    const fetcher = vi.fn(async (n: number) => n);

    const dispose = createRoot((dispose) => {
      const resource = new Resource(() => id.value, fetcher);
      settle();
      resource.dispose();
      return dispose;
    });
    id.value = 2;
    settle();
    await tick();

    expect(fetcher).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('aborts the fetch in flight when the owner is disposed', () => {
    let signal!: AbortSignal;
    const dispose = createRoot((dispose) => {
      new Resource((info) => {
        signal = info.signal;
        return new Promise<string>(() => {});
      });
      return dispose;
    });
    dispose();
    expect(signal.aborted).toBe(true);
  });
});

describe('Resource with a source that turns falsy', () => {
  const setup = () => {
    const id = new Signal<number | null>(1);
    const pending: Array<ReturnType<typeof deferred<string>>> = [];
    const signals: AbortSignal[] = [];
    const resource = createRoot(
      () =>
        new Resource(
          () => id.value,
          (_source: number | null, { signal }) => {
            signals.push(signal);
            const d = deferred<string>();
            pending.push(d);
            return d.promise;
          }
        )
    );
    settle();
    return { id, pending, signals, resource };
  };

  it('drops the first fetch in flight', async () => {
    const { id, pending, signals, resource } = setup();
    id.value = null;
    settle();
    expect(signals[0]!.aborted).toBe(true);
    expect(resource.loading).toBe(false);
    expect(resource.state).toBe('unresolved');

    pending[0]!.resolve('user 1');
    await tick();
    expect(resource.value).toBeUndefined();
  });

  it('keeps the value it had when a refresh is dropped', async () => {
    const { id, pending, resource } = setup();
    pending[0]!.resolve('user 1');
    await tick();
    id.value = 2;
    settle();
    id.value = null;
    settle();
    expect(resource.state).toBe('ready');

    pending[1]!.resolve('user 2');
    await tick();
    expect(resource.value).toBe('user 1');
  });
});

describe('Resource tracking', () => {
  it('does not refetch when a signal the fetcher reads changes', () => {
    const id = new Signal(1);
    const token = new Signal('a');
    const fetcher = vi.fn((source: number) => {
      void token.value;
      return Promise.resolve(source);
    });
    createRoot((dispose) => {
      new Resource(() => id.value, fetcher);
      settle();
      expect(fetcher).toHaveBeenCalledTimes(1);

      token.value = 'b';
      settle();
      expect(fetcher).toHaveBeenCalledTimes(1);

      id.value = 2;
      settle();
      expect(fetcher).toHaveBeenCalledTimes(2);
      dispose();
    });
  });

  it('refetch() inside an effect does not subscribe it to the source', () => {
    const id = new Signal(1);
    const runs = vi.fn();
    createRoot((dispose) => {
      const r = new Resource(
        () => id.value,
        (s: number) => Promise.resolve(s)
      );
      effect(() => {
        runs();
        void r.refetch();
      });
      settle();
      id.value = 2;
      settle();
      expect(runs).toHaveBeenCalledTimes(1);
      dispose();
    });
  });
});
