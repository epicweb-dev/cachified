import {
  cachified,
  CacheEntry,
  verboseReporter,
  createCacheEntry,
} from './index';
import { delay, prettyPrint } from './testHelpers';

jest.mock('./index', () => {
  if (process.version.startsWith('v18')) {
    return jest.requireActual('./index');
  } else {
    console.log('⚠️ Running Tests against dist/index.cjs');
    return require('../dist/index.cjs');
  }
});

let currentTime = 0;
beforeEach(() => {
  currentTime = 0;
  jest.spyOn(Date, 'now').mockImplementation(() => currentTime);
});

describe('verbose reporter', () => {
  it('logs when cached value is invalid', async () => {
    const cache = new Map<string, CacheEntry>();
    const logger = createLogger();
    cache.set('test', createCacheEntry('One'));

    await cachified({
      cache,
      key: 'test',
      checkValue: (v) => (v !== 'VALUE' ? '🚔' : true),
      reporter: verboseReporter({ logger, performance: Date }),
      getFreshValue: () => 'VALUE',
    });

    expect(logger.print()).toMatchInlineSnapshot(`
    "WARN: 'check failed for cached value of test
           Reason: 🚔.
           Deleting the cache key and trying to get a fresh value.' {metadata: {createdTime: 0, swr: 0, ttl: null}, value: 'One'}
    LOG: 'Updated the cache value for test.' 'Getting a fresh value for this took 0ms.' 'Caching for forever in Map.'"
    `);
  });

  it('logs when getting a cached value fails', async () => {
    const cache = new Map<string, CacheEntry>();
    const logger = createLogger();
    const getMock = jest.spyOn(cache, 'get');
    getMock.mockImplementationOnce(() => {
      throw new Error('💥');
    });

    await cachified({
      cache,
      key: 'test',
      ttl: 50,
      staleWhileRevalidate: Infinity,
      reporter: verboseReporter({ logger, performance: Date }),
      getFreshValue: () => 'VALUE',
    });

    expect(logger.print()).toMatchInlineSnapshot(`
    "ERROR: 'error with cache at test. Deleting the cache key and trying to get a fresh value.' [Error: 💥]
    LOG: 'Updated the cache value for test.' 'Getting a fresh value for this took 0ms.' 'Caching for forever (revalidation after 50ms) in Map.'"
    `);
  });

  it('logs when getting a fresh value fails', async () => {
    const cache = new Map<string, CacheEntry>();
    const logger = createLogger();

    await cachified({
      cache,
      key: 'test',
      reporter: verboseReporter({ logger, performance: Date }),
      getFreshValue: () => {
        throw new Error('⁇');
      },
    }).catch(() => {
      /* ¯\_(ツ)_/¯ */
    });

    expect(logger.print()).toMatchInlineSnapshot(
      `"ERROR: 'getting a fresh value for test failed' {fallbackToCache: Infinity, forceFresh: false} [Error: ⁇]"`,
    );
  });

  it('logs when fresh value is not written to cache', async () => {
    const cache = new Map<string, CacheEntry>();
    const logger = createLogger();

    await cachified({
      cache,
      key: 'test',
      ttl: 5,
      staleWhileRevalidate: 5,
      reporter: verboseReporter({ logger, performance: Date }),
      getFreshValue: () => {
        currentTime = 20;
        return 'ONE';
      },
    });

    expect(logger.print()).toMatchInlineSnapshot(
      `"LOG: 'Not updating the cache value for test.' 'Getting a fresh value for this took 20ms.' 'Thereby exceeding caching time of 5ms + 5ms stale'"`,
    );
  });

  it('logs when writing to cache fails (using defaults)', async () => {
    const cache = new Map<string, CacheEntry>();
    const errorMock = jest.spyOn(console, 'error').mockImplementation(() => {
      /* 🤫 */
    });
    jest.spyOn(cache, 'set').mockImplementationOnce(() => {
      throw new Error('⚡️');
    });

    await cachified({
      cache,
      key: 'test',
      reporter: verboseReporter(),
      getFreshValue: () => 'ONE',
    });

    expect(errorMock.mock.calls).toMatchInlineSnapshot(`
[
  [
    "error setting cache: test",
    [Error: ⚡️],
  ],
]
`);
  });

  it('falls back to Date when performance is not globally available', async () => {
    const backup = global.performance;
    delete (global as any).performance;
    const cache = new Map<string, CacheEntry>();
    const logger = createLogger();

    await cachified({
      cache,
      key: 'test',
      reporter: verboseReporter({ logger }),
      getFreshValue: () => 'ONE',
    });

    (global as any).performance = backup;
    expect(Date.now).toBeCalledTimes(3);
  });

  it('logs when fresh value does not meet value check', async () => {
    const cache = new Map<string, CacheEntry>();
    const logger = createLogger();

    await cachified({
      cache,
      key: 'test',
      reporter: verboseReporter({ logger, performance: Date }),
      checkValue: () => false,
      getFreshValue: () => 'ONE',
    }).catch(() => {
      /* 🤷 */
    });

    expect(logger.print()).toMatchInlineSnapshot(`
    "ERROR: 'check failed for fresh value of test
            Reason: unknown.' 'ONE'"
    `);
  });

  it('logs when cache is successfully revalidated', async () => {
    const cache = new Map<string, CacheEntry>();
    const logger = createLogger();
    cache.set('test', createCacheEntry('ONE', { ttl: 5, swr: 10 }));
    currentTime = 7;

    await cachified({
      cache,
      key: 'test',
      reporter: verboseReporter({ logger, performance: Date }),
      getFreshValue: () => {
        currentTime = 10;
        return 'TWO';
      },
    });

    await delay(0);
    expect(logger.print()).toMatchInlineSnapshot(
      `"LOG: 'Background refresh for test successful.' 'Getting a fresh value for this took 3ms.' 'Caching for forever in Map.'"`,
    );
  });

  it('logs when cache revalidation fails', async () => {
    const cache = new Map<string, CacheEntry>();
    const logger = createLogger();
    cache.set('test', createCacheEntry('ONE', { ttl: 5, swr: 10 }));
    currentTime = 7;

    await cachified({
      cache,
      key: 'test',
      reporter: verboseReporter({ logger, performance: Date }),
      getFreshValue: () => {
        currentTime = 10;
        throw new Error('🧨');
      },
    });

    await delay(0);
    expect(logger.print()).toMatchInlineSnapshot(
      `"LOG: 'Background refresh for test failed.' [Error: 🧨]"`,
    );
  });
});

function createLogger() {
  const log: string[] = [];

  return {
    log(...args: any[]) {
      log.push(
        args
          .reduce((m, v) => `${m} ${prettyPrint(v)}`, 'LOG:')
          .replace(/\n/g, '\n     '),
      );
    },
    warn(...args: any[]) {
      log.push(
        args
          .reduce((m, v) => `${m} ${prettyPrint(v)}`, 'WARN:')
          .replace(/\n/g, '\n       '),
      );
    },
    error(...args: any[]) {
      log.push(
        args
          .reduce((m, v) => `${m} ${prettyPrint(v)}`, 'ERROR:')
          .replace(/\n/g, '\n        '),
      );
    },
    print() {
      return log.join('\n');
    },
  };
}
