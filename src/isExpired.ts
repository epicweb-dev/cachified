import { CacheMetadata, staleWhileRevalidate } from './common';

/**
 * Check wether a cache entry is expired.
 *
 * @returns
 *   - `true` when the cache entry is expired
 *   - `false` when it's still valid
 *   - `"stale"` when it's within the stale period
 */
export function isExpired(metadata: CacheMetadata): boolean | 'stale' {
  /* No TTL means the cache is permanent / never expires */
  if (metadata.ttl === null) {
    return false;
  }

  const validUntil = metadata.createdTime + (metadata.ttl || 0);
  const staleUntil = validUntil + (staleWhileRevalidate(metadata) || 0);
  const now = Date.now();

  /* We're still within the ttl period */
  if (now <= validUntil) {
    return false;
  }
  /* We're within the stale period */
  if (now <= staleUntil) {
    return 'stale';
  }

  /* Expired */
  return true;
}

/**
 * @deprecated prefer using `isExpired` instead
 */
export function shouldRefresh(
  metadata: CacheMetadata,
): 'now' | 'stale' | false {
  const expired = isExpired(metadata);

  if (expired === true) {
    return 'now';
  }

  return expired;
}
