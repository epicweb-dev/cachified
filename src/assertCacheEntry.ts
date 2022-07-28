import type { CacheMetadata } from './common';

export function assertCacheEntry(
  entry: unknown,
  key?: string,
): asserts entry is {
  metadata: CacheMetadata;
  value: unknown;
} {
  if (!isRecord(entry)) {
    throw new Error(
      `Cache entry ${
        key ? `for ${key} ` : ''
      }is not a cache entry object, it's a ${typeof entry}`,
    );
  }
  if (
    !isRecord(entry.metadata) ||
    typeof entry.metadata.createdTime !== 'number' ||
    (entry.metadata.ttl != null && typeof entry.metadata.ttl !== 'number') ||
    (entry.metadata.swr != null && typeof entry.metadata.swr !== 'number')
  ) {
    throw new Error(
      `Cache entry ${
        key ? `for ${key} ` : ''
      }does not have valid metadata property`,
    );
  }

  if (!('value' in entry)) {
    throw new Error(
      `Cache entry for ${
        key ? `for ${key} ` : ''
      }does not have a value property`,
    );
  }
}

function isRecord(entry: unknown): entry is Record<string, unknown> {
  return typeof entry === 'object' && entry !== null && !Array.isArray(entry);
}
