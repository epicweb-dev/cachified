import { logKey } from './assertCacheEntry';
import { totalTtl } from './common';

describe('totalTtl helper', () => {
  it('handles metadata without ttl gracefully', () => {
    expect(totalTtl({ createdTime: 0, swr: 5 })).toBe(5);
  });
});

describe('internal logKey helper', () => {
  it('falls back to empty string, when no key given', () => {
    expect(logKey()).toBe('');
  });
});
