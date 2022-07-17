import type { CreateReporter, Reporter } from './reporter';

export interface CacheMetadata {
  createdTime: number;
  ttl?: number | null;
  swv?: number | null;
}

export interface CacheEntry<Value> {
  metadata: CacheMetadata;
  value: Value;
}

export type Eventually<Value> =
  | Value
  | null
  | undefined
  | Promise<Value | null | undefined>;

export interface Cache<Value> {
  name?: string;
  get: (key: string) => Eventually<{
    metadata: CacheMetadata;
    value: Value;
  }>;
  set: (key: string, value: CacheEntry<Value>) => unknown | Promise<unknown>;
  delete: (key: string) => unknown | Promise<unknown>;
}

export const HANDLE = Symbol();
export type GetFreshValue<Value> = {
  (): Promise<Value> | Value;
  [HANDLE]?: () => void;
};

export interface CachifiedOptions<Value> {
  key: string;
  cache: Cache<Value>;
  getFreshValue: GetFreshValue<Value>;
  checkValue?: (value: unknown) => boolean | string;
  forceFresh?: boolean;
  fallbackToCache?: boolean | number;
  reporter?: CreateReporter<Value>;
  ttl?: number;
  staleWhileRevalidate?: number;
  staleRefreshTimeout?: number;
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
      swv: staleWhileRevalidate === Infinity ? null : staleWhileRevalidate,
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
