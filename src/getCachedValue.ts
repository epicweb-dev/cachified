import { Context, CacheEntry } from './common';
import { assertCacheEntry } from './assertCacheEntry';
import { HANDLE } from './common';
import { shouldRefresh } from './shouldRefresh';
import { cachified } from './cachified';
import { Reporter } from './reporter';
import { checkValue } from './checkValue';

export const CACHE_EMPTY = Symbol();
export async function getCacheEntry<Value>(
  { key, cache }: Pick<Context<Value>, 'key' | 'cache'>,
  report: Reporter<Value>,
): Promise<CacheEntry<unknown> | typeof CACHE_EMPTY> {
  report({ name: 'getCachedValueStart' });
  const cached = await cache.get(key);
  report({ name: 'getCachedValueRead', entry: cached });
  if (cached) {
    assertCacheEntry(cached, key);
    return cached;
  }
  return CACHE_EMPTY;
}

export async function getCachedValue<Value>(
  context: Context<Value>,
  report: Reporter<Value>,
  hasPendingValue: () => boolean,
): Promise<Value | typeof CACHE_EMPTY> {
  const {
    key,
    cache,
    staleWhileRevalidate,
    staleRefreshTimeout,
    metadata,
    getFreshValue: { [HANDLE]: handle },
  } = context;
  try {
    const cached = await getCacheEntry(context, report);

    if (cached === CACHE_EMPTY) {
      report({ name: 'getCachedValueEmpty' });
      return CACHE_EMPTY;
    }

    const refresh = shouldRefresh(cached.metadata);
    const staleRefresh =
      refresh === 'stale' ||
      (refresh === 'now' && staleWhileRevalidate === Infinity);

    if (refresh === 'now') {
      report({ name: 'getCachedValueOutdated', ...cached });
    }

    if (staleRefresh) {
      // refresh cache in background so future requests are faster
      setTimeout(() => {
        report({ name: 'refreshValueStart' });
        void cachified({
          ...context,
          getFreshValue({ metadata }) {
            return context.getFreshValue({ metadata, background: true });
          },
          forceFresh: true,
          fallbackToCache: false,
        })
          .then((value) => {
            report({ name: 'refreshValueSuccess', value });
          })
          .catch((error) => {
            report({ name: 'refreshValueError', error });
          });
      }, staleRefreshTimeout);
    }

    if (!refresh || staleRefresh) {
      const valueCheck = await checkValue(context, cached.value);
      if (valueCheck.success) {
        report({
          name: 'getCachedValueSuccess',
          value: valueCheck.value,
          migrated: valueCheck.migrated,
        });
        if (!staleRefresh) {
          // Notify batch that we handled this call using cached value
          handle?.();
        }

        if (valueCheck.migrated) {
          setTimeout(async () => {
            try {
              const cached = await context.cache.get(context.key);

              // Unless cached value was changed in the meantime or is about to
              // change
              if (
                cached &&
                cached.metadata.createdTime === metadata.createdTime &&
                !hasPendingValue()
              ) {
                // update with migrated value
                await context.cache.set(context.key, {
                  ...cached,
                  value: valueCheck.value,
                });
              }
            } catch (err) {
              /* ¯\_(ツ)_/¯ */
            }
          }, 0);
        }

        return valueCheck.value;
      } else {
        report({ name: 'checkCachedValueErrorObj', reason: valueCheck.reason });
        report({
          name: 'checkCachedValueError',
          reason:
            valueCheck.reason instanceof Error
              ? valueCheck.reason.message
              : String(valueCheck.reason),
        });

        await cache.delete(key);
      }
    }
  } catch (error: unknown) {
    report({ name: 'getCachedValueError', error });

    await cache.delete(key);
  }

  return CACHE_EMPTY;
}
