import { Cache, CacheEntry, totalTtl } from './common';

export interface LRUishCache extends Omit<Cache, 'set'> {
  set(
    key: string,
    value: CacheEntry<unknown>,
    options?: { ttl?: number; start?: number },
  ): void;
}

export function lruCacheAdapter(lruCache: LRUishCache): Cache {
  return {
    name: lruCache.name || 'LRU',
    set(key, value) {
      const ttl = totalTtl(value?.metadata);
      return lruCache.set(key, value, {
        ttl: ttl === Infinity ? undefined : ttl,
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
