# cachified

[![🚀 Publish](https://github.com/Xiphe/cachified/actions/workflows/release.yml/badge.svg)](https://github.com/Xiphe/cachified/actions/workflows/release.yml)
[![codecov](https://codecov.io/gh/Xiphe/cachified/branch/main/graph/badge.svg?token=GDN0OD10IO)](https://codecov.io/gh/Xiphe/cachified)
[![no dependencies](https://img.shields.io/badge/dependencies-none-brightgreen)](https://github.com/Xiphe/cachified/search?q=dependencies&type=code)
[![npm](https://img.shields.io/npm/v/cachified)](https://www.npmjs.com/package/cachified)  
[![semantic-release: angular](https://img.shields.io/badge/semantic--release-angular-e10079?logo=semantic-release)](https://github.com/semantic-release/semantic-release)
[![Love and Peace](http://love-and-peace.github.io/love-and-peace/badges/base/v1.0.svg)](https://github.com/love-and-peace/love-and-peace/blob/master/versions/base/v1.0/en.md)

#### 🧙 One API to cache them all

wrap virtually everything that can store by key to act as cache with ttl/max-age, stale-while-validate, parallel fetch protection and type-safety support

> 🤔 Idea and 💻 [initial implementation](https://github.com/kentcdodds/kentcdodds.com/blob/3efd0d3a07974ece0ee64d665f5e2159a97585df/app/utils/cache.server.ts) by [@kentcdodds](https://github.com/kentcdodds) 👏💜

## Install

```sh
npm install cachified
# yarn add cachified
```

## Usage

```ts
import type { CacheEntry } from 'cachified';
import LRUCache from 'lru-cache';
import { cachified } from 'cachified';

// lru cache is not part of this package but a simple non-persistent cache
const lru = new LRUCache<string, CacheEntry<string>>({ max: 1000 });

function getUserById({ userId }: { userId: string }): Promise<User> {
  return cachified({
    key: `users_${userId}`,
    cache: lru,
    async getFreshValue() {
      const response = await fetch(`https://jsonplaceholder.typicode.com/users/${userId}`);
      return response.json();
    },
    // 5 minutes until cache gets invalid
    // Optional, defaults to Infinity
    ttl: 300_000,
  });
}

// Let's get through some calls of `getUserById`:

const user = await getUserById('1');
console.log(user);
// > logs the user with ID 1
// Cache was empty, `getFreshValue` got invoked to generate a pi-ish number
// that is now cached for 5 minutes

// 2 minutes later
const user = await getUserById('1');
console.log(user);
// Cache was filled an valid. `getFreshValue` was not invoked, previous number
// is returned

// 10 minutes later
const user = await getUserById('1');
// > logs the user with ID 1
// Cache timed out, `getFreshValue` got invoked to fetch a fresh copy of the user
// that now replaces current cache entry and is cached for 5 minutes
```

## Options

```ts
interface CachifiedOptions<Value> {
  /**
   * Required
   *
   * The key this value is cached by
   * Must be unique for each value
   */
  key: string;
  /**
   * Required
   *
   * Cache implementation to use
   *
   * Must conform with signature
   *  - set(key: string, value: object): void | Promise<void>
   *  - get(key: string): object | Promise<object>
   *  - delete(key: string): void | Promise<void>
   */
  cache: Cache;
  /**
   * Required
   *
   * Function that is called when no valid value is in cache for given key
   * Basically what we would do if we wouldn't use a cache
   *
   * Can be async and must return fresh value or throw
   *
   * receives context object as argument
   *  - context.metadata.ttl?: number
   *  - context.metadata.swr?: number
   *  - context.metadata.createdTime: number
   *  - context.background: boolean
   */
  getFreshValue: GetFreshValue<Value>;
  /**
   * Time To Live; often also referred to as max age
   *
   * Amount of milliseconds the value should stay in cache
   * before we get a fresh one
   *
   * Setting any negative value will disable caching
   * Can be infinite
   *
   * Default: `Infinity`
   */
  ttl?: number;
  /**
   * Amount of milliseconds that a value with exceeded ttl is still returned
   * while a fresh value is refreshed in the background
   *
   * Should be positive, can be infinite
   *
   * Default: `0`
   */
  staleWhileRevalidate?: number;
  /**
   * Validator that checks every cached and fresh value to ensure type safety
   *
   * Can be a zod schema or a custom validator function
   *
   * Value considered ok when:
   *  - zod schema.parseAsync succeeds
   *  - validator returns
   *    - true
   *    - migrate(newValue)
   *    - undefined
   *    - null
   *
   * Value considered bad when:
   *  - zod schema.parseAsync throws
   *  - validator:
   *    - returns false
   *    - returns reason as string
   *    - throws
   *
   * A validator function receives two arguments:
   *  1. the value
   *  2. a migrate callback, see https://github.com/Xiphe/cachified#migrating-values
   *
   * Default: `undefined` - no validation
   */
  checkValue?: CheckValue<Value> | Schema<Value, unknown>;
  /**
   * Set true to not even try reading the currently cached value
   *
   * Will write new value to cache even when cached value is
   * still valid.
   *
   * Default: `false`
   */
  forceFresh?: boolean;
  /**
   * Weather of not to fall back to cache when getting a forced fresh value
   * fails
   *
   * Can also be a positive number as the maximum age in milliseconds that a
   * fallback value might have
   *
   * Default: `Infinity`
   */
  fallbackToCache?: boolean | number;
  /**
   * Amount of time in milliseconds before revalidation of a stale
   * cache entry is started
   *
   * Must be positive and finite
   *
   * Default: `0`
   */
  staleRefreshTimeout?: number;
  /**
   * A reporter receives events during the runtime of
   * cachified and can be used for debugging and monitoring
   *
   * Default: `undefined` - no reporting
   */
  reporter?: CreateReporter<Value>;
}
```

## Adapters

There are some build-in adapters for common caches, using them makes sure
the used caches cleanup outdated values themselves.

### Adapter for [lru-cache](https://www.npmjs.com/package/lru-cache)

```ts
import LRUCache from 'lru-cache';
import { cachified, lruCacheAdapter } from 'cachified';

const lru = new LRUCache<string, CacheEntry<string>>({ max: 1000 });
const cache = lruCacheAdapter(lru);

function getPi() {
  return cachified({
    cache,
    /* ...{ key, getFreshValue } */
  });
}
```

### Adapter for [redis](https://www.npmjs.com/package/redis)

```ts
import { createClient } from 'redis';
import { cachified, redisCacheAdapter } from 'cachified';

const redis = createClient({ /* ...opts */ });
const cache = redisCacheAdapter(redis);

function getPi() {
  return cachified({
    cache,
    /* ...{ key, getFreshValue } */
  });
}
```

### Adapter for [redis@3](https://www.npmjs.com/package/redis/v/3.1.2)

```ts
import { createClient } from 'redis';
import { cachified, redis3CacheAdapter } from 'cachified';

const redis = createClient({ /* ...opts */ });
const cache = redis3CacheAdapter(redis);

function getPi() {
  return cachified({
    cache,
    /* ...{ key, getFreshValue } */
  });
}
```

## Advanced Usage

### Stale while revalidate

Specify a time window in which a cached value is returned even though
it's ttl is exceeded while the cache is updated in the background for the next
call.

```ts
import { cachified } from 'cachified';

function getPi() {
  return cachified({
    /* ...{ cache, key, getFreshValue } */
    ttl: 1000 * 60 /* One minute */,
    staleWhileRevalidate: 1000 * 60 * 5 /* Five minutes */,
  });
}
```

- **First Call**:  
  Cache is empty, `getFreshValue` gets invoked and and its value returned and cached
- **Second Call after 30 seconds**:  
  Cache is filled an valid. `getFreshValue` is not invoked, cached value is returned
- **Third Call after 4 minutes**:  
  Cache timed out but stale while revalidate is not exceeded,
  cached value is returned immediately, `getFreshValue` gets invoked in the
  background and its value is cached
- **Fourth Call after 4.5 minutes**:  
  Cache is filled an valid. `getFreshValue` is not invoked, refreshed value is returned

### Forcing fresh values and falling back to cache

We can use `forceFresh` to get a fresh value regardless of the values ttl or stale while validate

```ts
import { cachified } from 'cachified';

function getPi() {
  return cachified({
    /* ...{ cache, key, getFreshValue } */

    forceFresh: Boolean(user.isAdmin),
    /* when getting a forced fresh value fails we fall back to cached value
       as long as it's not older then one hour */
    fallbackToCache: 1000 * 60 * 60 /* one hour, defaults to Infinity */,
  });
}
```

### Type-safety

In practice we can not be entirely sure that values from cache are of the types we assume.
For example other parties could also write to the cache or code is changed while cache
stays the same.

```ts
import type { CacheEntry } from 'cachified';
import LRUCache from 'lru-cache';
import { cachified } from 'cachified';

const lru = new LRUCache<string, CacheEntry<string>>({ max: 1000 });

lru.set('pi', { value: 'Invalid', metadata: { createdAt: Date.now() } });
function getPi() {
  return cachified({
    /* ...{ getFreshValue } */
    key: 'pi',
    cache: lru,
    checkValue(value: unknown) {
      if (typeof value !== 'number') {
        return 'Value must be a number';
      } else if (!String(value).startsWith('3.14159')) {
        return 'Value is not actually pi-ish';
      }
    },
  });
}
```

- **First Call**:  
  Cache is not empty but value is invalid, `getFreshValue` gets invoked and and its value returned and cached
- **Second Call**:  
  Cache is filled an valid. `getFreshValue` is not invoked, cached value is returned

> ℹ️ `checkValue` is also invoked with the return value of `getFreshValue`

### Type-safety with [zod](https://github.com/colinhacks/zod)

We can also use zod schemas to ensure correct types

```ts
import type { CacheEntry } from 'cachified';
import LRUCache from 'lru-cache';
import { cachified } from 'cachified';
import z from 'zod';

const lru = new LRUCache<string, CacheEntry<string>>({ max: 1000 });
const userId = 1;

const user = await cachified({
  key: `user-${userId}`,
  cache: lru,
  checkValue: z.object({
    email: z.string()
  }),
  getFreshValue() {
    return getUserFromApi(userId)
  }
});
```

### Migrating Values

When the format of cached values is changed during the apps lifetime they can
be migrated on read like this:

```ts
import type { CacheEntry } from 'cachified';
import LRUCache from 'lru-cache';
import { cachified } from 'cachified';

const lru = new LRUCache<string, CacheEntry<string>>({ max: 1000 });
/* Let's assume we've previously stored values as string */
lru.set('pi', { value: '3.14', metadata: { createdAt: Date.now() } });

function getPi() {
  return cachified({
    /* ...{ getFreshValue } */
    key: 'pi',
    cache: lru,
    checkValue(value, migrate) {
      if (typeof value === 'string' && value.startsWith('3.14')) {
        return migrate(parseFloat(value));
      }
      /* other validations... */
    },
  });
}
```

- **First Call**:  
  Cache is not empty but value can be migrated, `3.14` is returned and cached value is updated,
  `getFreshValue` is not invoked
- **Second Call**:  
  Cache is filled an valid. `getFreshValue` is not invoked, cached value is returned

### Fine-tuning cache metadata based on fresh values

There are scenarios where we want to change the cache time based on the fresh
value (ref [#25](https://github.com/Xiphe/cachified/issues/25)). 
For example when an API might either provide our data or `null` and in case we
get an empty result we want to retry the API much faster.

```ts
import { cachified } from './src/index';

const value: null | string = await cachified({
  /* ...{ cache, key, ... } */

  ttl: 60_000 /* Default cache of one minute... */,
  getFreshValue(context) {
    const valueFromApi: string | null = getValue();

    if (valueFromApi === null) {
      /* On an empty result, prevent caching */
      context.metadata.ttl = -1;
    }

    return valueFromApi;
  },
});
```

### Batch requesting values

In case multiple values can be requested in a batch action, but it's not
clear which values are currently in cache we can use the `createBatch` helper

```ts
import type { CacheEntry } from 'cachified';
import LRUCache from 'lru-cache';
import { cachified, createBatch } from 'cachified';

const lru = new LRUCache<string, CacheEntry<string>>({ max: 1000 });

function getEntries(ids: number[]): Promise<(string | null)[]> {
  const batch = createBatch(getFreshValues);

  return Promise.all(
    ids.map((id) =>
      cachified({
        key: `entry-${id}`,
        cache: lru,
        ttl: 60_000,
        getFreshValue: batch.add(
          id,
          /* onValue callback is optional but can be used to manipulate
           * cache metadata based on the received value. (see section above) */
          ({ value, ...context }) => {},
        ),
      }),
    ),
  );
}

async function getFreshValues(idsThatAreNotInCache: number[]) {
  const res = await fetch(
    `https://example.org/api?ids=${idsThatAreNotInCache.join(',')}`,
  );
  const data = await res.json();

  // Validate data here...

  return data;
}
```

- **First Call with getEntries([1, 2])**:  
  Caches for `entry-1` and `entry-2` are empty. `getFreshValues` is invoked with `[1, 2]`,
  its return values cached separately and returned
- **Second Call with getEntries([2, 3])**:  
  Cache for `entry-2` is valid but `entry-3` is empty. `getFreshValues` is invoked with `[3]`
  and its return value cached. cachified returns with one value from cache and one fresh value

### Reporting

A reporter might be passed to cachified to log caching events, we ship a reporter
resembling the logging from [Kents implementation](https://github.com/kentcdodds/kentcdodds.com/blob/3efd0d3a07974ece0ee64d665f5e2159a97585df/app/utils/cache.server.ts)

```ts
import { cachified, verboseReporter } from 'cachified';

function getPi() {
  return cachified({
    /* ...{ cache, key, getFreshValue } */
    reporter: verboseReporter(),
  });
}
```

please refer to [the implementation of `verboseReporter`](https://github.com/Xiphe/cachified/blob/main/src/reporter.ts#L125) when you want to implement a custom reporter.
