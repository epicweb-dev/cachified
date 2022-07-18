import { Cache, CacheEntry } from './common';

interface LRUishCache<Value> extends Omit<Cache<Value>, 'set'> {
  set(
    key: string,
    value: CacheEntry<Value>,
    options?: { ttl?: number; start?: number },
  ): void;
}

export function lruCacheAdapter<Value>(
  lruCache: LRUishCache<Value>,
): Cache<Value> {
  return {
    name: lruCache.name || 'LRU',
    set(key, value) {
      return lruCache.set(key, value, {
        ttl:
          (value?.metadata?.ttl || 0) + (value?.metadata?.swv || 0) ||
          undefined,
        start: value?.metadata?.createdTime,
      });
    },
    get(key) {
      return lruCache.get(key);
    },
    delete(key) {
      return lruCache.delete(key);
    },
  };
}
