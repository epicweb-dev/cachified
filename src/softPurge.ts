import { Cache, createCacheEntry, staleWhileRevalidate } from './common';
import { CACHE_EMPTY, getCacheEntry } from './getCachedValue';
import { shouldRefresh } from './shouldRefresh';

interface SoftPurgeOpts {
  cache: Cache;
  key: string;
  /**
   * Force the entry to outdate after ms
   */
  staleWhileRevalidate?: number;
  /**
   * Force the entry to outdate after ms
   */
  swr?: number;
}

export async function softPurge({
  cache,
  key,
  ...swrOverwrites
}: SoftPurgeOpts) {
  const swrOverwrite = swrOverwrites.swr ?? swrOverwrites.staleWhileRevalidate;
  const entry = await getCacheEntry({ cache, key }, () => {});

  if (entry === CACHE_EMPTY || shouldRefresh(entry.metadata)) {
    return;
  }

  const ttl = entry.metadata.ttl || Infinity;
  const swr = staleWhileRevalidate(entry.metadata) || 0;
  const lt = Date.now() - entry.metadata.createdTime;

  await cache.set(
    key,
    createCacheEntry(entry.value, {
      ttl: 0,
      swr: swrOverwrite === undefined ? ttl + swr : swrOverwrite + lt,
      createdTime: entry.metadata.createdTime,
    }),
  );
}
