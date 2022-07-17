import type { CachifiedOptions, Cache, CacheMetadata } from './common';
import { getCacheEntry, CACHE_EMPTY } from './getCachedValue';
import { shouldRefresh } from './shouldRefresh';
import { Reporter } from './reporter';

export async function getFreshValue<Value, CacheImpl extends Cache<Value>>(
  options: CachifiedOptions<Value, CacheImpl>,
  metadata: CacheMetadata,
  report: Reporter<Value>,
): Promise<Value> {
  const {
    fallbackToCache = true,
    key,
    getFreshValue,
    forceFresh,
    cache,
    checkValue = () => true,
  } = options;

  let value: Value;
  try {
    report({ name: 'getFreshValueStart' });
    value = await getFreshValue();
    report({ name: 'getFreshValueSuccess', value });
  } catch (error) {
    report({ name: 'getFreshValueError', error });

    // in case a fresh value was forced (and errored) we might be able to
    // still get one from cache
    if (fallbackToCache && forceFresh) {
      const entry = await getCacheEntry(options, report);
      if (entry === CACHE_EMPTY) {
        throw error;
      }
      value = entry.value;
      report({ name: 'getFreshValueCacheFallback', value });
    } else {
      // we are either not allowed to check the cache or already checked it
      // nothing we can do anymore
      throw error;
    }
  }

  const valueCheck = checkValue(value);
  if (valueCheck !== true) {
    const reason = typeof valueCheck === 'string' ? valueCheck : 'unknown';
    report({ name: 'checkFreshValueError', reason });

    throw new Error(`check failed for fresh value of ${key}`);
  }

  try {
    const write = shouldRefresh(metadata) !== 'now';
    if (write) {
      await cache.set(key, { metadata, value });
    }
    report({ name: 'writeFreshValueSuccess', metadata, written: write });
  } catch (error: unknown) {
    report({ name: 'writeFreshValueError', error });
  }

  return value;
}
