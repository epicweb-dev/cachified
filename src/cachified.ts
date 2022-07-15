import type {
  CachifiedOptions,
  Cache,
  CacheEntry,
  CacheMetadata,
} from './common';
import { CACHE_EMPTY, getCachedValue } from './getCachedValue';
import { getFreshValue } from './getFreshValue';
import { shouldRefresh } from './shouldRefresh';

const pendingValuesByCache = new WeakMap<Cache<any>, Map<string, any>>();

export async function cachified<Value, CacheImpl extends Cache<Value>>(
  options: CachifiedOptions<Value, CacheImpl>,
): Promise<Value> {
  const { key, cache, ttl, staleWhileRevalidate = 0 } = options;

  if (!pendingValuesByCache.has(cache)) {
    pendingValuesByCache.set(cache, new Map());
  }
  const pendingValues: Map<
    string,
    CacheEntry<Promise<Value>> & { resolve: (value: Value) => void }
  > = pendingValuesByCache.get(cache)!;

  const metadata: CacheMetadata = {
    ttl: ttl ?? null,
    swv: staleWhileRevalidate === Infinity ? null : staleWhileRevalidate,
    createdTime: Date.now(),
  };

  // if forceFresh is a string, we'll only force fresh if the key is in the
  // comma separated list.
  const forceFresh =
    typeof options.forceFresh === 'string'
      ? options.forceFresh.split(',').includes(key)
      : options.forceFresh;

  const cachedValue =
    (!forceFresh && (await getCachedValue(options))) || CACHE_EMPTY;
  if (cachedValue !== CACHE_EMPTY) {
    return cachedValue;
  }

  if (pendingValues.has(key)) {
    const { value, metadata } = pendingValues.get(key)!;
    if (!shouldRefresh(metadata)) {
      return value;
    }
  }

  let resolveEarly: (value: Value) => void;

  const freshValue = Promise.race([
    // try to get a fresh value
    getFreshValue(options, metadata),
    // when a later call is faster, we'll take it's response
    new Promise<Value>((r) => {
      resolveEarly = r;
    }),
  ]).finally(() => {
    pendingValues.delete(key);
  });

  // here we inform earlier calls that we got a response
  if (pendingValues.has(key)) {
    const { resolve } = pendingValues.get(key)!;
    freshValue.then((value) => resolve(value));
  }

  pendingValues.set(key, {
    metadata,
    value: freshValue,
    resolve(value) {
      // here we receive a fresh value from a later call and use that
      resolveEarly(value);
    },
  });

  return freshValue;
}
