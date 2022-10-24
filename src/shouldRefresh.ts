import { CacheMetadata, staleWhileRevalidate } from './common';

export function shouldRefresh(
  metadata: CacheMetadata,
): 'now' | 'stale' | false {
  if (metadata.ttl !== null) {
    const valid = metadata.createdTime + (metadata.ttl || 0);
    const stale = valid + (staleWhileRevalidate(metadata) || 0);
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
