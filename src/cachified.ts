import {
  CachifiedOptions,
  CachifiedOptionsWithSchema,
  Cache,
  createContext,
  HANDLE,
} from './common';
import { CACHE_EMPTY, getCachedValue } from './getCachedValue';
import { getFreshValue } from './getFreshValue';
import { CreateReporter } from './reporter';
import { isExpired } from './isExpired';

// This is to prevent requesting multiple fresh values in parallel
// while revalidating or getting first value
// Keys are unique per cache but may be used by multiple caches
const pendingValuesByCache = new WeakMap<Cache, Map<string, any>>();

/**
 * Get the internal pending values cache for a given cache
 */
export function getPendingValuesCache(cache: Cache) {
  if (!pendingValuesByCache.has(cache)) {
    pendingValuesByCache.set(cache, new Map());
  }
  return pendingValuesByCache.get(cache)!;
}

/**
 * How the value of a `cachifiedWithMetadata` call was obtained.
 *
 * - `HIT`: a fresh value from the cache was used
 * - `REVALIDATING`: a stale value from the cache was used while a background
 *   refresh was queued (stale while revalidate)
 * - `MISS`: the value came from `getFreshValue`
 * - `FALLBACK`: `forceFresh` was set and `getFreshValue` failed, so the cached
 *   value was used (see `fallbackToCache`)
 *
 * A call that shares an in-flight `getFreshValue` call for the same key reports
 * the status of that call (`MISS`, or `FALLBACK` if it fell back to the cache).
 */
export type CacheStatus = 'HIT' | 'REVALIDATING' | 'MISS' | 'FALLBACK';

export type CachifiedResult<Value> = {
  value: Value;
  status: CacheStatus;
};

export async function cachified<Value, InternalValue>(
  options: CachifiedOptionsWithSchema<Value, InternalValue>,
  reporter?: CreateReporter<Value>,
): Promise<Value>;
export async function cachified<Value>(
  options: CachifiedOptions<Value>,
  reporter?: CreateReporter<Value>,
): Promise<Value>;
export async function cachified<Value>(
  options: CachifiedOptions<Value>,
  reporter?: CreateReporter<Value>,
): Promise<Value> {
  return (await cachifiedWithStatus(options, reporter)).value;
}

/**
 * Same as `cachified`, but resolves with the value and the `status` telling
 * whether it came from the cache or from `getFreshValue`.
 */
export async function cachifiedWithMetadata<Value, InternalValue>(
  options: CachifiedOptionsWithSchema<Value, InternalValue>,
  reporter?: CreateReporter<Value>,
): Promise<CachifiedResult<Value>>;
export async function cachifiedWithMetadata<Value>(
  options: CachifiedOptions<Value>,
  reporter?: CreateReporter<Value>,
): Promise<CachifiedResult<Value>>;
export async function cachifiedWithMetadata<Value>(
  options: CachifiedOptions<Value>,
  reporter?: CreateReporter<Value>,
): Promise<CachifiedResult<Value>> {
  return cachifiedWithStatus(options, reporter);
}

async function cachifiedWithStatus<Value>(
  options: CachifiedOptions<Value>,
  reporter?: CreateReporter<Value>,
): Promise<CachifiedResult<Value>> {
  const context = createContext(options, reporter);
  const { key, cache, forceFresh, report, metadata } = context;
  const pendingValues = getPendingValuesCache(cache);

  const hasPendingValue = () => {
    return pendingValues.has(key);
  };
  const cachedValue = !forceFresh
    ? await getCachedValue(context, report, hasPendingValue)
    : CACHE_EMPTY;
  if (cachedValue !== CACHE_EMPTY) {
    report({ name: 'done', value: cachedValue.value });
    return {
      value: cachedValue.value,
      status: cachedValue.stale ? 'REVALIDATING' : 'HIT',
    };
  }

  if (pendingValues.has(key)) {
    const pending = pendingValues.get(key)!;

    if (!isExpired(pending.metadata)) {
      /* Notify batch that we handled this call using pending value */
      context.getFreshValue[HANDLE]?.();
      report({ name: 'getFreshValueHookPending' });
      const value = await pending.value;
      report({ name: 'done', value });
      /* A shared value reports the status of the call that produced it */
      return { value, status: pending.usedCacheFallback ? 'FALLBACK' : 'MISS' };
    }
  }

  /* Kept on the pending entry so calls that join it can read it too */
  const pending: {
    metadata: typeof metadata;
    value?: Promise<Value>;
    resolve?: (value: Value) => void;
    usedCacheFallback: boolean;
  } = { metadata, usedCacheFallback: false };
  const reportAndTrackFallback: typeof report = (event) => {
    if (event.name === 'getFreshValueCacheFallback') {
      pending.usedCacheFallback = true;
    }
    report(event);
  };

  let resolveFromFuture: (value: Value) => void;
  const freshValue = Promise.race([
    // try to get a fresh value
    getFreshValue(context, metadata, reportAndTrackFallback),
    // or when a future call is faster, we'll take it's value
    // this happens when getting value of first call takes longer then ttl + second response
    new Promise<Value>((r) => {
      resolveFromFuture = r;
    }),
  ]).finally(() => {
    pendingValues.delete(key);
  });

  // here we inform past calls that we got a response
  if (pendingValues.has(key)) {
    const { resolve } = pendingValues.get(key)!;
    freshValue.then((value) => resolve(value)).catch(() => {});
  }

  pending.value = freshValue;
  // here we receive a fresh value from a future call
  pending.resolve = resolveFromFuture!;
  pendingValues.set(key, pending);

  const value = await freshValue;
  report({ name: 'done', value });
  return { value, status: pending.usedCacheFallback ? 'FALLBACK' : 'MISS' };
}
