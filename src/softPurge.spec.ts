import { createCacheEntry } from './common';
import { softPurge } from './softPurge';

let currentTime = 0;
beforeEach(() => {
  currentTime = 0;
  jest.spyOn(Date, 'now').mockImplementation(() => currentTime);
});

describe('softPurge', () => {
  it('does not update entry when cache is outdated already', async () => {
    const cache = new Map();

    cache.set('key', createCacheEntry('value', { ttl: 5 }));
    currentTime = 10;
    jest.spyOn(cache, 'set');

    await softPurge({ cache, key: 'key' });

    expect(cache.set).not.toHaveBeenCalled();
  });

  it('does nothing when cache is empty', async () => {
    const cache = new Map();

    await softPurge({ cache, key: 'key' });
  });

  it('throws when entry is invalid', async () => {
    const cache = new Map();

    cache.set('key', '???');

    await expect(
      softPurge({ cache, key: 'key' }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `"Cache entry for key is not a cache entry object, it's a string"`,
    );
  });

  it('sets ttl to 0 and swr to previous ttl', async () => {
    const cache = new Map();

    cache.set('key', createCacheEntry('value', { ttl: 1000 }));

    await softPurge({ cache, key: 'key' });

    expect(cache.get('key')).toEqual(
      createCacheEntry('value', { ttl: 0, swr: 1000 }),
    );
  });

  it('sets ttl to 0 and swr to previous ttl + previous swr', async () => {
    const cache = new Map();

    cache.set('key', createCacheEntry('value', { ttl: 1000, swr: 50 }));

    await softPurge({ cache, key: 'key' });

    expect(cache.get('key')).toEqual(
      createCacheEntry('value', { ttl: 0, swr: 1050 }),
    );
  });

  it('sets ttl to 0 and swr to infinity when ttl was infinity', async () => {
    const cache = new Map();

    cache.set('key', createCacheEntry('value', { ttl: Infinity }));

    await softPurge({ cache, key: 'key' });

    expect(cache.get('key')).toEqual(
      createCacheEntry('value', { ttl: 0, swr: Infinity }),
    );
  });

  it('allows to set a custom stale while revalidate value', async () => {
    const cache = new Map();
    currentTime = 30;

    cache.set('key', createCacheEntry('value', { ttl: Infinity }));

    currentTime = 40;

    await softPurge({ cache, key: 'key', staleWhileRevalidate: 50 });

    expect(cache.get('key')).toEqual(
      createCacheEntry('value', { ttl: 0, swr: 60, createdTime: 30 }),
    );
  });

  it('supports swr alias', async () => {
    const cache = new Map();
    currentTime = 30;

    cache.set('key', createCacheEntry('value', { ttl: Infinity }));

    currentTime = 55;

    await softPurge({ cache, key: 'key', swr: 10 });

    expect(cache.get('key')).toEqual(
      createCacheEntry('value', { ttl: 0, swr: 35, createdTime: 30 }),
    );
  });
});
