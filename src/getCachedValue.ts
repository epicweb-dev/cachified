import type { Cache, CachifiedOptions, CacheEntry } from './common';
import { time } from './time';
import { assertCacheEntry } from './assertCacheEntry';
import { HANDLE } from './common';
import { shouldRefresh } from './shouldRefresh';
import { cachified } from './cachified';

export const CACHE_EMPTY = Symbol();
export async function getCacheEntry<Value, CacheImpl extends Cache<Value>>({
  key,
  cache,
  timings,
  performance = global.performance || Date,
}: CachifiedOptions<Value, CacheImpl>): Promise<
  CacheEntry<Value> | typeof CACHE_EMPTY
> {
  const cached = await time({
    name: `cache.get(${key})`,
    type: 'cache read',
    performance,
    fn: () => cache.get(key),
    timings,
  });
  if (cached) {
    assertCacheEntry(cached, key);
    return cached;
  }
  return CACHE_EMPTY;
}

export async function getCachedValue<Value, CacheImpl extends Cache<Value>>(
  options: CachifiedOptions<Value, CacheImpl>,
): Promise<Value | typeof CACHE_EMPTY> {
  const {
    key,
    cache,
    staleWhileRevalidate,
    staleRefreshTimeout,
    checkValue = () => true,
    getFreshValue: { [HANDLE]: handle },
    logger = console,
  } = options;
  try {
    const cached = await getCacheEntry(options);
    if (cached !== CACHE_EMPTY) {
      const refresh = shouldRefresh(cached.metadata);
      const staleRefresh =
        refresh === 'stale' ||
        (refresh === 'now' && staleWhileRevalidate === Infinity);

      if (staleRefresh) {
        // refresh cache in background so future requests are faster
        setTimeout(() => {
          void cachified({
            ...options,
            forceFresh: true,
            fallbackToCache: false,
          }).catch(() => {
            // Ignore error since this was just in preparation for a future request
          });
        }, staleRefreshTimeout);
      }

      if (!refresh || staleRefresh) {
        const valueCheck = checkValue(cached.value);
        if (valueCheck === true) {
          if (!staleRefresh) {
            // Notify batch that we handled this call using cached value
            handle?.();
          }
          return cached.value;
        } else {
          const reason =
            typeof valueCheck === 'string' ? valueCheck : 'unknown';
          logger.warn(
            `check failed for cached value of ${key}\nReason: ${reason}.\nDeleting the cache key and trying to get a fresh value.`,
            cached,
          );
          await cache.del(key);
        }
      }
    }
  } catch (error: unknown) {
    logger.error(
      `error with cache at ${key}. Deleting the cache key and trying to get a fresh value.`,
      error,
    );
    await cache.del(key);
  }
  return CACHE_EMPTY;
}
