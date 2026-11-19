import {
  cachified,
  cachifiedWithMetadata,
  CacheEntry,
  CacheEvent,
  createCacheEntry,
} from './index';
import { delay } from './testHelpers';

jest.mock('./index', () => {
  if (process.version.startsWith('v20')) {
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

describe('cachifiedWithMetadata', () => {
  it('reports MISS for a fresh value and HIT once it is cached', async () => {
    const cache = new Map<string, CacheEntry>();
    const getFreshValue = jest.fn(() => 'ONE');

    expect(
      await cachifiedWithMetadata({ cache, key: 'test', getFreshValue }),
    ).toEqual({ value: 'ONE', status: 'MISS' });
    expect(
      await cachifiedWithMetadata({ cache, key: 'test', getFreshValue }),
    ).toEqual({ value: 'ONE', status: 'HIT' });
    expect(getFreshValue).toHaveBeenCalledTimes(1);
  });

  it('reports REVALIDATING for a stale value and HIT after the refresh', async () => {
    const cache = new Map<string, CacheEntry>();
    cache.set('test', createCacheEntry('OLD', { ttl: 5, swr: 10 }));
    currentTime = 6;

    expect(
      await cachifiedWithMetadata({
        cache,
        key: 'test',
        ttl: 5,
        swr: 10,
        getFreshValue: () => 'NEW',
      }),
    ).toEqual({ value: 'OLD', status: 'REVALIDATING' });

    await delay(1);

    expect(
      await cachifiedWithMetadata({
        cache,
        key: 'test',
        ttl: 5,
        swr: 10,
        getFreshValue: () => 'NEWER',
      }),
    ).toEqual({ value: 'NEW', status: 'HIT' });
  });

  it('reports REVALIDATING for an expired value when swr is Infinity', async () => {
    const cache = new Map<string, CacheEntry>();
    cache.set('test', createCacheEntry('OLD', { ttl: 5, swr: Infinity }));
    currentTime = 1000;

    expect(
      await cachifiedWithMetadata({
        cache,
        key: 'test',
        ttl: 5,
        swr: Infinity,
        getFreshValue: () => 'NEW',
      }),
    ).toEqual({ value: 'OLD', status: 'REVALIDATING' });
  });

  it('reports MISS when the cached value is past ttl + swr', async () => {
    const cache = new Map<string, CacheEntry>();
    cache.set('test', createCacheEntry('OLD', { ttl: 5, swr: 10 }));
    currentTime = 16;

    expect(
      await cachifiedWithMetadata({
        cache,
        key: 'test',
        ttl: 5,
        swr: 10,
        getFreshValue: () => 'NEW',
      }),
    ).toEqual({ value: 'NEW', status: 'MISS' });
  });

  it('reports MISS when forceFresh skips the cache', async () => {
    const cache = new Map<string, CacheEntry>();
    cache.set('test', createCacheEntry('OLD'));

    expect(
      await cachifiedWithMetadata({
        cache,
        key: 'test',
        forceFresh: true,
        getFreshValue: () => 'NEW',
      }),
    ).toEqual({ value: 'NEW', status: 'MISS' });
  });

  it('reports MISS when the cached value fails checkValue', async () => {
    const cache = new Map<string, CacheEntry>();
    cache.set('test', createCacheEntry('OLD'));

    expect(
      await cachifiedWithMetadata({
        cache,
        key: 'test',
        checkValue: (value) => value !== 'OLD',
        getFreshValue: () => 'NEW',
      }),
    ).toEqual({ value: 'NEW', status: 'MISS' });
  });

  it('reports FALLBACK when forceFresh fails and the cached value is used', async () => {
    const cache = new Map<string, CacheEntry>();
    cache.set('test', createCacheEntry('OLD'));

    expect(
      await cachifiedWithMetadata({
        cache,
        key: 'test',
        forceFresh: true,
        getFreshValue() {
          throw new Error('🔥');
        },
      }),
    ).toEqual({ value: 'OLD', status: 'FALLBACK' });
  });

  it('reports MISS for calls that share an in-flight fresh value', async () => {
    const cache = new Map<string, CacheEntry>();
    const getFreshValue = jest.fn(async () => {
      await delay(5);
      return 'ONE';
    });

    const results = await Promise.all([
      cachifiedWithMetadata({ cache, key: 'test', getFreshValue }),
      cachifiedWithMetadata({ cache, key: 'test', getFreshValue }),
    ]);

    expect(results).toEqual([
      { value: 'ONE', status: 'MISS' },
      { value: 'ONE', status: 'MISS' },
    ]);
    expect(getFreshValue).toHaveBeenCalledTimes(1);
  });

  it('reports FALLBACK for calls that share an in-flight call that fell back to the cache', async () => {
    const cache = new Map<string, CacheEntry>();
    cache.set('test', createCacheEntry('OLD', { ttl: 5 }));
    currentTime = 10;

    const results = await Promise.all([
      cachifiedWithMetadata({
        cache,
        key: 'test',
        forceFresh: true,
        fallbackToCache: true,
        async getFreshValue() {
          await delay(5);
          throw new Error('🔥');
        },
      }),
      cachifiedWithMetadata({ cache, key: 'test', getFreshValue: () => 'NEW' }),
    ]);

    expect(results).toEqual([
      { value: 'OLD', status: 'FALLBACK' },
      { value: 'OLD', status: 'FALLBACK' },
    ]);
  });

  it('still calls the reporter', async () => {
    const cache = new Map<string, CacheEntry>();
    const events: CacheEvent<string>[] = [];

    await cachifiedWithMetadata(
      { cache, key: 'test', getFreshValue: () => 'ONE' },
      () => (event) => events.push(event),
    );

    expect(events.map(({ name }) => name)).toEqual([
      'getCachedValueStart',
      'getCachedValueRead',
      'getCachedValueEmpty',
      'getFreshValueStart',
      'getFreshValueSuccess',
      'writeFreshValueSuccess',
      'done',
    ]);
  });

  it('rejects like cachified when no value can be found', async () => {
    const cache = new Map<string, CacheEntry>();

    await expect(
      cachifiedWithMetadata({
        cache,
        key: 'test',
        getFreshValue() {
          throw new Error('🔥');
        },
      }),
    ).rejects.toThrow('🔥');
  });

  it('shares the cache with cachified', async () => {
    const cache = new Map<string, CacheEntry>();

    await cachified({ cache, key: 'test', getFreshValue: () => 'ONE' });

    expect(
      await cachifiedWithMetadata({
        cache,
        key: 'test',
        getFreshValue: () => 'TWO',
      }),
    ).toEqual({ value: 'ONE', status: 'HIT' });
  });
});
