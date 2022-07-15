import type { CacheMetadata } from './common';

export function shouldRefresh(
  metadata: CacheMetadata,
): 'now' | 'stale' | false {
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
