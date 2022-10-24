import { format } from 'pretty-format';
import LRUCache from 'lru-cache';
import { createClient as createRedis3Client } from 'redis-mock';
import {
  cachified,
  CachifiedOptions,
  Context,
  createBatch,
  CreateReporter,
  CacheMetadata,
  CacheEvent,
  CacheEntry,
  verboseReporter,
  lruCacheAdapter,
  redis3CacheAdapter,
  redisCacheAdapter,
  RedisLikeCache,
  totalTtl,
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

let currentTime = 0;
beforeEach(() => {
  currentTime = 0;
  jest.spyOn(Date, 'now').mockImplementation(() => currentTime);
});

describe('cachified', () => {
  it('caches a value', async () => {
    const cache = new Map<string, CacheEntry>();
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
   {key: 'test', metadata: {createdTime: 0, swr: 0, ttl: null}}
2. getCachedValueStart
3. getCachedValueRead
4. getCachedValueEmpty
5. getFreshValueStart
6. getFreshValueSuccess
   {value: 'ONE'}
7. writeFreshValueSuccess
   {metadata: {createdTime: 0, swr: 0, ttl: null}, migrated: false, written: true}"
`);

    expect(value2).toBe('ONE');
    expect(report(reporter2.mock.calls)).toMatchInlineSnapshot(`
"1. init
   {key: 'test', metadata: {createdTime: 0, swr: 0, ttl: null}}
2. getCachedValueStart
3. getCachedValueRead
   {entry: {metadata: {createdTime: 0, swr: 0, ttl: null}, value: 'ONE'}}
4. getCachedValueSuccess
   {migrated: false, value: 'ONE'}"
`);
  });

  it('immediately refreshes when ttl is 0', async () => {
    const cache = new Map<string, CacheEntry>();

    const value = await cachified({
      cache,
      key: 'test',
      ttl: 0,
      getFreshValue() {
        return 'ONE';
      },
    });

    currentTime = 1;
    const value2 = await cachified({
      cache,
      key: 'test',
      ttl: 0,
      getFreshValue() {
        return 'TWO';
      },
    });

    expect(value).toBe('ONE');
    expect(value2).toBe('TWO');
  });

  it('caches undefined values', async () => {
    const cache = new Map<string, CacheEntry>();

    const value = await cachified({
      cache,
      key: 'test',
      getFreshValue() {
        return undefined;
      },
    });

    const value2 = await cachified({
      cache,
      key: 'test',
      getFreshValue() {
        throw new Error('🛸');
      },
    });

    expect(value).toBe(undefined);
    expect(value2).toBe(undefined);
  });

  it('caches null values', async () => {
    const cache = new Map<string, CacheEntry>();

    const value = await cachified({
      cache,
      key: 'test',
      getFreshValue() {
        return null;
      },
    });

    const value2 = await cachified({
      cache,
      key: 'test',
      getFreshValue() {
        throw new Error('🛸');
      },
    });

    expect(value).toBe(null);
    expect(value2).toBe(null);
  });

  it('throws when no fresh value can be received for empty cache', async () => {
    const cache = new Map<string, CacheEntry>();
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
       {key: 'test', metadata: {createdTime: 0, swr: 0, ttl: null}}
    2. getCachedValueStart
    3. getCachedValueRead
    4. getCachedValueEmpty
    5. getFreshValueStart
    6. getFreshValueError
       {error: [Error: 🙈]}"
    `);
  });

  it('throws when no forced fresh value can be received on empty cache', async () => {
    const cache = new Map<string, CacheEntry>();

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
    const cache = new Map<string, CacheEntry>();
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
       {key: 'test', metadata: {createdTime: 0, swr: 0, ttl: null}}
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
       {key: 'test', metadata: {createdTime: 0, swr: 0, ttl: null}}
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

  it('supports migrating cached values', async () => {
    const cache = new Map<string, CacheEntry>();
    const reporter = createReporter();

    cache.set('weather', createCacheEntry('☁️'));
    const value = await cachified({
      cache,
      reporter,
      key: 'weather',
      checkValue(value, migrate) {
        if (value === '☁️') {
          return migrate('☀️');
        }
      },
      getFreshValue() {
        throw new Error('Never');
      },
    });

    expect(value).toBe('☀️');
    await delay(1);
    expect(cache.get('weather')?.value).toBe('☀️');
    expect(report(reporter.mock.calls)).toMatchInlineSnapshot(`
"1. init
   {key: 'weather', metadata: {createdTime: 0, swr: 0, ttl: null}}
2. getCachedValueStart
3. getCachedValueRead
   {entry: {metadata: {createdTime: 0, swr: 0, ttl: null}, value: '☁️'}}
4. getCachedValueSuccess
   {migrated: true, value: '☀️'}"
`);
  });

  it('supports async value checkers that throw', async () => {
    const cache = new Map<string, CacheEntry>();
    const reporter = createReporter();

    const value = cachified({
      cache,
      reporter,
      key: 'weather',
      async checkValue(value) {
        if (value === '☁️') {
          throw new Error('Bad Weather');
        }
      },
      getFreshValue() {
        return '☁️';
      },
    });

    await expect(value).rejects.toMatchInlineSnapshot(
      `[Error: check failed for fresh value of weather]`,
    );
    expect(report(reporter.mock.calls)).toMatchInlineSnapshot(`
"1. init
   {key: 'weather', metadata: {createdTime: 0, swr: 0, ttl: null}}
2. getCachedValueStart
3. getCachedValueRead
4. getCachedValueEmpty
5. getFreshValueStart
6. getFreshValueSuccess
   {value: '☁️'}
7. checkFreshValueError
   {reason: 'Bad Weather'}"
`);

    // Considers anything thrown as an error

    const value2 = cachified({
      cache,
      reporter,
      key: 'weather',
      async checkValue(value) {
        if (value === '☁️') {
          throw { custom: 'idk..' };
        }
      },
      getFreshValue() {
        return '☁️';
      },
    });

    await expect(value2).rejects.toMatchInlineSnapshot(
      `[Error: check failed for fresh value of weather]`,
    );
  });

  it('does not write migrated value to cache in case a new fresh value is already incoming', async () => {
    const cache = new Map<string, CacheEntry>();
    const reporter = createReporter();

    cache.set('weather', createCacheEntry('☁️'));
    const migration = new Deferred<void>();
    const getValue2 = new Deferred<string>();
    const value = cachified({
      cache,
      reporter,
      key: 'weather',
      async checkValue(value, migrate) {
        if (value === '☁️') {
          await migration.promise;
          return migrate('☀️');
        }
      },
      getFreshValue() {
        throw new Error('Never');
      },
    });

    const value2 = cachified({
      cache,
      reporter,
      forceFresh: true,
      key: 'weather',
      getFreshValue() {
        return getValue2.promise;
      },
    });

    migration.resolve();
    expect(await value).toBe('☀️');
    await delay(1);
    expect(cache.get('weather')?.value).toBe('☁️');

    getValue2.resolve('🌈');
    expect(await value2).toBe('🌈');
    expect(cache.get('weather')?.value).toBe('🌈');
  });

  it('gets different values for different keys', async () => {
    const cache = new Map<string, CacheEntry>();

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
    const cache = new Map<string, CacheEntry>();

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
    const cache = new Map<string, CacheEntry>();
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
   {key: 'test', metadata: {createdTime: 0, swr: 0, ttl: null}}
2. getFreshValueStart
3. getFreshValueError
   {error: '🤡'}
4. getCachedValueStart
5. getCachedValueRead
   {entry: {metadata: {createdTime: 0, swr: 0, ttl: null}, value: 'ONE'}}
6. getFreshValueCacheFallback
   {value: 'ONE'}
7. writeFreshValueSuccess
   {metadata: {createdTime: 0, swr: 0, ttl: null}, migrated: false, written: true}"
`);
  });

  it('does not fall back to outdated cache', async () => {
    const cache = new Map<string, CacheEntry>();
    const reporter = createReporter();

    cache.set('test', createCacheEntry('ONE', { ttl: 5 }));
    currentTime = 15;
    const value = cachified({
      cache,
      key: 'test',
      forceFresh: true,
      reporter,
      fallbackToCache: 10,
      getFreshValue: () => {
        throw '🤡';
      },
    });

    await expect(value).rejects.toMatchInlineSnapshot(`"🤡"`);
  });

  it('it throws when cache fallback is disabled and getting fresh value fails', async () => {
    const cache = new Map<string, CacheEntry>();

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
    const cache = new Map<string, CacheEntry>();
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
    {key: 'test', metadata: {createdTime: 0, swr: 0, ttl: null}}
 2. getCachedValueStart
 3. getCachedValueRead
 4. getCachedValueEmpty
 5. getFreshValueStart
 6. getFreshValueSuccess
    {value: 'value-0'}
 7. writeFreshValueError
    {error: '🔥'}
 8. init
    {key: 'test', metadata: {createdTime: 0, swr: 0, ttl: null}}
 9. getCachedValueStart
10. getCachedValueRead
11. getCachedValueEmpty
12. getFreshValueStart
13. getFreshValueSuccess
    {value: 'value-1'}
14. writeFreshValueSuccess
    {metadata: {createdTime: 0, swr: 0, ttl: null}, migrated: false, written: true}"
`);
    expect(await getValue()).toBe('value-1');
  });

  it('gets fresh value when ttl is exceeded', async () => {
    const cache = new Map<string, CacheEntry>();
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
    {key: 'test', metadata: {createdTime: 0, swr: 0, ttl: 5}}
 2. getCachedValueStart
 3. getCachedValueRead
 4. getCachedValueEmpty
 5. getFreshValueStart
 6. getFreshValueSuccess
    {value: 'value-0'}
 7. writeFreshValueSuccess
    {metadata: {createdTime: 0, swr: 0, ttl: 5}, migrated: false, written: true}
 8. init
    {key: 'test', metadata: {createdTime: 4, swr: 0, ttl: 5}}
 9. getCachedValueStart
10. getCachedValueRead
    {entry: {metadata: {createdTime: 0, swr: 0, ttl: 5}, value: 'value-0'}}
11. getCachedValueSuccess
    {migrated: false, value: 'value-0'}
12. init
    {key: 'test', metadata: {createdTime: 6, swr: 0, ttl: 5}}
13. getCachedValueStart
14. getCachedValueRead
    {entry: {metadata: {createdTime: 0, swr: 0, ttl: 5}, value: 'value-0'}}
15. getCachedValueOutdated
    {metadata: {createdTime: 0, swr: 0, ttl: 5}, value: 'value-0'}
16. getFreshValueStart
17. getFreshValueSuccess
    {value: 'value-1'}
18. writeFreshValueSuccess
    {metadata: {createdTime: 6, swr: 0, ttl: 5}, migrated: false, written: true}"
`);
  });

  it('does not write to cache when ttl is exceeded before value is received', async () => {
    const cache = new Map<string, CacheEntry>();
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
   {key: 'test', metadata: {createdTime: 0, swr: 0, ttl: 5}}
2. getCachedValueStart
3. getCachedValueRead
4. getCachedValueEmpty
5. getFreshValueStart
6. getFreshValueSuccess
   {value: 'ONE'}
7. writeFreshValueSuccess
   {metadata: {createdTime: 0, swr: 0, ttl: 5}, migrated: false, written: false}"
`);
  });

  it('reuses pending fresh value for parallel calls', async () => {
    const cache = new Map<string, CacheEntry>();
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
    {key: 'test', metadata: {createdTime: 0, swr: 0, ttl: null}}
 2. getCachedValueStart
 3. init
    {key: 'test', metadata: {createdTime: 0, swr: 0, ttl: null}}
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
    {metadata: {createdTime: 0, swr: 0, ttl: null}, migrated: false, written: true}"
`);
  });

  it('resolves earlier pending values with faster responses from later calls', async () => {
    const cache = new Map<string, CacheEntry>();
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
    const cache = new Map<string, CacheEntry>();
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
    {key: 'test', metadata: {createdTime: 0, swr: 10, ttl: 5}}
 2. getCachedValueStart
 3. getCachedValueRead
 4. getCachedValueEmpty
 5. getFreshValueStart
 6. getFreshValueSuccess
    {value: 'value-0'}
 7. writeFreshValueSuccess
    {metadata: {createdTime: 0, swr: 10, ttl: 5}, migrated: false, written: true}
 8. init
    {key: 'test', metadata: {createdTime: 6, swr: 10, ttl: 5}}
 9. getCachedValueStart
10. getCachedValueRead
    {entry: {metadata: {createdTime: 0, swr: 10, ttl: 5}, value: 'value-0'}}
11. getCachedValueSuccess
    {migrated: false, value: 'value-0'}
12. refreshValueStart
13. refreshValueSuccess
    {value: 'value-1'}"
`);
  });

  it('falls back to deprecated swv when swr is not present', async () => {
    const cache = new Map<string, CacheEntry>();
    let i = 0;
    const getFreshValue = jest.fn(() => `value-${i++}`);
    const oldCacheEntry = createCacheEntry(`value-${i++}`, { swr: 5, ttl: 5 });
    // @ts-ignore (we actually want to create an entry with a now deprecated signature)
    oldCacheEntry.metadata.swv = oldCacheEntry.metadata.swr;
    delete oldCacheEntry.metadata.swr;
    cache.set('test', oldCacheEntry);

    const getValue = () =>
      cachified({
        cache,
        key: 'test',
        ttl: 5,
        staleWhileRevalidate: 5,
        getFreshValue,
      });

    expect(await getValue()).toBe('value-0');
    currentTime = 6;
    expect(await getValue()).toBe('value-0');
    await delay(1);
    expect(await getValue()).toBe('value-1');
    expect(getFreshValue).toHaveBeenCalledTimes(1);
  });

  it('supports infinite stale while revalidate', async () => {
    const cache = new Map<string, CacheEntry>();
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
    const cache = new Map<string, CacheEntry>();
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
    {key: 'test', metadata: {createdTime: 0, swr: 10, ttl: 5}}
 2. getCachedValueStart
 3. getCachedValueRead
 4. getCachedValueEmpty
 5. getFreshValueStart
 6. getFreshValueSuccess
    {value: 'value-0'}
 7. writeFreshValueSuccess
    {metadata: {createdTime: 0, swr: 10, ttl: 5}, migrated: false, written: true}
 8. init
    {key: 'test', metadata: {createdTime: 6, swr: 10, ttl: 5}}
 9. getCachedValueStart
10. getCachedValueRead
    {entry: {metadata: {createdTime: 0, swr: 10, ttl: 5}, value: 'value-0'}}
11. getCachedValueSuccess
    {migrated: false, value: 'value-0'}
12. refreshValueStart
13. refreshValueError
    {error: [Error: 💩]}"
`);
  });

  it('gets fresh value in case cached one does not meet value check', async () => {
    const cache = new Map<string, CacheEntry>();
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
   {key: 'test', metadata: {createdTime: 0, swr: 0, ttl: null}}
2. getCachedValueStart
3. getCachedValueRead
   {entry: {metadata: {createdTime: 0, swr: 0, ttl: null}, value: 'ONE'}}
4. checkCachedValueError
   {reason: 'unknown'}
5. getFreshValueStart
6. getFreshValueSuccess
   {value: 'TWO'}
7. writeFreshValueSuccess
   {metadata: {createdTime: 0, swr: 0, ttl: null}, migrated: false, written: true}"
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
   {key: 'test', metadata: {createdTime: 0, swr: 0, ttl: null}}
2. getCachedValueStart
3. getCachedValueRead
   {entry: {metadata: {createdTime: 0, swr: 0, ttl: null}, value: 'ONE'}}
4. checkCachedValueError
   {reason: '🖕'}
5. getFreshValueStart
6. getFreshValueSuccess
   {value: 'TWO'}
7. writeFreshValueSuccess
   {metadata: {createdTime: 0, swr: 0, ttl: null}, migrated: false, written: true}"
`);
  });

  it('supports batch-getting fresh values', async () => {
    const cache = new Map<string, CacheEntry>();
    cache.set('test-2', createCacheEntry('YOLO!', { swr: null }));
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
    const cache = new Map<string, CacheEntry>();

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
    const cache = new Map<string, CacheEntry>();
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
            `[Error: Cache entry for for test does not have a value property]`,
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

  it('works with LRU cache', async () => {
    const lru = new LRUCache<string, CacheEntry>({ max: 5 });
    const cache = lruCacheAdapter(lru);

    const value = await cachified({
      // works with LRU directly
      cache: lru,
      key: 'test',
      getFreshValue() {
        return 'ONE';
      },
    });

    const value2 = await cachified({
      cache,
      key: 'test',
      getFreshValue() {
        throw new Error('🚧');
      },
    });

    expect(value).toBe('ONE');
    expect(value2).toBe('ONE');

    cache.set('test-2', undefined as any);
    cache.set('test-2', 'TWO' as any);

    currentTime = 2;
    const value3 = await cachified({
      cache,
      key: 'test-2',
      getFreshValue() {
        return 'THREE';
      },
    });

    expect(value3).toBe('THREE');
    expect(cache.get('test-2')).toEqual({
      metadata: { createdTime: 2, swr: 0, ttl: null },
      value: 'THREE',
    });
  });

  it('works with redis4 cache', async () => {
    const set = jest.fn();
    const get = jest.fn();
    const del = jest.fn();
    const redis4: RedisLikeCache = { set, get, del };
    const cache = redisCacheAdapter(redis4);

    const ttlValue = await cachified({
      cache,
      key: 'test-3',
      ttl: 1,
      getFreshValue() {
        return 'FOUR';
      },
    });
    expect(ttlValue).toBe('FOUR');
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('test-3');
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(
      'test-3',
      JSON.stringify({
        metadata: { ttl: 1, swr: 0, createdTime: 0 },
        value: 'FOUR',
      }),
      { EXAT: 0.001 },
    );

    await cache.set('lel', undefined as any);

    get.mockImplementationOnce(() =>
      Promise.resolve(
        JSON.stringify({
          metadata: { ttl: null, swr: 0, createdTime: 0 },
          value: 'FIVE',
        }),
      ),
    );
    const nextValue = await cachified({
      cache,
      key: 'test-3',
      checkValue(value) {
        return value !== 'FIVE';
      },
      getFreshValue() {
        return 'SIX';
      },
    });
    expect(nextValue).toBe('SIX');
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith('test-3');
  });

  it('works with redis3 cache', async () => {
    const redis = createRedis3Client();
    const cache = redis3CacheAdapter(redis);

    const value = await cachified({
      cache,
      key: 'test',
      getFreshValue() {
        return 'ONE';
      },
    });

    expect(value).toBe('ONE');

    await cache.set('test-2', 'TWO' as any);
    expect(() => cache.set('test-2', undefined as any)).rejects.toThrow();

    currentTime = 2;
    const value3 = await cachified({
      cache,
      key: 'test-2',
      getFreshValue() {
        return 'THREE';
      },
    });
    expect(value3).toBe('THREE');
    expect(await cache.get('test-2')).toEqual({
      metadata: { createdTime: 2, swr: 0, ttl: null },
      value: 'THREE',
    });

    // handle redis get failure
    jest.spyOn(redis, 'get').mockImplementationOnce((_, cb) => {
      cb!(new Error('Nope'), null);
      return false;
    });
    await expect(() =>
      cachified({
        cache,
        key: 'test-2',
        getFreshValue() {
          throw new Error('Nope Nope Nope');
        },
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`"Nope Nope Nope"`);

    // handle redis del failure
    jest.spyOn(redis, 'del').mockImplementationOnce((_, cb) => {
      (cb as Function)(new Error('Nope2'), null);
      return false;
    });
    expect(cache.delete('test-0')).rejects.toThrowErrorMatchingInlineSnapshot(`"Nope2"`);

    // handle corrupt cache
    await new Promise((res) => redis.set('test-3', '{{{', res));
    await expect(() =>
      cachified({
        cache,
        key: 'test-2',
        getFreshValue() {
          throw new Error('Broken');
        },
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`"Broken"`);

    // value is cleared from cache after ttl
    const ttlValue = await cachified({
      cache,
      key: 'test-3',
      ttl: 1,
      getFreshValue() {
        return 'FOUR';
      },
    });
    expect(ttlValue).toBe('FOUR');

    await delay(2);
    expect(await cache.get('test-3')).toBe(null);

    //  handles delete fails
    jest.spyOn(redis, 'del').mockImplementationOnce((key, cb) => {
      (cb as Function)(new Error('Nope'));
      return false;
    });

    await expect(() =>
      cachified({
        cache,
        checkValue() {
          return false;
        },
        key: 'test',
        getFreshValue() {
          throw new Error('Boom');
        },
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`"Boom"`);
  });
});

describe('verbose reporter', () => {
  it('logs when cached value is invalid', async () => {
    const cache = new Map<string, CacheEntry>();
    const logger = createLogger();
    cache.set('test', createCacheEntry('One'));

    await cachified({
      cache,
      key: 'test',
      checkValue: (v) => (v !== 'VALUE' ? '🚔' : true),
      reporter: verboseReporter({ logger, performance: Date }),
      getFreshValue: () => 'VALUE',
    });

    expect(logger.print()).toMatchInlineSnapshot(`
    "WARN: 'check failed for cached value of test
           Reason: 🚔.
           Deleting the cache key and trying to get a fresh value.' {metadata: {createdTime: 0, swr: 0, ttl: null}, value: 'One'}
    LOG: 'Updated the cache value for test.' 'Getting a fresh value for this took 0ms.' 'Caching for forever in Map.'"
    `);
  });

  it('logs when getting a cached value fails', async () => {
    const cache = new Map<string, CacheEntry>();
    const logger = createLogger();
    const getMock = jest.spyOn(cache, 'get');
    getMock.mockImplementationOnce(() => {
      throw new Error('💥');
    });

    await cachified({
      cache,
      key: 'test',
      ttl: 50,
      staleWhileRevalidate: Infinity,
      reporter: verboseReporter({ logger, performance: Date }),
      getFreshValue: () => 'VALUE',
    });

    expect(logger.print()).toMatchInlineSnapshot(`
    "ERROR: 'error with cache at test. Deleting the cache key and trying to get a fresh value.' [Error: 💥]
    LOG: 'Updated the cache value for test.' 'Getting a fresh value for this took 0ms.' 'Caching for forever (revalidation after 50ms) in Map.'"
    `);
  });

  it('logs when getting a fresh value fails', async () => {
    const cache = new Map<string, CacheEntry>();
    const logger = createLogger();

    await cachified({
      cache,
      key: 'test',
      reporter: verboseReporter({ logger, performance: Date }),
      getFreshValue: () => {
        throw new Error('⁇');
      },
    }).catch(() => {
      /* ¯\_(ツ)_/¯ */
    });

    expect(logger.print()).toMatchInlineSnapshot(
      `"ERROR: 'getting a fresh value for test failed' {fallbackToCache: Infinity, forceFresh: false} [Error: ⁇]"`,
    );
  });

  it('logs when fresh value is not written to cache', async () => {
    const cache = new Map<string, CacheEntry>();
    const logger = createLogger();

    await cachified({
      cache,
      key: 'test',
      ttl: 5,
      staleWhileRevalidate: 5,
      reporter: verboseReporter({ logger, performance: Date }),
      getFreshValue: () => {
        currentTime = 20;
        return 'ONE';
      },
    });

    expect(logger.print()).toMatchInlineSnapshot(
      `"LOG: 'Not updating the cache value for test.' 'Getting a fresh value for this took 20ms.' 'Thereby exceeding caching time of 5ms + 5ms stale'"`,
    );
  });

  it('logs when writing to cache fails (using defaults)', async () => {
    const cache = new Map<string, CacheEntry>();
    const errorMock = jest.spyOn(console, 'error').mockImplementation(() => {
      /* 🤫 */
    });
    jest.spyOn(cache, 'set').mockImplementationOnce(() => {
      throw new Error('⚡️');
    });

    await cachified({
      cache,
      key: 'test',
      reporter: verboseReporter(),
      getFreshValue: () => 'ONE',
    });

    expect(errorMock.mock.calls).toMatchInlineSnapshot(`
[
  [
    "error setting cache: test",
    [Error: ⚡️],
  ],
]
`);
  });

  it('falls back to Date when performance is not globally available', async () => {
    const backup = global.performance;
    delete (global as any).performance;
    const cache = new Map<string, CacheEntry>();
    const logger = createLogger();

    await cachified({
      cache,
      key: 'test',
      reporter: verboseReporter({ logger }),
      getFreshValue: () => 'ONE',
    });

    (global as any).performance = backup;
    expect(Date.now).toBeCalledTimes(3);
  });

  it('logs when fresh value does not meet value check', async () => {
    const cache = new Map<string, CacheEntry>();
    const logger = createLogger();

    await cachified({
      cache,
      key: 'test',
      reporter: verboseReporter({ logger, performance: Date }),
      checkValue: () => false,
      getFreshValue: () => 'ONE',
    }).catch(() => {
      /* 🤷 */
    });

    expect(logger.print()).toMatchInlineSnapshot(`
    "ERROR: 'check failed for fresh value of test
            Reason: unknown.' 'ONE'"
    `);
  });

  it('logs when cache is successfully revalidated', async () => {
    const cache = new Map<string, CacheEntry>();
    const logger = createLogger();
    cache.set('test', createCacheEntry('ONE', { ttl: 5, swr: 10 }));
    currentTime = 7;

    await cachified({
      cache,
      key: 'test',
      reporter: verboseReporter({ logger, performance: Date }),
      getFreshValue: () => {
        currentTime = 10;
        return 'TWO';
      },
    });

    await delay(0);
    expect(logger.print()).toMatchInlineSnapshot(
      `"LOG: 'Background refresh for test successful.' 'Getting a fresh value for this took 3ms.' 'Caching for forever in Map.'"`,
    );
  });

  it('logs when cache revalidation fails', async () => {
    const cache = new Map<string, CacheEntry>();
    const logger = createLogger();
    cache.set('test', createCacheEntry('ONE', { ttl: 5, swr: 10 }));
    currentTime = 7;

    await cachified({
      cache,
      key: 'test',
      reporter: verboseReporter({ logger, performance: Date }),
      getFreshValue: () => {
        currentTime = 10;
        throw new Error('🧨');
      },
    });

    await delay(0);
    expect(logger.print()).toMatchInlineSnapshot(
      `"LOG: 'Background refresh for test failed.' [Error: 🧨]"`,
    );
  });
});

function prettyPrint(value: any) {
  return format(value, {
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
  });
}

function createLogger() {
  const log: string[] = [];

  return {
    log(...args: any[]) {
      log.push(
        args
          .reduce((m, v) => `${m} ${prettyPrint(v)}`, 'LOG:')
          .replace(/\n/g, '\n     '),
      );
    },
    warn(...args: any[]) {
      log.push(
        args
          .reduce((m, v) => `${m} ${prettyPrint(v)}`, 'WARN:')
          .replace(/\n/g, '\n       '),
      );
    },
    error(...args: any[]) {
      log.push(
        args
          .reduce((m, v) => `${m} ${prettyPrint(v)}`, 'ERROR:')
          .replace(/\n/g, '\n        '),
      );
    },
    print() {
      return log.join('\n');
    },
  };
}

function delay(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

function createReporter() {
  const report = jest.fn();
  const creator = ({ key, metadata }: Omit<Context<any>, 'report'>) => {
    report({ name: 'init', key, metadata });
    return report;
  };
  creator.mock = report.mock;
  return creator;
}

function createCacheEntry<Value>(
  value: Value,
  metadata: Partial<CacheMetadata> = {},
): CacheEntry<Value> {
  return {
    value,
    metadata: { createdTime: Date.now(), ttl: null, swr: 0, ...metadata },
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
      return `${title}\n${String('').padStart(
        totalCalls + 2,
        ' ',
      )}${prettyPrint(payload)}`;
    })
    .join('\n');
}

describe('totalTtl helper', () => {
  it('handles metadata without ttl gracefully', () => {
    expect(totalTtl({ createdTime: 0, swr: 5 })).toBe(5);
  });
});
