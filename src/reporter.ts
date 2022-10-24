import { CacheMetadata, Context } from './common';

export type GetFreshValueStartEvent = {
  name: 'getFreshValueStart';
};
export type GetFreshValueHookPendingEvent = {
  name: 'getFreshValueHookPending';
};
export type GetFreshValueSuccessEvent<Value> = {
  name: 'getFreshValueSuccess';
  value: Value;
};
export type GetFreshValueErrorEvent = {
  name: 'getFreshValueError';
  error: unknown;
};
export type GetFreshValueCacheFallbackEvent = {
  name: 'getFreshValueCacheFallback';
  value: unknown;
};
export type CheckFreshValueErrorEvent<Value> = {
  name: 'checkFreshValueError';
  reason: string;
};
export type WriteFreshValueSuccessEvent<Value> = {
  name: 'writeFreshValueSuccess';
  metadata: CacheMetadata;
  /**
   * Value might not actually be written to cache in case getting fresh
   * value took longer then ttl */
  written: boolean;
  migrated: boolean;
};
export type WriteFreshValueErrorEvent = {
  name: 'writeFreshValueError';
  error: unknown;
};

export type GetCachedValueStartEvent = {
  name: 'getCachedValueStart';
};
export type GetCachedValueReadEvent = {
  name: 'getCachedValueRead';
  entry: unknown;
};
export type GetCachedValueEmptyEvent = {
  name: 'getCachedValueEmpty';
};
export type GetCachedValueOutdatedEvent = {
  name: 'getCachedValueOutdated';
  value: unknown;
  metadata: CacheMetadata;
};
export type GetCachedValueSuccessEvent<Value> = {
  name: 'getCachedValueSuccess';
  value: Value;
  migrated: boolean;
};
export type CheckCachedValueErrorEvent = {
  name: 'checkCachedValueError';
  reason: string;
};
export type GetCachedValueErrorEvent = {
  name: 'getCachedValueError';
  error: unknown;
};

export type RefreshValueStartEvent = {
  name: 'refreshValueStart';
};
export type RefreshValueSuccessEvent<Value> = {
  name: 'refreshValueSuccess';
  value: Value;
};
export type RefreshValueErrorEvent = {
  name: 'refreshValueError';
  error: unknown;
};

export type CacheEvent<Value> =
  | GetFreshValueStartEvent
  | GetFreshValueHookPendingEvent
  | GetFreshValueSuccessEvent<Value>
  | GetFreshValueErrorEvent
  | GetFreshValueCacheFallbackEvent
  | CheckFreshValueErrorEvent<Value>
  | WriteFreshValueSuccessEvent<Value>
  | WriteFreshValueErrorEvent
  | GetCachedValueStartEvent
  | GetCachedValueReadEvent
  | GetCachedValueEmptyEvent
  | GetCachedValueOutdatedEvent
  | GetCachedValueSuccessEvent<Value>
  | CheckCachedValueErrorEvent
  | GetCachedValueErrorEvent
  | RefreshValueStartEvent
  | RefreshValueSuccessEvent<Value>
  | RefreshValueErrorEvent;

export type Reporter<Value> = (event: CacheEvent<Value>) => void;

export type CreateReporter<Value> = (
  context: Omit<Context<Value>, 'report'>,
) => Reporter<Value>;

const defaultFormatDuration = (ms: number) => `${Math.round(ms)}ms`;
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

interface ReporterOpts {
  formatDuration?: (ms: number) => string;
  logger?: Pick<typeof console, 'log' | 'warn' | 'error'>;
  performance?: Pick<typeof Date, 'now'>;
}
export function verboseReporter<Value>({
  formatDuration = defaultFormatDuration,
  logger = console,
  performance = global.performance || Date,
}: ReporterOpts = {}): CreateReporter<Value> {
  return ({ key, fallbackToCache, forceFresh, metadata, cache }) => {
    const cacheName =
      cache.name ||
      cache
        .toString()
        .toString()
        .replace(/^\[object (.*?)]$/, '$1');
    let cached: unknown;
    let freshValue: unknown;
    let getFreshValueStartTs: number;
    let refreshValueStartTS: number;

    return (event) => {
      switch (event.name) {
        case 'getCachedValueRead':
          cached = event.entry;
          break;
        case 'checkCachedValueError':
          logger.warn(
            `check failed for cached value of ${key}\nReason: ${event.reason}.\nDeleting the cache key and trying to get a fresh value.`,
            cached,
          );
          break;
        case 'getCachedValueError':
          logger.error(
            `error with cache at ${key}. Deleting the cache key and trying to get a fresh value.`,
            event.error,
          );
          break;
        case 'getFreshValueError':
          logger.error(
            `getting a fresh value for ${key} failed`,
            { fallbackToCache, forceFresh },
            event.error,
          );
          break;
        case 'getFreshValueStart':
          getFreshValueStartTs = performance.now();
          break;
        case 'writeFreshValueSuccess': {
          const totalTime = performance.now() - getFreshValueStartTs;
          if (event.written) {
            logger.log(
              `Updated the cache value for ${key}.`,
              `Getting a fresh value for this took ${formatDuration(
                totalTime,
              )}.`,
              `Caching for ${formatCacheTime(
                metadata,
                formatDuration,
              )} in ${cacheName}.`,
            );
          } else {
            logger.log(
              `Not updating the cache value for ${key}.`,
              `Getting a fresh value for this took ${formatDuration(
                totalTime,
              )}.`,
              `Thereby exceeding caching time of ${formatCacheTime(
                metadata,
                formatDuration,
              )}`,
            );
          }
          break;
        }
        case 'writeFreshValueError':
          logger.error(`error setting cache: ${key}`, event.error);
          break;
        case 'getFreshValueSuccess':
          freshValue = event.value;
          break;
        case 'checkFreshValueError':
          logger.error(
            `check failed for fresh value of ${key}\nReason: ${event.reason}.`,
            freshValue,
          );
          break;
        case 'refreshValueStart':
          refreshValueStartTS = performance.now();
          break;
        case 'refreshValueSuccess':
          logger.log(
            `Background refresh for ${key} successful.`,
            `Getting a fresh value for this took ${formatDuration(
              performance.now() - refreshValueStartTS,
            )}.`,
            `Caching for ${formatCacheTime(
              metadata,
              formatDuration,
            )} in ${cacheName}.`,
          );
          break;
        case 'refreshValueError':
          logger.log(`Background refresh for ${key} failed.`, event.error);
          break;
      }
    };
  };
}
