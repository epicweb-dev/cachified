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

export interface Cache<Value = any> {
  name?: string;
  get: (key: string) => Eventually<CacheEntry<Value>>;
  set: (key: string, value: CacheEntry<Value>) => unknown | Promise<unknown>;
  delete: (key: string) => unknown | Promise<unknown>;
}

export interface GetFreshValueContext {
  readonly metadata: CacheMetadata;
  readonly background: boolean;
}
export const HANDLE = Symbol();
export type GetFreshValue<Value> = {
  (context: GetFreshValueContext): Promise<Value> | Value;
  [HANDLE]?: () => void;
};
export const MIGRATED = Symbol();
export type MigratedValue<Value> = {
  [MIGRATED]: boolean;
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
export type CheckValue<Value> = (
  value: unknown,
  migrate: (value: Value, updateCache?: boolean) => MigratedValue<Value>,
) => ValueCheckResult<Value> | Promise<ValueCheckResult<Value>>;
export interface Schema<Value, InputValue> {
  _input: InputValue;
  parseAsync(value: unknown): Promise<Value>;
}

export interface CachifiedOptions<Value> {
  /**
   * Required
   *
   * The key this value is cached by
   * Must be unique for each value
   */
  key: string;
  /**
   * Required
   *
   * Cache implementation to use
   *
   * Must conform with signature
   *  - set(key: string, value: object): void | Promise<void>
   *  - get(key: string): object | Promise<object>
   *  - delete(key: string): void | Promise<void>
   */
  cache: Cache;
  /**
   * Required
   *
   * Function that is called when no valid value is in cache for given key
   * Basically what we would do if we wouldn't use a cache
   *
   * Can be async and must return fresh value or throw
   *
   * receives context object as argument
   *  - context.metadata.ttl?: number
   *  - context.metadata.swr?: number
   *  - context.metadata.createdTime: number
   *  - context.background: boolean
   */
  getFreshValue: GetFreshValue<Value>;
  /**
   * Time To Live; often also referred to as max age
   *
   * Amount of milliseconds the value should stay in cache
   * before we get a fresh one
   *
   * Setting any negative value will disable caching
   * Can be infinite
   *
   * Default: `Infinity`
   */
  ttl?: number;
  /**
   * Amount of milliseconds that a value with exceeded ttl is still returned
   * while a fresh value is refreshed in the background
   *
   * Should be positive, can be infinite
   *
   * Default: `0`
   */
  staleWhileRevalidate?: number;
  /**
   * Alias for staleWhileRevalidate
   */
  swr?: number;
  /**
   * Validator that checks every cached and fresh value to ensure type safety
   *
   * Can be a zod schema or a custom validator function
   *
   * Value considered ok when:
   *  - zod schema.parseAsync succeeds
   *  - validator returns
   *    - true
   *    - migrate(newValue)
   *    - undefined
   *    - null
   *
   * Value considered bad when:
   *  - zod schema.parseAsync throws
   *  - validator:
   *    - returns false
   *    - returns reason as string
   *    - throws
   *
   * A validator function receives two arguments:
   *  1. the value
   *  2. a migrate callback, see https://github.com/Xiphe/cachified#migrating-values
   *
   * Default: `undefined` - no validation
   */
  checkValue?: CheckValue<Value> | Schema<Value, unknown>;
  /**
   * Set true to not even try reading the currently cached value
   *
   * Will write new value to cache even when cached value is
   * still valid.
   *
   * Default: `false`
   */
  forceFresh?: boolean;
  /**
   * Whether or not to fall back to cache when getting a forced fresh value
   * fails
   *
   * Can also be a positive number as the maximum age in milliseconds that a
   * fallback value might have
   *
   * Default: `Infinity`
   */
  fallbackToCache?: boolean | number;
  /**
   * Amount of time in milliseconds before revalidation of a stale
   * cache entry is started
   *
   * Must be positive and finite
   *
   * Default: `0`
   */
  staleRefreshTimeout?: number;
  /**
   * @deprecated pass reporter as second argument to cachified
   */
  reporter?: never;
}

/* When using a schema validator, a strongly typed getFreshValue is not required
   and sometimes even sub-optimal */
export type CachifiedOptionsWithSchema<Value, InternalValue> = Omit<
  CachifiedOptions<Value>,
  'checkValue' | 'getFreshValue'
> & {
  checkValue: Schema<Value, InternalValue>;
  getFreshValue: GetFreshValue<InternalValue>;
};

export interface Context<Value>
  extends Omit<
    Required<CachifiedOptions<Value>>,
    'fallbackToCache' | 'reporter' | 'checkValue' | 'swr'
  > {
  checkValue: CheckValue<Value>;
  report: Reporter<Value>;
  fallbackToCache: number;
  metadata: CacheMetadata;
}

export function createContext<Value>(
  { fallbackToCache, checkValue, ...options }: CachifiedOptions<Value>,
  reporter?: CreateReporter<Value>,
): Context<Value> {
  const ttl = options.ttl ?? Infinity;
  const staleWhileRevalidate = options.swr ?? options.staleWhileRevalidate ?? 0;
  const checkValueCompat: CheckValue<Value> =
    typeof checkValue === 'function'
      ? checkValue
      : typeof checkValue === 'object'
      ? (value, migrate) =>
          checkValue.parseAsync(value).then((v) => migrate(v, false))
      : () => true;

  const contextWithoutReport = {
    checkValue: checkValueCompat,
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
    metadata: createCacheMetaData({ ttl, swr: staleWhileRevalidate }),
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

export function createCacheMetaData({
  ttl = null,
  swr = 0,
  createdTime = Date.now(),
}: Partial<Omit<CacheMetadata, 'swv'>> = {}) {
  return {
    ttl: ttl === Infinity ? null : ttl,
    swr: swr === Infinity ? null : swr,
    createdTime,
  };
}

export function createCacheEntry<Value>(
  value: Value,
  metadata?: Partial<Omit<CacheMetadata, 'swv'>>,
): CacheEntry<Value> {
  return {
    value,
    metadata: createCacheMetaData(metadata),
  };
}
