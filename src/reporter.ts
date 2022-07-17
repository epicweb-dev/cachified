import { CacheMetadata, CachifiedOptions } from './common';

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
export type GetFreshValueCacheFallbackEvent<Value> = {
  name: 'getFreshValueCacheFallback';
  value: Value;
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
export type GetCachedValueOutdatedEvent<Value> = {
  name: 'getCachedValueOutdated';
  value: Value;
  metadata: CacheMetadata;
};
export type GetCachedValueSuccessEvent<Value> = {
  name: 'getCachedValueSuccess';
  value: Value;
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
  | GetFreshValueCacheFallbackEvent<Value>
  | CheckFreshValueErrorEvent<Value>
  | WriteFreshValueSuccessEvent<Value>
  | WriteFreshValueErrorEvent
  | GetCachedValueStartEvent
  | GetCachedValueReadEvent
  | GetCachedValueEmptyEvent
  | GetCachedValueOutdatedEvent<Value>
  | GetCachedValueSuccessEvent<Value>
  | CheckCachedValueErrorEvent
  | GetCachedValueErrorEvent
  | RefreshValueStartEvent
  | RefreshValueSuccessEvent<Value>
  | RefreshValueErrorEvent;

export type Reporter<Value> = (event: CacheEvent<Value>) => void;

export type CreateReporter<Value> = (
  options: Required<CachifiedOptions<Value>>,
  metadata: CacheMetadata,
) => Reporter<Value>;
