import z from 'zod';
import {
  cachified,
  CachifiedOptions,
  Context,
  createBatch,
  CreateReporter,
  CacheMetadata,
  CacheEntry,
  GetFreshValue,
  createCacheEntry,
} from './index';
import { Deferred } from './createBatch';
import { delay, report } from './testHelpers';

jest.mock('./index', () => {
  if (process.version.startsWith('v20')) {
    return jest.requireActual('./index');
  } else {
    console.log('⚠️ Running Tests against dist/index.cjs');
    return require('../dist/index.cjs');
  }
});

function ignoreNode14<T>(callback: () => T) {
  if (process.version.startsWith('v14')) {
    return;
  }
  return callback();
}

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

    const value = await cachified(
      {
        cache,
        key: 'test',
        getFreshValue() {
          return 'ONE';
        },
      },
      reporter,
    );

    const value2 = await cachified(
      {
        cache,
        key: 'test',
        getFreshValue() {
          throw new Error('🚧');
        },
      },
      reporter2,
    );

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
   {metadata: {createdTime: 0, swr: 0, ttl: null}, migrated: false, written: true}
8. done
   {value: 'ONE'}"
`);

    expect(value2).toBe('ONE');
    expect(report(reporter2.mock.calls)).toMatchInlineSnapshot(`
"1. init
   {key: 'test', metadata: {createdTime: 0, swr: 0, ttl: null}}
2. getCachedValueStart
3. getCachedValueRead
   {entry: {metadata: {createdTime: 0, swr: 0, ttl: null}, value: 'ONE'}}
4. getCachedValueSuccess
   {migrated: false, value: 'ONE'}
5. done
   {value: 'ONE'}"
`);
  });

  it('does not cache a value when ttl is negative', async () => {
    const cache = new Map<string, CacheEntry>();

    const value = await cachified({
      cache,
      key: 'test',
      ttl: -1,
      getFreshValue() {
        return 'ONE';
      },
    });

    expect(value).toBe('ONE');
    expect(cache.size).toBe(0);
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

    const value = cachified(
      {
        cache,
        key: 'test',
        getFreshValue() {
          throw new Error('🙈');
        },
      },
      reporter,
    );

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

    const value = cachified(
      {
        cache,
        key: 'test',
        checkValue() {
          return '👮';
        },
        getFreshValue() {
          return 'ONE';
        },
      },
      reporter,
    );

    await expect(value).rejects.toThrowErrorMatchingInlineSnapshot(
      `"check failed for fresh value of test"`,
    );

    await ignoreNode14(() =>
      expect(value.catch((err) => err.cause)).resolves.toMatchInlineSnapshot(
        `"👮"`,
      ),
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
    7. checkFreshValueErrorObj
       {reason: '👮'}
    8. checkFreshValueError
       {reason: '👮'}"
    `);

    // The following lines only exist to have 100% coverage 😅
    const value2 = cachified(
      {
        cache,
        key: 'test',
        checkValue() {
          return false;
        },
        getFreshValue() {
          return 'ONE';
        },
      },
      reporter2,
    );
    await expect(value2).rejects.toThrowErrorMatchingInlineSnapshot(
      `"check failed for fresh value of test"`,
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
    7. checkFreshValueErrorObj
       {reason: 'unknown'}
    8. checkFreshValueError
       {reason: 'unknown'}"
    `);
  });

  it('supports zod validation with checkValue', async () => {
    const cache = new Map<string, CacheEntry>();

    const value = await cachified({
      cache,
      key: 'test',
      checkValue: z.string(),
      getFreshValue() {
        return 'ONE';
      },
    });

    expect(value).toBe('ONE');
  });

  it('fails when zod-schema does not match fresh value', async () => {
    const cache = new Map<string, CacheEntry>();

    const value2 = cachified({
      cache,
      key: 'test',
      checkValue: z.string(),
      /* manually setting unknown here leaves the type-checking to zod during runtime */
      getFreshValue(): unknown {
        /* pretend API returns an unexpected value */
        return 1;
      },
    });

    await expect(value2).rejects.toThrowErrorMatchingInlineSnapshot(
      `"check failed for fresh value of test"`,
    );
    await ignoreNode14(() =>
      expect(value2.catch((err) => err.cause)).resolves.toMatchInlineSnapshot(`
        [ZodError: [
          {
            "code": "invalid_type",
            "expected": "string",
            "received": "number",
            "path": [],
            "message": "Expected string, received number"
          }
        ]]
      `),
    );
  });

  it('fetches fresh value when zod-schema does not match cached value', async () => {
    const cache = new Map<string, CacheEntry>();

    cache.set('test', createCacheEntry(1));

    const value = await cachified({
      cache,
      key: 'test',
      checkValue: z.string(),
      getFreshValue() {
        return 'ONE';
      },
    });

    expect(value).toBe('ONE');
  });

  /* I don't think this is a good idea, but it's possible */
  it('supports zod transforms', async () => {
    const cache = new Map<string, CacheEntry>();

    const getValue = () =>
      cachified({
        cache,
        key: 'test',
        checkValue: z.string().transform((s) => parseInt(s, 10)),
        getFreshValue() {
          return '123';
        },
      });

    expect(await getValue()).toBe(123);

    /* Stores original value in cache */
    expect(cache.get('test')?.value).toBe('123');

    /* Gets transformed value from cache */
    expect(await getValue()).toBe(123);
  });

  it('supports migrating cached values', async () => {
    const cache = new Map<string, CacheEntry>();
    const reporter = createReporter();

    cache.set('weather', createCacheEntry('☁️'));
    const value = await cachified(
      {
        cache,
        key: 'weather',
        checkValue(value, migrate) {
          if (value === '☁️') {
            return migrate('☀️');
          }
        },
        getFreshValue() {
          throw new Error('Never');
        },
      },
      reporter,
    );

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
   {migrated: true, value: '☀️'}
5. done
   {value: '☀️'}"
`);
  });

  it('supports async value checkers that throw', async () => {
    const cache = new Map<string, CacheEntry>();
    const reporter = createReporter();

    const value = cachified(
      {
        cache,
        key: 'weather',
        async checkValue(value) {
          if (value === '☁️') {
            throw new Error('Bad Weather');
          }
        },
        getFreshValue() {
          return '☁️';
        },
      },
      reporter,
    );

    await expect(value).rejects.toThrowErrorMatchingInlineSnapshot(
      `"check failed for fresh value of weather"`,
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
7. checkFreshValueErrorObj
   {reason: [Error: Bad Weather]}
8. checkFreshValueError
   {reason: 'Bad Weather'}"
`);

    // Considers anything thrown as an error

    const value2 = cachified(
      {
        cache,
        key: 'weather',
        async checkValue(value) {
          if (value === '☁️') {
            throw { custom: 'idk..' };
          }
        },
        getFreshValue() {
          return '☁️';
        },
      },
      reporter,
    );

    await expect(value2).rejects.toThrowErrorMatchingInlineSnapshot(
      `"check failed for fresh value of weather"`,
    );
  });

  it('does not write migrated value to cache in case a new fresh value is already incoming', async () => {
    const cache = new Map<string, CacheEntry>();
    const reporter = createReporter();

    cache.set('weather', createCacheEntry('☁️'));
    const migration = new Deferred<void>();
    const getValue2 = new Deferred<string>();
    const value = cachified(
      {
        cache,
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
      },
      reporter,
    );

    const value2 = cachified(
      {
        cache,
        forceFresh: true,
        key: 'weather',
        getFreshValue() {
          return getValue2.promise;
        },
      },
      reporter,
    );

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
    const value2 = await cachified(
      {
        cache,
        key: 'test',
        forceFresh: true,
        getFreshValue: () => {
          throw '🤡';
        },
      },
      reporter,
    );

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
   {metadata: {createdTime: 0, swr: 0, ttl: null}, migrated: false, written: true}
8. done
   {value: 'ONE'}"
`);
  });

  it('does not fall back to outdated cache', async () => {
    const cache = new Map<string, CacheEntry>();
    const reporter = createReporter();

    cache.set('test', createCacheEntry('ONE', { ttl: 5 }));
    currentTime = 15;
    const value = cachified(
      {
        cache,
        key: 'test',
        forceFresh: true,
        fallbackToCache: 10,
        getFreshValue: () => {
          throw '🤡';
        },
      },
      reporter,
    );

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
      cachified(
        {
          cache,
          key: 'test',
          getFreshValue: () => `value-${i++}`,
        },
        reporter,
      );

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
 8. done
    {value: 'value-0'}
 9. init
    {key: 'test', metadata: {createdTime: 0, swr: 0, ttl: null}}
10. getCachedValueStart
11. getCachedValueRead
12. getCachedValueEmpty
13. getFreshValueStart
14. getFreshValueSuccess
    {value: 'value-1'}
15. writeFreshValueSuccess
    {metadata: {createdTime: 0, swr: 0, ttl: null}, migrated: false, written: true}
16. done
    {value: 'value-1'}"
`);
    expect(await getValue()).toBe('value-1');
  });

  it('gets fresh value when ttl is exceeded', async () => {
    const cache = new Map<string, CacheEntry>();
    const reporter = createReporter();
    let i = 0;
    const getValue = () =>
      cachified(
        {
          cache,
          key: 'test',
          ttl: 5,
          getFreshValue: () => `value-${i++}`,
        },
        reporter,
      );

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
 8. done
    {value: 'value-0'}
 9. init
    {key: 'test', metadata: {createdTime: 4, swr: 0, ttl: 5}}
10. getCachedValueStart
11. getCachedValueRead
    {entry: {metadata: {createdTime: 0, swr: 0, ttl: 5}, value: 'value-0'}}
12. getCachedValueSuccess
    {migrated: false, value: 'value-0'}
13. done
    {value: 'value-0'}
14. init
    {key: 'test', metadata: {createdTime: 6, swr: 0, ttl: 5}}
15. getCachedValueStart
16. getCachedValueRead
    {entry: {metadata: {createdTime: 0, swr: 0, ttl: 5}, value: 'value-0'}}
17. getCachedValueOutdated
    {metadata: {createdTime: 0, swr: 0, ttl: 5}, value: 'value-0'}
18. getFreshValueStart
19. getFreshValueSuccess
    {value: 'value-1'}
20. writeFreshValueSuccess
    {metadata: {createdTime: 6, swr: 0, ttl: 5}, migrated: false, written: true}
21. done
    {value: 'value-1'}"
`);
  });

  it('does not write to cache when ttl is exceeded before value is received', async () => {
    const cache = new Map<string, CacheEntry>();
    const setMock = jest.spyOn(cache, 'set');
    const reporter = createReporter();

    const value = await cachified(
      {
        cache,
        key: 'test',
        ttl: 5,
        getFreshValue() {
          currentTime = 6;
          return 'ONE';
        },
      },
      reporter,
    );

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
   {metadata: {createdTime: 0, swr: 0, ttl: 5}, migrated: false, written: false}
8. done
   {value: 'ONE'}"
`);
  });

  it('reuses pending fresh value for parallel calls', async () => {
    const cache = new Map<string, CacheEntry>();
    const reporter = createReporter();
    const getValue = (
      getFreshValue: CachifiedOptions<string>['getFreshValue'],
    ) =>
      cachified(
        {
          cache,
          key: 'test',
          getFreshValue,
        },
        reporter,
      );

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
    {metadata: {createdTime: 0, swr: 0, ttl: null}, migrated: false, written: true}
13. done
    {value: 'ONE'}
14. done
    {value: 'ONE'}"
`);
  });

  it('does not use pending values after TTL is over', async () => {
    const cache = new Map<string, CacheEntry>();
    const reporter = createReporter();
    const getValue = (
      getFreshValue: CachifiedOptions<string>['getFreshValue'],
    ) =>
      cachified(
        {
          cache,
          ttl: 5,
          key: 'test',
          getFreshValue,
        },
        reporter,
      );

    const d = new Deferred<string>();
    const pValue1 = getValue(() => d.promise);
    currentTime = 6;
    const pValue2 = getValue(() => 'TWO');

    d.resolve('ONE');
    expect(await pValue1).toBe('ONE');
    expect(await pValue2).toBe('TWO');
  });

  it('supports extending ttl during getFreshValue operation', async () => {
    const cache = new Map<string, CacheEntry>();
    const reporter = createReporter();
    const getValue = (
      getFreshValue: CachifiedOptions<string>['getFreshValue'],
    ) =>
      cachified(
        {
          cache,
          ttl: 5,
          key: 'test',
          getFreshValue,
        },
        reporter,
      );

    const firstCallMetaDataD = new Deferred<CacheMetadata>();

    const d = new Deferred<string>();
    const p1 = getValue(({ metadata }) => {
      metadata.ttl = 10;
      // Don't do this at home kids...
      firstCallMetaDataD.resolve(metadata);
      return d.promise;
    });

    const metadata = await firstCallMetaDataD.promise;

    currentTime = 6;
    // First call is still ongoing and initial ttl is over, still we exceeded
    // the ttl in the call so this should not be called ever
    const p2 = getValue(() => {
      throw new Error('Never');
    });

    // Further exceeding the ttl and resolving first call
    metadata!.ttl = 15;
    d.resolve('ONE');

    expect(await p1).toBe('ONE');
    expect(await p2).toBe('ONE');

    // now proceed to time between first and second modification of ttl
    currentTime = 13;
    // we still get the cached value from first call
    expect(
      await getValue(() => {
        throw new Error('Never2');
      }),
    ).toBe('ONE');
  });

  it('supports bailing out of caching during getFreshValue operation', async () => {
    const cache = new Map<string, CacheEntry>();
    const reporter = createReporter();

    const value = await cachified(
      {
        cache,
        ttl: 5,
        key: 'test',
        getFreshValue({ metadata }) {
          metadata.ttl = -1;
          return null;
        },
      },
      reporter,
    );

    expect(value).toBe(null);
    expect(report(reporter.mock.calls)).toMatchInlineSnapshot(`
"1. init
   {key: 'test', metadata: {createdTime: 0, swr: 0, ttl: -1}}
2. getCachedValueStart
3. getCachedValueRead
4. getCachedValueEmpty
5. getFreshValueStart
6. getFreshValueSuccess
   {value: null}
7. writeFreshValueSuccess
   {metadata: {createdTime: 0, swr: 0, ttl: -1}, migrated: false, written: false}
8. done
   {value: null}"
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
      cachified(
        {
          cache,
          key: 'test',
          ttl: 5,
          staleWhileRevalidate: 10,
          getFreshValue,
        },
        reporter,
      );

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

    const getFreshValueCalls = getFreshValue.mock.calls as any as Parameters<
      GetFreshValue<string>
    >[];
    expect(getFreshValue).toHaveBeenCalledTimes(2);

    // Does pass info if it's a stale while revalidate call
    expect(getFreshValueCalls[0][0].background).toBe(false);
    expect(getFreshValueCalls[1][0].background).toBe(true);

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
 8. done
    {value: 'value-0'}
 9. init
    {key: 'test', metadata: {createdTime: 6, swr: 10, ttl: 5}}
10. getCachedValueStart
11. getCachedValueRead
    {entry: {metadata: {createdTime: 0, swr: 10, ttl: 5}, value: 'value-0'}}
12. getCachedValueSuccess
    {migrated: false, value: 'value-0'}
13. done
    {value: 'value-0'}
14. refreshValueStart
15. refreshValueSuccess
    {value: 'value-1'}"
`);
  });

  it('handles negative staleWhileRevalidate gracefully', async () => {
    const cache = new Map<string, CacheEntry>();
    let i = 0;
    const getFreshValue = jest.fn(() => `value-${i++}`);
    const getValue = () =>
      cachified({
        cache,
        key: 'test',
        ttl: 5,
        staleWhileRevalidate: -1,
        getFreshValue,
      });

    expect(await getValue()).toBe('value-0');
    currentTime = 6;
    expect(await getValue()).toBe('value-1');
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
        swr: 5,
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
      cachified(
        {
          cache,
          key: 'test',
          ttl: 5,
          staleWhileRevalidate: 10,
          getFreshValue,
        },
        reporter,
      );

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
 8. done
    {value: 'value-0'}
 9. init
    {key: 'test', metadata: {createdTime: 6, swr: 10, ttl: 5}}
10. getCachedValueStart
11. getCachedValueRead
    {entry: {metadata: {createdTime: 0, swr: 10, ttl: 5}, value: 'value-0'}}
12. getCachedValueSuccess
    {migrated: false, value: 'value-0'}
13. done
    {value: 'value-0'}
14. refreshValueStart
15. refreshValueError
    {error: [Error: 💩]}"
`);
  });

  it('gets fresh value in case cached one does not meet value check', async () => {
    const cache = new Map<string, CacheEntry>();
    const reporter = createReporter();
    const reporter2 = createReporter();

    cache.set('test', createCacheEntry('ONE'));
    const value = await cachified(
      {
        cache,
        key: 'test',
        checkValue(value) {
          return value === 'TWO';
        },
        getFreshValue() {
          return 'TWO';
        },
      },
      reporter,
    );

    expect(value).toBe('TWO');
    expect(report(reporter.mock.calls)).toMatchInlineSnapshot(`
" 1. init
    {key: 'test', metadata: {createdTime: 0, swr: 0, ttl: null}}
 2. getCachedValueStart
 3. getCachedValueRead
    {entry: {metadata: {createdTime: 0, swr: 0, ttl: null}, value: 'ONE'}}
 4. checkCachedValueErrorObj
    {reason: 'unknown'}
 5. checkCachedValueError
    {reason: 'unknown'}
 6. getFreshValueStart
 7. getFreshValueSuccess
    {value: 'TWO'}
 8. writeFreshValueSuccess
    {metadata: {createdTime: 0, swr: 0, ttl: null}, migrated: false, written: true}
 9. done
    {value: 'TWO'}"
`);

    // the following lines only exist for 100% coverage 😅
    cache.set('test', createCacheEntry('ONE'));
    const value2 = await cachified(
      {
        cache,
        key: 'test',
        checkValue(value) {
          return value === 'TWO' ? true : '🖕';
        },
        getFreshValue() {
          return 'TWO';
        },
      },
      reporter2,
    );
    expect(value2).toBe('TWO');
    expect(report(reporter2.mock.calls)).toMatchInlineSnapshot(`
" 1. init
    {key: 'test', metadata: {createdTime: 0, swr: 0, ttl: null}}
 2. getCachedValueStart
 3. getCachedValueRead
    {entry: {metadata: {createdTime: 0, swr: 0, ttl: null}, value: 'ONE'}}
 4. checkCachedValueErrorObj
    {reason: '🖕'}
 5. checkCachedValueError
    {reason: '🖕'}
 6. getFreshValueStart
 7. getFreshValueSuccess
    {value: 'TWO'}
 8. writeFreshValueSuccess
    {metadata: {createdTime: 0, swr: 0, ttl: null}, migrated: false, written: true}
 9. done
    {value: 'TWO'}"
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

  it('can edit metadata for single batch values', async () => {
    const cache = new Map<string, CacheEntry>();
    const getValues = jest.fn(() => [
      'one',
      null /* pretend this value does not exist (yet) */,
    ]);
    const batch = createBatch(getValues);

    const values = await Promise.all(
      [1, 2].map((index) =>
        cachified({
          cache,
          key: `test-${index}`,
          ttl: 5,
          getFreshValue: batch.add(index, ({ value, metadata }) => {
            if (value === null) {
              metadata.ttl = -1;
            }
          }),
        }),
      ),
    );

    expect(values).toEqual(['one', null]);
    expect(cache.get('test-1')).toEqual({
      metadata: { createdTime: 0, swr: 0, ttl: 5 },
      value: 'one',
    });
    /* Has not been written to cache */
    expect(cache.get('test-2')).toBe(undefined);
  });

  it('does not invoke onValue when value comes from cache', async () => {
    const cache = new Map<string, CacheEntry>();
    const onValue = jest.fn();
    const getValues = jest.fn(() => ['two']);
    const batch = createBatch(getValues);

    cache.set('test-1', createCacheEntry('one'));

    const value = await cachified({
      cache,
      key: `test-1`,
      getFreshValue: batch.add(1, onValue),
    });

    expect(value).toEqual('one');
    expect(onValue).not.toHaveBeenCalled();
    expect(getValues).not.toHaveBeenCalled();
  });

  it('does not use faulty cache entries', async () => {
    expect.assertions(23);
    const cache = new Map<string, any>();

    const getValue = (reporter: CreateReporter<string>) =>
      cachified(
        {
          cache,
          key: 'test',
          getFreshValue() {
            return 'ONE';
          },
        },
        reporter,
      );

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
});

function createReporter() {
  const report = jest.fn();
  const creator = ({ key, metadata }: Omit<Context<any>, 'report'>) => {
    report({ name: 'init', key, metadata });
    return report;
  };
  creator.mock = report.mock;
  return creator;
}
