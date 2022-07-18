# cachified

[![🚀 Publish](https://github.com/Xiphe/cachified/actions/workflows/release.yml/badge.svg)](https://github.com/Xiphe/cachified/actions/workflows/release.yml)
[![codecov](https://codecov.io/gh/Xiphe/cachified/branch/main/graph/badge.svg?token=GDN0OD10IO)](https://codecov.io/gh/Xiphe/cachified)
[![semantic-release: angular](https://img.shields.io/badge/semantic--release-angular-e10079?logo=semantic-release)](https://github.com/semantic-release/semantic-release)
[![Love and Peace](http://love-and-peace.github.io/love-and-peace/badges/base/v1.0.svg)](https://github.com/love-and-peace/love-and-peace/blob/master/versions/base/v1.0/en.md)
[![no dependencies](https://img.shields.io/badge/dependencies-none-brightgreen)](https://github.com/Xiphe/cachified/search?q=dependencies&type=code)
[![npm](https://img.shields.io/npm/v/cachified)](https://www.npmjs.com/package/cachified)

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

const value = await cachified({
  cache: lru,
  key: 'cache-key-for-this-value',
  async getFreshValue() {
    return /* call to really complex stuff here */ 'pi';
  },
  /* Other options */
});
```

## Options

```ts
export interface CachifiedOptions<Value> {
  /**
   * The key this value is cached by
   * @type {string}
   */
  key: string;
  /**
   * Cache implementation to use
   *
   * Must conform with signature
   *  - set(key: string, value: object): void
   *  - get(key: string): object
   *  - delete(key: string): void
   *
   * @type {Cache}
   */
  cache: Cache<Value>;
  /**
   * This is called when no valid value is in cache for given key.
   * Basically what we would do if we wouldn't use a cache.
   *
   * Can be async and must return fresh value or throw.
   *
   * @type {function(): Promise | Value}
   */
  getFreshValue: GetFreshValue<Value>;
  /**
   * Time To Live; often also referred to as max age.
   *
   * Amount of milliseconds the value should stay in cache
   * before we get a fresh one
   *
   * @type {number} Must be positive, can be infinite
   * @defaultValue {Infinity}
   */
  ttl?: number;
  /**
   * Amount of milliseconds that a value with exceeded ttl is still returned
   * while a fresh value is refreshed in the background
   *
   * @type {number} Must be positive, can be infinite
   * @defaultValue {0}
   */
  staleWhileRevalidate?: number;
  /**
   * Called for each fresh or cached value to check if it matches the
   * typescript type.
   *
   * Must return true when value is valid.
   *
   * May return false or the reason (string) why the value is invalid
   *
   * @type {function(): boolean | string}
   * @defaultValue {() => true} each value is considered valid by default
   */
  checkValue?: (value: unknown) => boolean | string;
  /**
   * Set true to not even try reading the currently cached value
   *
   * Will write new value to cache even when cached value is
   * still valid.
   *
   * @type {boolean}
   * @defaultValue {false}
   */
  forceFresh?: boolean;
  /**
   * Weather of not to fall back to cache when getting a forced fresh value
   * fails.
   *
   * Can also be the maximum age in milliseconds that a fallback value might
   * have
   *
   * @type {boolean | number} Number must be positive, can be infinite
   * @defaultValue {Infinity}
   */
  fallbackToCache?: boolean | number;
  /**
   * Amount of time in milliseconds before revalidation of a stale
   * cache entry is started
   *
   * @type {number} must be positive and finite
   * @defaultValue {0}
   */
  staleRefreshTimeout?: number;
  /**
   * A reporter receives events during the runtime of
   * cachified and can be used for debugging and monitoring
   *
   * @type {(context) => (event) => void}
   * @defaultValue {noop}
   */
  reporter?: CreateReporter<Value>;
}
```
