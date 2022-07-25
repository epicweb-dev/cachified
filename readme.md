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

function getPi(): Promise<number> {
  return cachified({
    key: 'pi',
    cache: lru,
    async getFreshValue() {
      let pi = 0;
      while (!String(pi).startsWith('3.14159')) {
        pi = Math.random() * 10;
      }
      return pi;
    },
    /* ~5 minutes until cache gets invalid
       Optional, defaults to Infinity */,
    ttl: 314_159

    /* Other optional options */
  });
}
```

Let's get through some calls of `getPi`:

- **First Call**:
  Cache is empty, `getFreshValue` gets invoked to generate a pi-ish number that is
  cached and returned
- **Second Call after 2 minutes**:
  Cache is filled an valid. `getFreshValue` is not invoked, previous number is returned
- **Third Call after 10 minutes**:
  Cache timed out, `getFreshValue` gets invoked to generate a new pi-ish number that
  replaces current cache entry and is returned

## Options

```ts
interface CachifiedOptions<Value> {
  /**
   * The key this value is cached by
   *
   * @type {string} Required
   */
  key: string;
  /**
   * Cache implementation to use
   *
   * Must conform with signature
   *  - set(key: string, value: object): void | Promise<void>
   *  - get(key: string): object | Promise<object>
   *  - delete(key: string): void | Promise<void>
   *
   * @type {Cache} Required
   */
  cache: Cache<Value>;
  /**
   * This is called when no valid value is in cache for given key.
   * Basically what we would do if we wouldn't use a cache.
   *
   * Can be async and must return fresh value or throw.
   *
   * @type {function(): Promise | Value} Required
   */
  getFreshValue: GetFreshValue<Value>;
  /**
   * Time To Live; often also referred to as max age.
   *
   * Amount of milliseconds the value should stay in cache
   * before we get a fresh one
   *
   * @type {number} Optional (Default: Infinity) - must be positive, can be infinite
   */
  ttl?: number;
  /**
   * Amount of milliseconds that a value with exceeded ttl is still returned
   * while a fresh value is refreshed in the background
   *
   * @type {number} Optional (Default: 0) - must be positive, can be infinite
   */
  staleWhileRevalidate?: number;
  /**
   * Called for each fresh or cached value to check if it matches the
   * typescript type.
   *
   * Value considered ok when returns:
   *  - true
   *  - migrate(newValue)
   *  - undefined
   *  - null
   *
   * Value considered bad when:
   *  - returns false
   *  - returns reason as string
   *  - throws
   *
   * @type {function(): boolean | undefined | string | MigratedValue} Optional, default makes no value check
   */
  checkValue?: (
    value: unknown,
    migrate: (value: Value) => MigratedValue<Value>,
  ) => ValueCheckResult<Value> | Promise<ValueCheckResult<Value>>;
  /**
   * Set true to not even try reading the currently cached value
   *
   * Will write new value to cache even when cached value is
   * still valid.
   *
   * @type {boolean} Optional (Default: false)
   */
  forceFresh?: boolean;
  /**
   * Weather of not to fall back to cache when getting a forced fresh value
   * fails.
   *
   * Can also be the maximum age in milliseconds that a fallback value might
   * have
   *
   * @type {boolean | number} Optional (Default: Infinity) - number must be positive
   */
  fallbackToCache?: boolean | number;
  /**
   * Amount of time in milliseconds before revalidation of a stale
   * cache entry is started
   *
   * @type {number} Optional (Default: 0) - must be positive and finite
   */
  staleRefreshTimeout?: number;
  /**
   * A reporter receives events during the runtime of
   * cachified and can be used for debugging and monitoring
   *
   * @type {(context) => (event) => void} Optional, defaults to no reporting
   */
  reporter?: CreateReporter<Value>;
}
```

## Advanced Usage

### Stale while revalidate

Specify a time window in which a cached value is returned even though
it's ttl is exceeded while the cache is updated in the background for the next
call.

```ts
import { cachified } from 'cachified';

const value = await cachified({
  /* ...{ cache, key, getFreshValue } */
  ttl: 1000 * 60 /* One minute */,
  staleWhileRevalidate: 1000 * 60 * 5 /* Five minutes */,
});
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
