import { Cache, CacheEntry, totalTtl } from './common';

export interface LRUishCache extends Omit<Cache, 'set'> {
  set(
    key: string,
    value: CacheEntry<unknown>,
    options?: { ttl?: number; start?: number },
  ): void;
}

export function lruCacheAdapter(lruCache: LRUishCache): Cache {
  return {
    name: lruCache.name || 'LRU',
    set(key, value) {
      const ttl = totalTtl(value?.metadata);
      return lruCache.set(key, value, {
        ttl: ttl === Infinity ? undefined : ttl,
        start: value?.metadata?.createdTime,
      });
    },
    get(key) {
      return lruCache.get(key);
    },
    delete(key) {
      return lruCache.delete(key);
    },
  };
}

interface Redis3Multi {
  set(key: string, value: string): Redis3Multi;
  expireat(key: string, timestamp: number): Redis3Multi;
  exec(cb: (err: Error | null, replies: (number | 'OK')[]) => void): unknown;
}
export interface Redis3LikeCache {
  name?: string;
  set(
    key: string,
    value: string,
    cb: (err: Error | null, reply: 'OK') => void,
  ): unknown;
  get(
    key: string,
    cb?: (err: Error | null, reply: string | null) => void,
  ): unknown;
  del(key: string, cb?: (err: Error | null, reply: number) => void): unknown;
  multi(): Redis3Multi;
}

export function redis3CacheAdapter(redisCache: Redis3LikeCache): Cache {
  return {
    name: redisCache.name || 'Redis3',
    set(key, value) {
      return new Promise<void>((res, rej) => {
        const ttl = totalTtl(value?.metadata);
        const createdTime = value?.metadata?.createdTime;
        const cb = (err: unknown) => {
          if (err) {
            return rej(err);
          }
          res();
        };

        if (ttl > 0 && ttl < Infinity && typeof createdTime === 'number') {
          redisCache
            .multi()
            .set(key, JSON.stringify(value))
            .expireat(key, (ttl + createdTime) / 1000)
            .exec(cb);
        } else {
          redisCache.set(key, JSON.stringify(value), cb);
        }
      });
    },
    get(key) {
      return new Promise<CacheEntry | null | undefined>((res, rej) => {
        redisCache.get(key, (err, reply) => {
          if (err) {
            rej(err);
          } else if (reply == null) {
            res(null);
          } else {
            try {
              res(JSON.parse(reply));
            } catch (err) {
              rej(err);
            }
          }
        });
      });
    },
    delete(key) {
      return new Promise<void>((res, rej) => {
        redisCache.del(key, (err) => {
          if (err) {
            rej(err);
          }
          res();
        });
      });
    },
  };
}

export interface RedisLikeCache {
  name?: string;
  set(
    key: string,
    value: string,
    options?: { EXAT: number },
  ): Promise<string | null>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
}

export function redisCacheAdapter(redisCache: RedisLikeCache): Cache {
  return {
    name: redisCache.name || 'Redis',
    set(key, value) {
      const ttl = totalTtl(value?.metadata);
      const createdTime = value?.metadata?.createdTime;

      return redisCache.set(
        key,
        JSON.stringify(value),
        ttl > 0 && ttl < Infinity && typeof createdTime === 'number'
          ? {
              EXAT: (ttl + createdTime) / 1000,
            }
          : undefined,
      );
    },
    async get(key) {
      const value = await redisCache.get(key);
      if (value == null) {
        return null;
      }
      return JSON.parse(value);
    },
    delete(key) {
      return redisCache.del(key);
    },
  };
}
