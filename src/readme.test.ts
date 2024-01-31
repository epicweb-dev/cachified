import runIntroExample from '../examples/usage-intro';
import runLruAdapterExample from '../examples/lru-adapter';
import runStaleWhileRevalidateExample from '../examples/stale-while-revalidate';
import runForceFreshExample from '../examples/force-fresh';
import runTypeSafetyExample from '../examples/type-safety';
import runTypeSafetyZodExample from '../examples/type-safety-zod';
import runManualExample from '../examples/manual-cache-interactions';
import runMigrateExample from '../examples/migrating-values';
import runSoftPurgeExample from '../examples/soft-purge';
import runFineTuneExample from '../examples/metadata-fine-tuning';
import runBatchExample from '../examples/batch-operations';

/* We just check that there are no ts errors in these */
import runReporterExample from '../examples/verbose-reporter';

import { createCacheEntry } from './common';

let time = { current: 0 };
beforeEach(() => {
  time.current = 0;
  jest.spyOn(Date, 'now').mockImplementation(() => time.current);
});

describe('readme', () => {
  test('intro', async () => {
    const console = createConsole();
    const fetch = createCountingFetch();
    await runIntroExample({ console, fetch, time });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(console.log).toHaveBeenCalledTimes(3);
    expect(console.log).toHaveBeenNthCalledWith(1, fetchCallNr(0));
    expect(console.log).toHaveBeenNthCalledWith(2, fetchCallNr(0));
    expect(console.log).toHaveBeenNthCalledWith(3, fetchCallNr(1));
  });

  test('lru-adapter', async () => {
    const cache = await runLruAdapterExample();

    expect(cache.get('user-1')).toEqual(createCacheEntry('user@example.org'));
  });

  test('stale-while-revalidate', async () => {
    const console = createConsole();
    const fetch = createCountingFetch();
    await runStaleWhileRevalidateExample({ console, fetch, time });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(console.log).toHaveBeenCalledTimes(4);
    expect(console.log).toHaveBeenNthCalledWith(1, fetchCallNr(0));
    expect(console.log).toHaveBeenNthCalledWith(2, fetchCallNr(0));
    expect(console.log).toHaveBeenNthCalledWith(3, fetchCallNr(0));
    expect(console.log).toHaveBeenNthCalledWith(4, fetchCallNr(1));
  });

  test('force-fresh', async () => {
    const console = createConsole();
    const fetch = createCountingFetch();
    await runForceFreshExample({ console, fetch, time });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(console.log).toHaveBeenCalledTimes(2);
    expect(console.log).toHaveBeenNthCalledWith(1, fetchCallNr(0));
    expect(console.log).toHaveBeenNthCalledWith(2, fetchCallNr(1));
  });

  test('type-safety', async () => {
    const console = createConsole();
    const fetch = createCountingFetch();
    await runTypeSafetyExample({ console, time, fetch });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledTimes(2);
    expect(console.log).toHaveBeenNthCalledWith(1, fetchCallNr(0));
    expect(console.log).toHaveBeenNthCalledWith(2, fetchCallNr(0));
  });

  test('type-safety-zod', async () => {
    const console = createConsole();
    const fetch = createCountingFetch();
    await runTypeSafetyZodExample({ console, time, fetch });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledTimes(2);
    expect(console.log).toHaveBeenNthCalledWith(1, fetchCallNr(0));
    expect(console.log).toHaveBeenNthCalledWith(2, fetchCallNr(0));
  });

  test('manual-working', async () => {
    const console = createConsole();
    const cache = await runManualExample({ console, time });

    expect(console.log).toHaveBeenCalledTimes(2);
    expect(console.log).toHaveBeenNthCalledWith(1, 'someone@example.org');
    expect(console.log).toHaveBeenNthCalledWith(2, 'someone@example.org');

    expect(cache.size).toBe(0);
  });

  test('migrating', async () => {
    const console = createConsole();
    await runMigrateExample({ console, time });

    expect(console.log).toHaveBeenCalledTimes(2);
    expect(console.log).toHaveBeenNthCalledWith(1, {
      email: 'someone@example.org',
    });
    expect(console.log).toHaveBeenNthCalledWith(2, {
      email: 'someone@example.org',
    });
  });

  test('soft-purge', async () => {
    const console = createConsole();
    const fetch = createCountingFetch();
    await runSoftPurgeExample({ console, time, fetch });

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(console.log).toHaveBeenCalledTimes(4);
    expect(console.log).toHaveBeenNthCalledWith(1, fetchCallNr(0));
    expect(console.log).toHaveBeenNthCalledWith(2, fetchCallNr(0));
    expect(console.log).toHaveBeenNthCalledWith(3, fetchCallNr(1));
    expect(console.log).toHaveBeenNthCalledWith(4, fetchCallNr(2));
  });

  test('fine-tune', async () => {
    const cache = await runFineTuneExample({
      fetch: (() => {
        return Promise.resolve({
          json() {
            return null;
          },
        });
      }) as any as typeof global.fetch,
    });

    expect(cache.size).toBe(0);
  });

  test('batch', async () => {
    const console = createConsole();
    let i = 0;
    const fetch = jest.fn((url: string) => {
      const params = new URL(url).searchParams;
      const ids = params.get('ids')!.split(',');
      const callId = i++;

      return Promise.resolve({
        json() {
          const data = ids.map((id) => ({
            email: `hi-${id}-${callId}@example.org`,
            username: 'asd',
          }));

          return Promise.resolve(data);
        },
      });
    }) as any as typeof global.fetch;
    await runBatchExample({ console, time, fetch });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(console.log).toHaveBeenCalledTimes(2);
    expect(console.log).toHaveBeenNthCalledWith(1, [
      expect.objectContaining({
        email: `hi-1-0@example.org`,
      }),
      expect.objectContaining({
        email: `hi-2-0@example.org`,
      }),
    ]);
    expect(console.log).toHaveBeenNthCalledWith(2, [
      expect.objectContaining({
        email: `hi-2-0@example.org`,
      }),
      expect.objectContaining({
        email: `hi-3-1@example.org`,
      }),
    ]);
  });
});

function fetchCallNr(i: number) {
  return expect.objectContaining({
    email: `hi-${i}@example.org`,
  });
}

function createConsole() {
  return {
    ...console,
    log: jest.fn(),
  };
}

function createCountingFetch() {
  let i = 0;
  return jest.fn(() => {
    return Promise.resolve({
      json() {
        return Promise.resolve({
          email: `hi-${i++}@example.org`,
          username: 'asd',
        });
      },
    });
  }) as any as typeof global.fetch;
}
