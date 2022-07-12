export interface CacheMetadata {
  createdTime: number;
  ttl?: number | null;
  swv?: number | null;
}

export interface CacheEntry<Value> {
  metadata: CacheMetadata;
  value: Value;
}

type Eventually<Value> =
  | Value
  | null
  | undefined
  | Promise<Value | null | undefined>;

export interface Cache<Value> {
  name: string;
  get: (key: string) => Eventually<{
    metadata: CacheMetadata;
    value: Value;
  }>;
  set: (key: string, value: CacheEntry<Value>) => unknown | Promise<unknown>;
  del: (key: string) => unknown | Promise<unknown>;
}

type Timings = Record<
  string,
  Array<{ name: string; type: string; time: number }>
>;

const HANDLE = Symbol();
type GetFreshValue<Value> = {
  (): Promise<Value> | Value;
  [HANDLE]?: () => void;
};
export interface CachifiedOptions<Value, CacheImpl extends Cache<Value>> {
  key: string;
  cache: CacheImpl;
  getFreshValue: GetFreshValue<Value>;
  checkValue?: (value: unknown) => boolean | string;
  logger?: Pick<typeof console, 'log' | 'error' | 'warn'>;
  forceFresh?: boolean | string;
  // request?: Request;
  fallbackToCache?: boolean;
  timings?: Timings;
  timingType?: string;
  ttl?: number;
  staleWhileRevalidate?: number;
  performance?: Pick<Performance, 'now'>;
  staleRefreshTimeout?: number;
  formatDuration?: (duration: number) => string;
}

const pendingValuesByCache = new WeakMap<Cache<any>, Map<string, any>>();

export async function cachified<Value, CacheImpl extends Cache<Value>>(
  options: CachifiedOptions<Value, CacheImpl>,
): Promise<Value> {
  const {
    key,
    cache,
    checkValue = () => true,
    logger = console,
    timings,
    ttl,
    performance = global.performance || Date,
    getFreshValue: { [HANDLE]: handle },
    staleWhileRevalidate = 0,
    staleRefreshTimeout = 0,
  } = options;

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

  if (!forceFresh) {
    try {
      const cached = await time({
        name: `cache.get(${key})`,
        type: 'cache read',
        performance,
        fn: () => cache.get(key),
        timings,
      });
      if (cached) {
        assertCacheEntry(cached, key);
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

type AddFn<Value, Param> = (param: Param) => GetFreshValue<Value>;

export function createBatch<Value, Param>(
  getFreshValue: (params: Param[]) => Value[] | Promise<Value[]>,
  autoSubmit: false,
): {
  submit: () => Promise<void>;
  add: AddFn<Value, Param>;
};
export function createBatch<Value, Param>(
  getFreshValue: (params: Param[]) => Value[] | Promise<Value[]>,
): {
  add: AddFn<Value, Param>;
};
export function createBatch<Value, Param>(
  getFreshValue: (params: Param[]) => Value[] | Promise<Value[]>,
  autoSubmit: boolean = true,
): {
  submit?: () => Promise<void>;
  add: AddFn<Value, Param>;
} {
  const requests: [
    param: Param,
    res: (value: Value) => void,
    rej: (reason: unknown) => void,
  ][] = [];
  let adds = 0;
  let handled = 0;
  let submitted = false;
  const checkSubmission = () => {
    if (submitted) {
      throw new Error('Can not add to batch after submission');
    }
  };
  let resolveSubmission: () => void;
  let rejectSubmission: (reason: unknown) => void;
  const submissionP = new Promise<void>((res, rej) => {
    resolveSubmission = res;
    rejectSubmission = rej;
  });

  const submit = async () => {
    if (handled !== adds) {
      autoSubmit = true;
      return submissionP;
    }
    checkSubmission();
    submitted = true;
    try {
      const results = await Promise.resolve(
        getFreshValue(requests.map(([param]) => param)),
      );
      results.forEach((value, index) => requests[index][1](value));
      resolveSubmission();
    } catch (err) {
      requests.forEach(([_, __, rej]) => rej(err));
      rejectSubmission(err);
    }
  };

  const trySubmitting = () => {
    handled++;
    if (autoSubmit === false) {
      return;
    }
    submit();
  };

  return {
    ...(autoSubmit === false ? { submit } : {}),
    add(param) {
      checkSubmission();
      adds++;
      let handled = false;

      return Object.assign(
        () => {
          return new Promise<Value>((res, rej) => {
            requests.push([param, res, rej]);
            if (!handled) {
              handled = true;
              trySubmitting();
            }
          });
        },
        {
          [HANDLE]: () => {
            if (!handled) {
              handled = true;
              trySubmitting();
            }
          },
        },
      );
    },
  };
}

async function getFreshValue<Value, CacheImpl extends Cache<Value>>(
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

  try {
    var value = await time({
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
      var value = await cachified({ ...options, forceFresh: false });
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

function shouldRefresh(metadata: CacheMetadata): 'now' | 'stale' | false {
  if (metadata.ttl) {
    const valid = metadata.createdTime + metadata.ttl;
    const stale = valid + (metadata.swv || 0);
    const now = Date.now();
    if (now <= valid) {
      return false;
    }
    if (now <= stale) {
      return 'stale';
    }

    return 'now';
  }
  return false;
}

function assertCacheEntry(
  entry: unknown,
  key: string,
): asserts entry is {
  metadata: CacheMetadata;
  value: unknown;
} {
  if (!isRecord(entry)) {
    throw new Error(
      `Cache entry for ${key} is not a cache entry object, it's a ${typeof entry}`,
    );
  }
  if (
    !isRecord(entry.metadata) ||
    typeof entry.metadata.createdTime !== 'number' ||
    (entry.metadata.ttl != null && typeof entry.metadata.ttl !== 'number') ||
    (entry.metadata.swr != null && typeof entry.metadata.swr !== 'number')
  ) {
    throw new Error(
      `Cache entry for ${key} does not have valid metadata property`,
    );
  }

  if (!('value' in entry)) {
    throw new Error(`Cache entry for ${key} does not have a value property`);
  }
}

function isRecord(entry: unknown): entry is Record<string, unknown> {
  return typeof entry === 'object' && entry !== null && !Array.isArray(entry);
}

interface TimeOptions<ReturnType> {
  name: string;
  type: string;
  performance: Pick<Performance, 'now'>;
  fn: () => ReturnType | Promise<ReturnType>;
  timings?: Timings;
}
async function time<ReturnType>({
  name,
  type,
  fn,
  performance,
  timings,
}: TimeOptions<ReturnType>): Promise<ReturnType> {
  if (!timings) return fn();

  const start = performance.now();
  const result = await fn();
  type = type.replaceAll(' ', '_');
  let timingType = timings[type];
  if (!timingType) {
    // eslint-disable-next-line no-multi-assign
    timingType = timings[type] = [];
  }

  timingType.push({ name, type, time: performance.now() - start });
  return result;
}
