import { logKey } from './assertCacheEntry';
import { createCacheEntry, totalTtl } from './common';

describe('totalTtl helper', () => {
  it('handles metadata without ttl gracefully', () => {
    expect(totalTtl({ createdTime: 0, swr: 5 })).toBe(5);
  });

  it('is infinite when stale while revalidate is infinite', () => {
    expect(
      totalTtl(createCacheEntry('v', { ttl: 5, swr: Infinity }).metadata),
    ).toBe(Infinity);
  });
});

describe('internal logKey helper', () => {
  it('falls back to empty string, when no key given', () => {
    expect(logKey()).toBe('');
  });
});
