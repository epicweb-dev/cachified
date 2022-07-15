import type { CachifiedOptions, Cache, CacheMetadata } from './common';
import { time } from './time';
import { getCacheEntry, CACHE_EMPTY } from './getCachedValue';
import { shouldRefresh } from './shouldRefresh';

export async function getFreshValue<Value, CacheImpl extends Cache<Value>>(
  options: CachifiedOptions<Value, CacheImpl>,
  metadata: CacheMetadata,
): Promise<Value> {
  const {
    fallbackToCache = true,
    timingType = 'getting fresh value',
    formatDuration = durationInMs,
    key,
    getFreshValue,
    timings,
    logger = console,
    forceFresh,
    cache,
    performance = global.performance || Date,
    checkValue = () => true,
  } = options;
  const start = performance.now();

  let value: Value;
  try {
    value = await time({
      name: `getFreshValue for ${key}`,
      type: timingType,
      fn: getFreshValue,
      performance,
      timings,
    });
  } catch (error) {
    logger.error(
      `getting a fresh value for ${key} failed`,
      { fallbackToCache, forceFresh },
      error,
    );
    // in case a fresh value was forced (and errored) we might be able to
    // still get one from cache
    if (fallbackToCache && forceFresh) {
      const entry = await getCacheEntry(options);
      if (entry === CACHE_EMPTY) {
        throw error;
      }
      value = entry.value;
    } else {
      // we are either not allowed to check the cache or already checked it
      // nothing we can do anymore
      throw error;
    }
  }
  const totalTime = performance.now() - start;

  const valueCheck = checkValue(value);
  if (valueCheck !== true) {
    const reason = typeof valueCheck === 'string' ? valueCheck : 'unknown';
    logger.error(
      `check failed for cached value of ${key}`,
      `Reason: ${reason}.\nDeleting the cache key and trying to get a fresh value.`,
      value,
    );
    throw new Error(`check failed for fresh value of ${key}`);
  } else if (shouldRefresh(metadata) === 'now') {
    // This also prevents long running refresh calls to overwrite more recent cache entries
    logger.log(
      `Not updating the cache value for ${key}.`,
      `Getting a fresh value for this took ${formatDuration(totalTime)}.`,
      `Thereby exceeding caching time of ${formatCacheTime(
        metadata,
        formatDuration,
      )}`,
    );
  } else {
    try {
      logger.log(
        `Updating the cache value for ${key}.`,
        `Getting a fresh value for this took ${formatDuration(totalTime)}.`,
        `Caching for ${formatCacheTime(metadata, formatDuration)} in ${
          cache.name
        }.`,
      );
      await cache.set(key, { metadata, value });
    } catch (error: unknown) {
      logger.error(`error setting cache: ${key}`, error);
    }
  }

  return value;
}

function formatCacheTime(
  { ttl, swv }: CacheMetadata,
  formatDuration: (duration: number) => string,
) {
  if (ttl == null || swv == null) {
    return `forever${
      ttl != null ? ` (revalidation after ${formatDuration(ttl)})` : ''
    }`;
  }

  return `${formatDuration(ttl)} + ${formatDuration(swv)} stale`;
}

function durationInMs(durationMs: number) {
  return `${durationMs}ms`;
}
