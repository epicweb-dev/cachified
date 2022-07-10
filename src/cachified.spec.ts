import { cachified, CachifiedOptions } from './cachified';

describe('cachified', () => {
  it('caches a value', async () => {
    const cache = createTestCache();

    const value = await cachified({
      cache,
      key: 'test',
      logger: noopLogger,
      getFreshValue() {
        return 'ONE';
      },
    });
    // not used because key 'test' is already in cache
    const value2 = await cachified({
      cache,
      key: 'test',
      logger: noopLogger,
      getFreshValue() {
        return 'TWO';
      },
    });

    expect(value).toBe('ONE');
    expect(value2).toBe('ONE');
  });

  it('throws when no fresh value can be received for empty cache', () => {
    const cache = createTestCache();

    const value = cachified({
      cache,
      key: 'test',
      logger: noopLogger,
      getFreshValue() {
        throw new Error('🙈');
      },
    });

    expect(value).rejects.toMatchInlineSnapshot(`[Error: 🙈]`);
  });

  it('throws when fresh value does not meet value check', () => {
    const cache = createTestCache();

    const value = cachified({
      cache,
      key: 'test',
      logger: noopLogger,
      checkValue() {
        return '👮';
      },
      getFreshValue() {
        return 'ONE';
      },
    });

    expect(value).rejects.toMatchInlineSnapshot(
      `[Error: check failed for fresh value of test]`,
    );
  });

  it('gets different values for different keys', async () => {
    const cache = createTestCache();

    const value = await cachified({
      cache,
      key: 'test',
      logger: noopLogger,
      getFreshValue() {
        return 'ONE';
      },
    });
    const value2 = await cachified({
      cache,
      key: 'test-2',
      logger: noopLogger,
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
      logger: noopLogger,
      getFreshValue() {
        return 'THREE';
      },
    });

    expect(value3).toBe('TWO');
  });

  it('gets fresh value when forced to', async () => {
    const cache = createTestCache();

    const value = await cachified({
      cache,
      key: 'test',
      logger: noopLogger,
      getFreshValue() {
        return 'ONE';
      },
    });
    const value2 = await cachified({
      cache,
      forceFresh: true,
      key: 'test',
      logger: noopLogger,
      getFreshValue() {
        return 'TWO';
      },
    });

    expect(value).toBe('ONE');
    expect(value2).toBe('TWO');
  });

  it('falls back to cache when forced fresh value fails', async () => {
    const cache = createTestCache();

    const value1 = await cachified({
      cache,
      key: 'test',
      logger: noopLogger,
      getFreshValue: () => 'ONE',
    });
    const value2 = await cachified({
      cache,
      key: 'test',
      logger: noopLogger,
      forceFresh: true,
      getFreshValue: () => {
        throw '🤡';
      },
    });

    expect(value1).toBe('ONE');
    expect(value2).toBe('ONE');
  });

  it('it throws when cache fallback is disabled and getting fresh value fails', async () => {
    const cache = createTestCache();

    const value1 = await cachified({
      cache,
      key: 'test',
      logger: noopLogger,
      getFreshValue: () => 'ONE',
    });
    const value2 = cachified({
      cache,
      key: 'test',
      logger: noopLogger,
      forceFresh: true,
      fallbackToCache: false,
      getFreshValue: () => {
        throw '👾';
      },
    });

    expect(value1).toBe('ONE');
    expect(value2).rejects.toMatchInlineSnapshot(`"👾"`);
  });

  it('handles cache write fails', async () => {
    const cache = createTestCache();
    let i = 0;
    const getValue = (forceFresh?: string) =>
      cachified({
        cache,
        key: 'test',
        forceFresh,
        logger: noopLogger,
        getFreshValue: () => `value-${i++}`,
      });

    cache.set.mockImplementationOnce(() => {
      throw '🔥';
    });
    expect(await getValue()).toBe('value-0');
    expect(await getValue()).toBe('value-1');
    expect(await getValue()).toBe('value-1');
  });

  // TODO: I don't see this as part of the package
  it('does only get forced fresh values when key matches', async () => {
    const cache = createTestCache();
    let i = 0;
    const getValue = (forceFresh?: string) =>
      cachified({
        cache,
        key: 'test',
        forceFresh,
        logger: noopLogger,
        getFreshValue: () => `value-${i++}`,
      });

    expect(await getValue()).toBe('value-0');
    // does not force fresh response since test-2 does not match test
    expect(await getValue('test-2')).toBe('value-0');

    // test is now included
    expect(await getValue('test-2,test')).toBe('value-1');
  });

  it('gets fresh value when ttl is exceeded', async () => {
    let currentTime = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => currentTime);
    const cache = createTestCache();
    let i = 0;
    const getValue = () =>
      cachified({
        cache,
        key: 'test',
        ttl: 5,
        logger: noopLogger,
        getFreshValue: () => `value-${i++}`,
      });

    expect(await getValue()).toBe('value-0');

    // does use cached value since ttl is not exceeded
    currentTime = 4;
    expect(await getValue()).toBe('value-0');

    // gets new value because ttl is exceeded
    currentTime = 6;
    expect(await getValue()).toBe('value-1');
  });

  it('does not write to cache when ttl is exceeded before value is received', async () => {
    let currentTime = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => currentTime);
    const cache = createTestCache();

    const value = await cachified({
      cache,
      key: 'test',
      ttl: 5,
      logger: noopLogger,
      getFreshValue() {
        currentTime = 6;
        return 'ONE';
      },
    });

    expect(value).toBe('ONE');
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('reuses pending fresh value for parallel calls', async () => {
    const cache = createTestCache();
    const getValue = (
      getFreshValue: CachifiedOptions<string, any>['getFreshValue'],
    ) =>
      cachified({
        cache,
        key: 'test',
        logger: noopLogger,
        getFreshValue,
      });

    const d = new Deferred<string>();
    const pValue1 = getValue(() => d.promise);
    // value from first call is pending so this one is never called
    const pValue2 = getValue(() => 'TWO');

    d.resolve('ONE');

    expect(await pValue1).toBe('ONE');
    expect(await pValue2).toBe('ONE');
  });

  it('resolves earlier pending values with faster responses from later calls', async () => {
    const cache = createTestCache();
    let currentTime = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => currentTime);
    const getValue = (
      getFreshValue: CachifiedOptions<string, any>['getFreshValue'],
    ) =>
      cachified({
        cache,
        key: 'test',
        ttl: 5,
        logger: noopLogger,
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
    let currentTime = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => currentTime);
    const cache = createTestCache();
    let i = 0;
    const getFreshValue = jest.fn(() => `value-${i++}`);
    const getValue = () =>
      cachified({
        cache,
        key: 'test',
        ttl: 5,
        staleWhileRevalidate: 10,
        logger: noopLogger,
        getFreshValue,
      });

    expect(await getValue()).toBe('value-0');
    currentTime = 6;
    // receive cached response since call exceeds ttl but is in stale while revalidate range
    expect(await getValue()).toBe('value-0');
    // wait for next tick (revalidation is done in background)
    await delay(0);
    // next call gets the revalidated response
    expect(await getValue()).toBe('value-1');
    expect(getFreshValue).toHaveBeenCalledTimes(2);

    // Does not deliver stale cache when swr is exceeded
    currentTime = 30;
    expect(await getValue()).toBe('value-2');
    expect(getFreshValue).toHaveBeenCalledTimes(3);
  });

  it('supports infinite stale while revalidate', async () => {
    let currentTime = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => currentTime);
    const cache = createTestCache();
    let i = 0;
    const getFreshValue = jest.fn(() => `value-${i++}`);
    const getValue = () =>
      cachified({
        cache,
        key: 'test',
        ttl: 5,
        staleWhileRevalidate: Infinity,
        logger: noopLogger,
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
    let currentTime = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => currentTime);
    const cache = createTestCache();
    let i = 0;
    const getFreshValue = jest.fn(() => `value-${i++}`);
    const getValue = () =>
      cachified({
        cache,
        key: 'test',
        ttl: 5,
        staleWhileRevalidate: 10,
        logger: noopLogger,
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
    // this again triggers revalidation this time with no error
    expect(await getValue()).toBe('value-0');
    await delay(0);
    // next call gets the fresh value
    expect(await getValue()).toBe('value-1');
    expect(getFreshValue).toHaveBeenCalledTimes(3);
  });

  it('gets fresh value in case cached one does not meet value check', async () => {
    const cache = createTestCache();

    const value = await cachified({
      cache,
      key: 'test',
      logger: noopLogger,
      getFreshValue() {
        return 'ONE';
      },
    });
    const value2 = await cachified({
      cache,
      key: 'test',
      logger: noopLogger,
      checkValue(value) {
        return value === 'TWO';
      },
      getFreshValue() {
        return 'TWO';
      },
    });

    expect(value).toBe('ONE');
    expect(value2).toBe('TWO');
  });

  it('logs reason when value check fails', async () => {
    const cache = createTestCache();

    const value = await cachified({
      cache,
      key: 'test',
      logger: noopLogger,
      getFreshValue() {
        return 'ONE';
      },
    });
    const warn = jest.fn();
    const value2 = await cachified({
      cache,
      key: 'test',
      logger: { ...noopLogger, warn },
      checkValue(value) {
        return value !== 'TWO' ? `Expected ${value} to be TWO` : true;
      },
      getFreshValue() {
        return 'TWO';
      },
    });

    expect(value).toBe('ONE');
    expect(value2).toBe('TWO');
    expect(warn.mock.lastCall[0]).toMatchInlineSnapshot(`
      "check failed for cached value of test
      Reason: Expected ONE to be TWO.
      Deleting the cache key and trying to get a fresh value."
    `);
  });

  it('uses console to log by default', async () => {
    const cache = createTestCache();
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});

    const value = await cachified({
      cache,
      key: 'test',
      getFreshValue() {
        return 'ONE';
      },
    });

    expect(value).toBe('ONE');
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('fails when cache responds with faulty entry', async () => {
    const cache = createTestCache();
    cache.set('test', 'THIS IS NOT AN OBJECT');
    const errorLog = jest.fn();

    const getValue = () =>
      cachified({
        cache,
        key: 'test',
        logger: {
          ...noopLogger,
          error: errorLog,
        },
        getFreshValue() {
          return 'ONE';
        },
      });

    expect(await getValue()).toBe('ONE');
    expect(errorLog.mock.lastCall).toMatchInlineSnapshot(`
      Array [
        "error with cache at test. Deleting the cache key and trying to get a fresh value.",
        [Error: Cache entry for test is not a cache entry object, it's a string],
      ]
    `);

    cache.set('test', { metadata: { ttl: null, createdTime: Date.now() } });
    expect(await getValue()).toBe('ONE');
    expect(errorLog.mock.lastCall).toMatchInlineSnapshot(`
      Array [
        "error with cache at test. Deleting the cache key and trying to get a fresh value.",
        [Error: Cache entry for test does not have a value property],
      ]
    `);

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
      // The call itself does not error since we fall back to fresh value
      expect(await getValue()).toBe('ONE');
      expect(errorLog.mock.lastCall).toMatchInlineSnapshot(`
        Array [
          "error with cache at test. Deleting the cache key and trying to get a fresh value.",
          [Error: Cache entry for test does not have valid metadata property],
        ]
      `);
    }

    // sanity check that we can set a valid entry to cache manually
    cache.set('test', {
      value: 'FOUR',
      metadata: { ttl: null, swr: null, createdTime: Date.now() },
    });
    expect(await getValue()).toBe('FOUR');

    expect(errorLog).toHaveBeenCalledTimes(11);
  });
});

class Deferred<Value> {
  readonly promise: Promise<Value>;
  private _res: any;
  private _rej: any;
  constructor() {
    this.promise = new Promise((res, rej) => {
      this._res = res;
      this._rej = rej;
    });
  }
  resolve(value: Value | Promise<Value>) {
    this._res(value);
  }
  reject(reason: unknown) {
    this._rej(reason);
  }
}

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

function createTestCache() {
  const cache = new Map<string, any>();
  return {
    name: 'test-cache',
    cache,
    get: jest.fn(cache.get.bind(cache)),
    set: jest.fn(cache.set.bind(cache)),
    del: jest.fn(cache.delete.bind(cache)),
  };
}

function delay(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}
