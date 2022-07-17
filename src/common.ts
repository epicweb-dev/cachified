import { CreateReporter } from './reporter';

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
  name: string;
  get: (key: string) => Eventually<{
    metadata: CacheMetadata;
    value: Value;
  }>;
  set: (key: string, value: CacheEntry<Value>) => unknown | Promise<unknown>;
  del: (key: string) => unknown | Promise<unknown>;
}

export const HANDLE = Symbol();
export type GetFreshValue<Value> = {
  (): Promise<Value> | Value;
  [HANDLE]?: () => void;
};

export interface CachifiedOptions<Value, CacheImpl extends Cache<Value>> {
  key: string;
  cache: CacheImpl;
  getFreshValue: GetFreshValue<Value>;
  checkValue?: (value: unknown) => boolean | string;
  forceFresh?: boolean;
  fallbackToCache?: boolean;
  reporter?: CreateReporter<Value>;
  ttl?: number;
  staleWhileRevalidate?: number;
  staleRefreshTimeout?: number;
}
