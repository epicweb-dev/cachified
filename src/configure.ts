import { cachified } from './cachified';
import { CachifiedOptions, CachifiedOptionsWithSchema } from './common';
import { CreateReporter, mergeReporters } from './reporter';

type PartialOptions<
  Options extends CachifiedOptions<any>,
  OptionalKeys extends string | number | symbol,
> = Omit<Options, OptionalKeys> &
  Partial<Pick<Options, Extract<OptionalKeys, keyof Options>>>;

/**
 * create a pre-configured version of cachified
 */
export function configure<
  ConfigureValue extends unknown,
  Opts extends Partial<CachifiedOptions<ConfigureValue>>,
>(defaultOptions: Opts, defaultReporter?: CreateReporter<ConfigureValue>) {
  function configuredCachified<Value, InternalValue>(
    options: PartialOptions<
      CachifiedOptionsWithSchema<Value, InternalValue>,
      keyof Opts
    >,
    reporter?: CreateReporter<Value>,
  ): Promise<Value>;
  async function configuredCachified<Value>(
    options: PartialOptions<CachifiedOptions<Value>, keyof Opts>,
    reporter?: CreateReporter<Value>,
  ): Promise<Value>;
  function configuredCachified<Value>(
    options: PartialOptions<CachifiedOptions<Value>, keyof Opts>,
    reporter?: CreateReporter<Value>,
  ) {
    return cachified(
      {
        ...defaultOptions,
        ...options,
      } as any as CachifiedOptions<Value>,
      mergeReporters(defaultReporter as any as CreateReporter<Value>, reporter),
    );
  }

  return configuredCachified;
}
