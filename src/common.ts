import type { CreateReporter, Reporter } from './reporter';

export interface CacheMetadata {
  createdTime: number;
  ttl?: number | null;
  swr?: number | null;
  /** @deprecated use swr instead */
  readonly swv?: number | null;
}

export interface CacheEntry<Value = unknown> {
  metadata: CacheMetadata;
  value: Value;
}

export type Eventually<Value> =
  | Value
  | null
  | undefined
  | Promise<Value | null | undefined>;

export interface Cache {
  name?: string;
  get: (key: string) => Eventually<CacheEntry<unknown>>;
  set: (key: string, value: CacheEntry<unknown>) => unknown | Promise<unknown>;
  delete: (key: string) => unknown | Promise<unknown>;
}

export const HANDLE = Symbol();
export type GetFreshValue<Value> = {
  (): Promise<Value> | Value;
  [HANDLE]?: () => void;
};
export const MIGRATED = Symbol();
export type MigratedValue<Value> = {
  [MIGRATED]: true;
  value: Value;
};

export type ValueCheckResultOk<Value> =
  | true
  | undefined
  | null
  | void
  | MigratedValue<Value>;
export type ValueCheckResultInvalid = false | string;
export type ValueCheckResult<Value> =
  | ValueCheckResultOk<Value>
  | ValueCheckResultInvalid;

export interface CachifiedOptions<Value> {
  /**
   * The key this value is cached by
   *
   * @type {string} Required
   */
  key: string;
  /**
   * Cache implementation to use
   *
   * Must conform with signature
   *  - set(key: string, value: object): void | Promise<void>
   *  - get(key: string): object | Promise<object>
   *  - delete(key: string): void | Promise<void>
   *
   * @type {Cache} Required
   */
  cache: Cache;
  /**
   * This is called when no valid value is in cache for given key.
   * Basically what we would do if we wouldn't use a cache.
   *
   * Can be async and must return fresh value or throw.
   *
   * @type {function(): Promise | Value} Required
   */
  getFreshValue: GetFreshValue<Value>;
  /**
   * Time To Live; often also referred to as max age.
   *
   * Amount of milliseconds the value should stay in cache
   * before we get a fresh one
   *
   * @type {number} Optional (Default: Infinity) - must be positive, can be infinite
   */
  ttl?: number;
  /**
   * Amount of milliseconds that a value with exceeded ttl is still returned
   * while a fresh value is refreshed in the background
   *
   * @type {number} Optional (Default: 0) - must be positive, can be infinite
   */
  staleWhileRevalidate?: number;
  /**
   * Called for each fresh or cached value to check if it matches the
   * typescript type.
   *
   * Value considered ok when returns:
   *  - true
   *  - migrate(newValue)
   *  - undefined
   *  - null
   *
   * Value considered bad when:
   *  - returns false
   *  - returns reason as string
   *  - throws
   *
   * @type {function(): boolean | undefined | string | MigratedValue} Optional, default makes no value check
   */
  checkValue?: (
    value: unknown,
    migrate: (value: Value) => MigratedValue<Value>,
  ) => ValueCheckResult<Value> | Promise<ValueCheckResult<Value>>;
  /**
   * Set true to not even try reading the currently cached value
   *
   * Will write new value to cache even when cached value is
   * still valid.
   *
   * @type {boolean} Optional (Default: false)
   */
  forceFresh?: boolean;
  /**
   * Weather of not to fall back to cache when getting a forced fresh value
   * fails.
   *
   * Can also be the maximum age in milliseconds that a fallback value might
   * have
   *
   * @type {boolean | number} Optional (Default: Infinity) - number must be positive
   */
  fallbackToCache?: boolean | number;
  /**
   * Amount of time in milliseconds before revalidation of a stale
   * cache entry is started
   *
   * @type {number} Optional (Default: 0) - must be positive and finite
   */
  staleRefreshTimeout?: number;
  /**
   * A reporter receives events during the runtime of
   * cachified and can be used for debugging and monitoring
   *
   * @type {(context) => (event) => void} Optional, defaults to no reporting
   */
  reporter?: CreateReporter<Value>;
}

export interface Context<Value>
  extends Omit<
    Required<CachifiedOptions<Value>>,
    'fallbackToCache' | 'reporter'
  > {
  report: Reporter<Value>;
  fallbackToCache: number;
  metadata: CacheMetadata;
}

export function createContext<Value>({
  fallbackToCache,
  reporter,
  ...options
}: CachifiedOptions<Value>): Context<Value> {
  const ttl = options.ttl ?? Infinity;
  const staleWhileRevalidate = options.staleWhileRevalidate ?? 0;
  const contextWithoutReport = {
    checkValue: () => true,
    ttl,
    staleWhileRevalidate,
    fallbackToCache:
      fallbackToCache === false
        ? 0
        : fallbackToCache === true || fallbackToCache === undefined
        ? Infinity
        : fallbackToCache,
    staleRefreshTimeout: 0,
    forceFresh: false,
    ...options,
    metadata: {
      ttl: ttl === Infinity ? null : ttl,
      swr: staleWhileRevalidate === Infinity ? null : staleWhileRevalidate,
      createdTime: Date.now(),
    },
  };

  const report =
    reporter?.(contextWithoutReport) ||
    (() => {
      /* ¯\_(ツ)_/¯ */
    });

  return {
    ...contextWithoutReport,
    report,
  };
}

export function staleWhileRevalidate(metadata: CacheMetadata): number | null {
  return (
    (typeof metadata.swr === 'undefined' ? metadata.swv : metadata.swr) || null
  );
}

export function totalTtl(metadata?: CacheMetadata): number {
  if (!metadata) {
    return 0;
  }
  if (metadata.ttl === null) {
    return Infinity;
  }
  return (metadata.ttl || 0) + (staleWhileRevalidate(metadata) || 0);
}
