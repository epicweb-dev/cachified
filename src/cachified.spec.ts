import { format } from 'pretty-format';
import {
  cachified,
  CachifiedOptions,
  createBatch,
  CreateReporter,
  CacheMetadata,
  CacheEvent,
  CacheEntry,
} from './index';
import { Deferred } from './createBatch';

jest.mock('./index', () => {
  if (process.version.startsWith('v18')) {
    return jest.requireActual('./index');
  } else {
    console.log('⚠️ Running Tests against dist/index.cjs');
    return require('../dist/index.cjs');
  }
});

describe('cachified', () => {
  let currentTime = 0;
  beforeEach(() => {
    currentTime = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => currentTime);
  });

  it('caches a value', async () => {
    const cache = new Map<string, CacheEntry<string>>();
    const reporter = createReporter();
    const reporter2 = createReporter();

    const value = await cachified({
      cache,
      key: 'test',
      reporter,
      getFreshValue() {
        return 'ONE';
      },
    });

    const value2 = await cachified({
      cache,
      key: 'test',
      reporter: reporter2,
      getFreshValue() {
        throw new Error('🚧');
      },
    });

    expect(value).toBe('ONE');
    expect(report(reporter.mock.calls)).toMatchInlineSnapshot(`
    "1. init
       {key: 'test', metadata: {createdTime: 0, swv: 0, ttl: null}}
    2. getCachedValueStart
    3. getCachedValueRead
    4. getCachedValueEmpty
    5. getFreshValueStart
    6. getFreshValueSuccess
       {value: 'ONE'}
    7. writeFreshValueSuccess
       {metadata: {createdTime: 0, swv: 0, ttl: null}, written: true}"
    `);

    expect(value2).toBe('ONE');
    expect(report(reporter2.mock.calls)).toMatchInlineSnapshot(`
    "1. init
       {key: 'test', metadata: {createdTime: 0, swv: 0, ttl: null}}
    2. getCachedValueStart
    3. getCachedValueRead
       {entry: {metadata: {createdTime: 0, swv: 0, ttl: null}, value: 'ONE'}}
    4. getCachedValueSuccess
       {value: 'ONE'}"
    `);
  });

  it('throws when no fresh value can be received for empty cache', async () => {
    const cache = new Map<string, CacheEntry<string>>();
    const reporter = createReporter();

    const value = cachified({
      cache,
      key: 'test',
      reporter,
      getFreshValue() {
        throw new Error('🙈');
      },
    });

    await expect(value).rejects.toMatchInlineSnapshot(`[Error: 🙈]`);
    expect(report(reporter.mock.calls)).toMatchInlineSnapshot(`
    "1. init
       {key: 'test', metadata: {createdTime: 0, swv: 0, ttl: null}}
    2. getCachedValueStart
    3. getCachedValueRead
    4. getCachedValueEmpty
    5. getFreshValueStart
    6. getFreshValueError
       {error: [Error: 🙈]}"
    `);
  });

  it('throws when no forced fresh value can be received on empty cache', async () => {
    const cache = new Map<string, CacheEntry<string>>();

    const value = cachified({
      cache,
      key: 'test',
      forceFresh: true,
      getFreshValue() {
        throw new Error('☠️');
      },
    });

    await expect(value).rejects.toMatchInlineSnapshot(`[Error: ☠️]`);
  });

  it('throws when fresh value does not meet value check', async () => {
    const cache = new Map<string, CacheEntry<string>>();
    const reporter = createReporter();
    const reporter2 = createReporter();

    const value = cachified({
      cache,
      key: 'test',
      reporter,
      checkValue() {
        return '👮';
      },
      getFreshValue() {
        return 'ONE';
      },
    });

    await expect(value).rejects.toMatchInlineSnapshot(
      `[Error: check failed for fresh value of test]`,
    );
    expect(report(reporter.mock.calls)).toMatchInlineSnapshot(`
    "1. init
       {key: 'test', metadata: {createdTime: 0, swv: 0, ttl: null}}
    2. getCachedValueStart
    3. getCachedValueRead
    4. getCachedValueEmpty
    5. getFreshValueStart
    6. getFreshValueSuccess
       {value: 'ONE'}
    7. checkFreshValueError
       {reason: '👮'}"
    `);

    // The following lines only exist to have 100% coverage 😅
    const value2 = cachified({
      cache,
      key: 'test',
      reporter: reporter2,
      checkValue() {
        return false;
      },
      getFreshValue() {
        return 'ONE';
      },
    });
    await expect(value2).rejects.toMatchInlineSnapshot(
      `[Error: check failed for fresh value of test]`,
    );
    expect(report(reporter2.mock.calls)).toMatchInlineSnapshot(`
    "1. init
       {key: 'test', metadata: {createdTime: 0, swv: 0, ttl: null}}
    2. getCachedValueStart
    3. getCachedValueRead
    4. getCachedValueEmpty
    5. getFreshValueStart
    6. getFreshValueSuccess
       {value: 'ONE'}
    7. checkFreshValueError
       {reason: 'unknown'}"
    `);
  });

  it('gets different values for different keys', async () => {
    const cache = new Map<string, CacheEntry<string>>();

    const value = await cachified({
      cache,
      key: 'test',
      getFreshValue() {
        return 'ONE';
      },
    });
    const value2 = await cachified({
      cache,
      key: 'test-2',
      getFreshValue() {
        return 'TWO';
      },
    });

    expect(value).toBe('ONE');
    expect(value2).toBe('TWO');

    // sanity check that test-2 is also cached
    const value3 = await cachified({
      cache,
      key: 'test-2',
      getFreshValue() {
        return 'THREE';
      },
    });

    expect(value3).toBe('TWO');
  });

  it('gets fresh value when forced to', async () => {
    const cache = new Map<string, CacheEntry<string>>();

    const value = await cachified({
      cache,
      key: 'test',
      getFreshValue() {
        return 'ONE';
      },
    });
    const value2 = await cachified({
      cache,
      forceFresh: true,
      key: 'test',
      getFreshValue() {
        return 'TWO';
      },
    });

    expect(value).toBe('ONE');
    expect(value2).toBe('TWO');
  });

  it('falls back to cache when forced fresh value fails', async () => {
    const cache = new Map<string, CacheEntry<string>>();
    const reporter = createReporter();

    cache.set('test', createCacheEntry('ONE'));
    const value2 = await cachified({
      cache,
      key: 'test',
      forceFresh: true,
      reporter,
      getFreshValue: () => {
        throw '🤡';
      },
    });

    expect(value2).toBe('ONE');
    expect(report(reporter.mock.calls)).toMatchInlineSnapshot(`
    "1. init
       {key: 'test', metadata: {createdTime: 0, swv: 0, ttl: null}}
    2. getFreshValueStart
    3. getFreshValueError
       {error: '🤡'}
    4. getCachedValueStart
    5. getCachedValueRead
       {entry: {metadata: {createdTime: 0, swv: 0, ttl: null}, value: 'ONE'}}
    6. getFreshValueCacheFallback
       {value: 'ONE'}
    7. writeFreshValueSuccess
       {metadata: {createdTime: 0, swv: 0, ttl: null}, written: true}"
    `);
  });

  it('it throws when cache fallback is disabled and getting fresh value fails', async () => {
    const cache = new Map<string, CacheEntry<string>>();

    const value1 = await cachified({
      cache,
      key: 'test',
      getFreshValue: () => 'ONE',
    });
    const value2 = cachified({
      cache,
      key: 'test',
      forceFresh: true,
      fallbackToCache: false,
      getFreshValue: () => {
        throw '👾';
      },
    });

    expect(value1).toBe('ONE');
    await expect(value2).rejects.toMatchInlineSnapshot(`"👾"`);
  });

  it('handles cache write fails', async () => {
    const cache = new Map<string, CacheEntry<string>>();
    const setMock = jest.spyOn(cache, 'set');
    const reporter = createReporter();
    let i = 0;
    const getValue = () =>
      cachified({
        cache,
        key: 'test',
        reporter,
        getFreshValue: () => `value-${i++}`,
      });

    setMock.mockImplementationOnce(() => {
      throw '🔥';
    });
    expect(await getValue()).toBe('value-0');
    expect(await getValue()).toBe('value-1');
    expect(report(reporter.mock.calls)).toMatchInlineSnapshot(`
    " 1. init
        {key: 'test', metadata: {createdTime: 0, swv: 0, ttl: null}}
     2. getCachedValueStart
     3. getCachedValueRead
     4. getCachedValueEmpty
     5. getFreshValueStart
     6. getFreshValueSuccess
        {value: 'value-0'}
     7. writeFreshValueError
        {error: '🔥'}
     8. init
        {key: 'test', metadata: {createdTime: 0, swv: 0, ttl: null}}
     9. getCachedValueStart
    10. getCachedValueRead
    11. getCachedValueEmpty
    12. getFreshValueStart
    13. getFreshValueSuccess
        {value: 'value-1'}
    14. writeFreshValueSuccess
        {metadata: {createdTime: 0, swv: 0, ttl: null}, written: true}"
    `);
    expect(await getValue()).toBe('value-1');
  });

  it('gets fresh value when ttl is exceeded', async () => {
    const cache = new Map<string, CacheEntry<string>>();
    const reporter = createReporter();
    let i = 0;
    const getValue = () =>
      cachified({
        cache,
        key: 'test',
        reporter,
        ttl: 5,
        getFreshValue: () => `value-${i++}`,
      });

    expect(await getValue()).toBe('value-0');

    // does use cached value since ttl is not exceeded
    currentTime = 4;
    expect(await getValue()).toBe('value-0');

    // gets new value because ttl is exceeded
    currentTime = 6;
    expect(await getValue()).toBe('value-1');
    expect(report(reporter.mock.calls)).toMatchInlineSnapshot(`
    " 1. init
        {key: 'test', metadata: {createdTime: 0, swv: 0, ttl: 5}}
     2. getCachedValueStart
     3. getCachedValueRead
     4. getCachedValueEmpty
     5. getFreshValueStart
     6. getFreshValueSuccess
        {value: 'value-0'}
     7. writeFreshValueSuccess
        {metadata: {createdTime: 0, swv: 0, ttl: 5}, written: true}
     8. init
        {key: 'test', metadata: {createdTime: 4, swv: 0, ttl: 5}}
     9. getCachedValueStart
    10. getCachedValueRead
        {entry: {metadata: {createdTime: 0, swv: 0, ttl: 5}, value: 'value-0'}}
    11. getCachedValueSuccess
        {value: 'value-0'}
    12. init
        {key: 'test', metadata: {createdTime: 6, swv: 0, ttl: 5}}
    13. getCachedValueStart
    14. getCachedValueRead
        {entry: {metadata: {createdTime: 0, swv: 0, ttl: 5}, value: 'value-0'}}
    15. getCachedValueOutdated
        {metadata: {createdTime: 0, swv: 0, ttl: 5}, value: 'value-0'}
    16. getFreshValueStart
    17. getFreshValueSuccess
        {value: 'value-1'}
    18. writeFreshValueSuccess
        {metadata: {createdTime: 6, swv: 0, ttl: 5}, written: true}"
    `);
  });

  it('does not write to cache when ttl is exceeded before value is received', async () => {
    const cache = new Map<string, CacheEntry<string>>();
    const setMock = jest.spyOn(cache, 'set');
    const reporter = createReporter();

    const value = await cachified({
      cache,
      key: 'test',
      ttl: 5,
      reporter,
      getFreshValue() {
        currentTime = 6;
        return 'ONE';
      },
    });

    expect(value).toBe('ONE');
    expect(setMock).not.toHaveBeenCalled();
    expect(report(reporter.mock.calls)).toMatchInlineSnapshot(`
    "1. init
       {key: 'test', metadata: {createdTime: 0, swv: 0, ttl: 5}}
    2. getCachedValueStart
    3. getCachedValueRead
    4. getCachedValueEmpty
    5. getFreshValueStart
    6. getFreshValueSuccess
       {value: 'ONE'}
    7. writeFreshValueSuccess
       {metadata: {createdTime: 0, swv: 0, ttl: 5}, written: false}"
    `);
  });

  it('reuses pending fresh value for parallel calls', async () => {
    const cache = new Map<string, CacheEntry<string>>();
    const reporter = createReporter();
    const getValue = (
      getFreshValue: CachifiedOptions<string>['getFreshValue'],
    ) =>
      cachified({
        cache,
        key: 'test',
        reporter,
        getFreshValue,
      });

    const d = new Deferred<string>();
    const pValue1 = getValue(() => d.promise);
    // value from first call is pending so this one is never called
    const pValue2 = getValue(() => 'TWO');

    d.resolve('ONE');

    expect(await pValue1).toBe('ONE');
    expect(await pValue2).toBe('ONE');
    expect(report(reporter.mock.calls)).toMatchInlineSnapshot(`
    " 1. init
        {key: 'test', metadata: {createdTime: 0, swv: 0, ttl: null}}
     2. getCachedValueStart
     3. init
        {key: 'test', metadata: {createdTime: 0, swv: 0, ttl: null}}
     4. getCachedValueStart
     5. getCachedValueRead
     6. getCachedValueRead
     7. getCachedValueEmpty
     8. getCachedValueEmpty
     9. getFreshValueStart
    10. getFreshValueHookPending
    11. getFreshValueSuccess
        {value: 'ONE'}
    12. writeFreshValueSuccess
        {metadata: {createdTime: 0, swv: 0, ttl: null}, written: true}"
    `);
  });

  it('resolves earlier pending values with faster responses from later calls', async () => {
    const cache = new Map<string, CacheEntry<string>>();
    const getValue = (
      getFreshValue: CachifiedOptions<string>['getFreshValue'],
    ) =>
      cachified({
        cache,
        key: 'test',
        ttl: 5,
        getFreshValue,
      });

    const d1 = new Deferred<string>();
    const pValue1 = getValue(() => d1.promise);

    currentTime = 6;
    // value from first call is pending but ttl is also exceeded, get fresh value
    const d2 = new Deferred<string>();
    const pValue2 = getValue(() => d2.promise);

    currentTime = 12;
    // this one delivers the earliest response take it for all pending calls
    const pValue3 = getValue(() => 'THREE');

    expect(await pValue1).toBe('THREE');
    expect(await pValue2).toBe('THREE');
    expect(await pValue3).toBe('THREE');

    d1.resolve('ONE');
    d2.reject('TWO');

    // late responses from earlier calls do not update cache
    expect(await getValue(() => 'FOUR')).toBe('THREE');
  });

  it('uses stale cache while revalidating', async () => {
    const cache = new Map<string, CacheEntry<string>>();
    const reporter = createReporter();
    let i = 0;
    const getFreshValue = jest.fn(() => `value-${i++}`);
    const getValue = () =>
      cachified({
        cache,
        reporter,
        key: 'test',
        ttl: 5,
        staleWhileRevalidate: 10,
        getFreshValue,
      });

    expect(await getValue()).toBe('value-0');
    currentTime = 6;
    // receive cached response since call exceeds ttl but is in stale while revalidate range
    expect(await getValue()).toBe('value-0');
    // wait for next tick (revalidation is done in background)
    await delay(0);
    // We don't care about the latter calls
    const calls = [...reporter.mock.calls];

    // next call gets the revalidated response
    expect(await getValue()).toBe('value-1');
    expect(getFreshValue).toHaveBeenCalledTimes(2);

    // Does not deliver stale cache when swr is exceeded
    currentTime = 30;
    expect(await getValue()).toBe('value-2');
    expect(getFreshValue).toHaveBeenCalledTimes(3);

    expect(report(calls)).toMatchInlineSnapshot(`
    " 1. init
        {key: 'test', metadata: {createdTime: 0, swv: 10, ttl: 5}}
     2. getCachedValueStart
     3. getCachedValueRead
     4. getCachedValueEmpty
     5. getFreshValueStart
     6. getFreshValueSuccess
        {value: 'value-0'}
     7. writeFreshValueSuccess
        {metadata: {createdTime: 0, swv: 10, ttl: 5}, written: true}
     8. init
        {key: 'test', metadata: {createdTime: 6, swv: 10, ttl: 5}}
     9. getCachedValueStart
    10. getCachedValueRead
        {entry: {metadata: {createdTime: 0, swv: 10, ttl: 5}, value: 'value-0'}}
    11. getCachedValueSuccess
        {value: 'value-0'}
    12. refreshValueStart
    13. refreshValueSuccess
        {value: 'value-1'}"
    `);
  });

  it('supports infinite stale while revalidate', async () => {
    const cache = new Map<string, CacheEntry<string>>();
    let i = 0;
    const getFreshValue = jest.fn(() => `value-${i++}`);
    const getValue = () =>
      cachified({
        cache,
        key: 'test',
        ttl: 5,
        staleWhileRevalidate: Infinity,
        getFreshValue,
      });

    expect(await getValue()).toBe('value-0');
    currentTime = 6;
    expect(await getValue()).toBe('value-0');
    await delay(0);
    expect(await getValue()).toBe('value-1');
    expect(getFreshValue).toHaveBeenCalledTimes(2);

    // Does deliver stale cache in the far future
    currentTime = Infinity;
    expect(await getValue()).toBe('value-1');
    await delay(0);
    expect(await getValue()).toBe('value-2');
    expect(getFreshValue).toHaveBeenCalledTimes(3);
  });

  it('ignores errors when revalidating cache in the background', async () => {
    const cache = new Map<string, CacheEntry<string>>();
    const reporter = createReporter();
    let i = 0;
    const getFreshValue = jest.fn(() => `value-${i++}`);
    const getValue = () =>
      cachified({
        cache,
        key: 'test',
        ttl: 5,
        reporter,
        staleWhileRevalidate: 10,
        getFreshValue,
      });

    expect(await getValue()).toBe('value-0');
    currentTime = 6;
    getFreshValue.mockImplementationOnce(() => {
      throw new Error('💩');
    });
    // this triggers revalidation which errors but we don't care
    expect(await getValue()).toBe('value-0');
    await delay(0);
    // we don't care about later calls
    const calls = [...reporter.mock.calls];

    // this again triggers revalidation this time with no error
    expect(await getValue()).toBe('value-0');
    await delay(0);
    // next call gets the fresh value
    expect(await getValue()).toBe('value-1');
    expect(getFreshValue).toHaveBeenCalledTimes(3);
    expect(report(calls)).toMatchInlineSnapshot(`
    " 1. init
        {key: 'test', metadata: {createdTime: 0, swv: 10, ttl: 5}}
     2. getCachedValueStart
     3. getCachedValueRead
     4. getCachedValueEmpty
     5. getFreshValueStart
     6. getFreshValueSuccess
        {value: 'value-0'}
     7. writeFreshValueSuccess
        {metadata: {createdTime: 0, swv: 10, ttl: 5}, written: true}
     8. init
        {key: 'test', metadata: {createdTime: 6, swv: 10, ttl: 5}}
     9. getCachedValueStart
    10. getCachedValueRead
        {entry: {metadata: {createdTime: 0, swv: 10, ttl: 5}, value: 'value-0'}}
    11. getCachedValueSuccess
        {value: 'value-0'}
    12. refreshValueStart
    13. refreshValueError
        {error: [Error: 💩]}"
    `);
  });

  it('gets fresh value in case cached one does not meet value check', async () => {
    const cache = new Map<string, CacheEntry<string>>();
    const reporter = createReporter();
    const reporter2 = createReporter();

    cache.set('test', createCacheEntry('ONE'));
    const value = await cachified({
      cache,
      key: 'test',
      reporter,
      checkValue(value) {
        return value === 'TWO';
      },
      getFreshValue() {
        return 'TWO';
      },
    });

    expect(value).toBe('TWO');
    expect(report(reporter.mock.calls)).toMatchInlineSnapshot(`
    "1. init
       {key: 'test', metadata: {createdTime: 0, swv: 0, ttl: null}}
    2. getCachedValueStart
    3. getCachedValueRead
       {entry: {metadata: {createdTime: 0, swv: 0, ttl: null}, value: 'ONE'}}
    4. checkCachedValueError
       {reason: 'unknown'}
    5. getFreshValueStart
    6. getFreshValueSuccess
       {value: 'TWO'}
    7. writeFreshValueSuccess
       {metadata: {createdTime: 0, swv: 0, ttl: null}, written: true}"
    `);

    // the following lines only exist for 100% coverage 😅
    cache.set('test', createCacheEntry('ONE'));
    const value2 = await cachified({
      cache,
      key: 'test',
      reporter: reporter2,
      checkValue(value) {
        return value === 'TWO' ? true : '🖕';
      },
      getFreshValue() {
        return 'TWO';
      },
    });
    expect(value2).toBe('TWO');
    expect(report(reporter2.mock.calls)).toMatchInlineSnapshot(`
    "1. init
       {key: 'test', metadata: {createdTime: 0, swv: 0, ttl: null}}
    2. getCachedValueStart
    3. getCachedValueRead
       {entry: {metadata: {createdTime: 0, swv: 0, ttl: null}, value: 'ONE'}}
    4. checkCachedValueError
       {reason: '🖕'}
    5. getFreshValueStart
    6. getFreshValueSuccess
       {value: 'TWO'}
    7. writeFreshValueSuccess
       {metadata: {createdTime: 0, swv: 0, ttl: null}, written: true}"
    `);
  });

  it('supports batch-getting fresh values', async () => {
    const cache = new Map<string, CacheEntry<string>>();
    cache.set('test-2', createCacheEntry('YOLO!', { swv: null }));
    const getValues = jest.fn((indexes: number[]) =>
      indexes.map((i) => `value-${i}`),
    );
    const batch = createBatch(getValues);

    const values = await Promise.all(
      [1, 2, 3].map((index) =>
        cachified({
          cache,
          key: `test-${index}`,
          getFreshValue: batch.add(index),
        }),
      ),
    );

    // It's not possible to re-use batches
    expect(() => {
      batch.add(77);
    }).toThrowErrorMatchingInlineSnapshot(
      `"Can not add to batch after submission"`,
    );

    expect(values).toEqual(['value-1', 'YOLO!', 'value-3']);
    expect(getValues).toHaveBeenCalledTimes(1);
    expect(getValues).toHaveBeenCalledWith([1, 3]);
  });

  it('rejects all values when batch get fails', async () => {
    const cache = new Map<string, CacheEntry<string>>();

    const batch = createBatch<string, any>(() => {
      throw new Error('🥊');
    });

    const values = [1, 2, 3].map((index) =>
      cachified({
        cache,
        key: `test-${index}`,
        getFreshValue: batch.add(index),
      }),
    );

    await expect(values[0]).rejects.toMatchInlineSnapshot(`[Error: 🥊]`);
    await expect(values[1]).rejects.toMatchInlineSnapshot(`[Error: 🥊]`);
    await expect(values[2]).rejects.toMatchInlineSnapshot(`[Error: 🥊]`);
  });

  it('supports manual submission of batch', async () => {
    const cache = new Map<string, CacheEntry<string>>();
    const getValues = jest.fn((indexes: (number | string)[]) =>
      indexes.map((i) => `value-${i}`),
    );
    const batch = createBatch(getValues, false);

    const valuesP = Promise.all(
      [1, 'seven'].map((index) =>
        cachified({
          cache,
          key: `test-${index}`,
          getFreshValue: batch.add(index),
        }),
      ),
    );
    await delay(0);
    expect(getValues).not.toHaveBeenCalled();

    await batch.submit();

    expect(await valuesP).toEqual(['value-1', 'value-seven']);
    expect(getValues).toHaveBeenCalledTimes(1);
    expect(getValues).toHaveBeenCalledWith([1, 'seven']);
  });

  it('does not use faulty cache entries', async () => {
    expect.assertions(23);
    const cache = new Map<string, any>();

    const getValue = (reporter: CreateReporter<string>) =>
      cachified({
        cache,
        key: 'test',
        reporter,
        getFreshValue() {
          return 'ONE';
        },
      });

    cache.set('test', 'THIS IS NOT AN OBJECT');
    expect(
      await getValue(() => (event) => {
        if (event.name === 'getCachedValueError') {
          expect(event.error).toMatchInlineSnapshot(
            `[Error: Cache entry for test is not a cache entry object, it's a string]`,
          );
        }
      }),
    ).toBe('ONE');

    cache.set('test', { metadata: { ttl: null, createdTime: Date.now() } });
    expect(
      await getValue(() => (event) => {
        if (event.name === 'getCachedValueError') {
          expect(event.error).toMatchInlineSnapshot(
            `[Error: Cache entry for test does not have a value property]`,
          );
        }
      }),
    ).toBe('ONE');

    const wrongMetadata = [
      {}, // Missing
      { metadata: '' }, // Not an object
      { metadata: null }, // YEAH...
      { metadata: [] }, // Also not the kind of object we like
      { metadata: {} }, // empty object...
      { metadata: { ttl: 60 } }, // missing created time
      { metadata: { createdTime: 'yesterday' } }, // wrong created time
      { metadata: { ttl: '1h', createdTime: 1234 } }, // wrong ttl
      { metadata: { swr: '1y', createdTime: 1234 } }, // wrong swr
    ];
    for (let metadata of wrongMetadata) {
      cache.set('test', { value: 'FOUR', ...metadata });
      expect(
        await getValue(() => (event) => {
          if (event.name === 'getCachedValueError') {
            expect(event.error).toMatchInlineSnapshot(
              `[Error: Cache entry for test does not have valid metadata property]`,
            );
          }
        }),
      ).toBe('ONE');
    }

    // sanity check that we can set a valid entry to cache manually
    cache.set('test', {
      value: 'FOUR',
      metadata: { ttl: null, swr: null, createdTime: Date.now() },
    });
    expect(await getValue(() => () => {})).toBe('FOUR');
  });
});

const noopLogger = {
  log() {
    /* ¯\_(ツ)_/¯ */
  },
  error() {
    /* ¯\_(ツ)_/¯ */
  },
  warn() {
    /* ¯\_(ツ)_/¯ */
  },
};

function delay(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

function createReporter() {
  const reporter = jest.fn();
  const creator = (key: string, metadata: CacheMetadata) => {
    reporter({ name: 'init', key, metadata });
    return reporter;
  };
  creator.mock = reporter.mock;
  return creator;
}

function createCacheEntry<Value>(
  value: Value,
  metadata: Partial<CacheMetadata> = {},
): CacheEntry<Value> {
  return {
    value,
    metadata: { createdTime: Date.now(), ttl: null, swv: 0, ...metadata },
  };
}

function report(calls: [event: CacheEvent<any>][]) {
  const totalCalls = String(calls.length + 1).length;
  return calls
    .map(([{ name, ...payload }], i) => {
      const data = JSON.stringify(payload);
      const title = `${String(i + 1).padStart(totalCalls, ' ')}. ${name}`;
      if (!payload || data === '{}') {
        return title;
      }
      return `${title}\n${String('').padStart(totalCalls + 2, ' ')}${format(
        payload,
        {
          min: true,
          plugins: [
            {
              test(val) {
                return typeof val === 'string';
              },
              serialize(val, config, indentation, depth, refs) {
                return refs[0] &&
                  typeof refs[0] === 'object' &&
                  Object.keys(refs[refs.length - 1] as any).includes(val)
                  ? val
                  : `'${val}'`;
              },
            },
          ],
        },
      )}`;
    })
    .join('\n');
}
