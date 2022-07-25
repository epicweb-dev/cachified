import type { GetFreshValue } from './common';
import { HANDLE } from './common';

export type AddFn<Value, Param> = (param: Param) => GetFreshValue<Value>;

export function createBatch<Value, Param>(
  getFreshValues: (params: Param[]) => Value[] | Promise<Value[]>,
  autoSubmit: false,
): {
  submit: () => Promise<void>;
  add: AddFn<Value, Param>;
};
export function createBatch<Value, Param>(
  getFreshValues: (params: Param[]) => Value[] | Promise<Value[]>,
): {
  add: AddFn<Value, Param>;
};
export function createBatch<Value, Param>(
  getFreshValues: (params: Param[]) => Value[] | Promise<Value[]>,
  autoSubmit: boolean = true,
): {
  submit?: () => Promise<void>;
  add: AddFn<Value, Param>;
} {
  const requests: [
    param: Param,
    res: (value: Value) => void,
    rej: (reason: unknown) => void,
  ][] = [];

  let count = 0;
  let submitted = false;
  const submission = new Deferred<void>();

  const checkSubmission = () => {
    if (submitted) {
      throw new Error('Can not add to batch after submission');
    }
  };

  const submit = async () => {
    if (count !== 0) {
      autoSubmit = true;
      return submission.promise;
    }
    checkSubmission();
    submitted = true;
    try {
      const results = await Promise.resolve(
        getFreshValues(requests.map(([param]) => param)),
      );
      results.forEach((value, index) => requests[index][1](value));
      submission.resolve();
    } catch (err) {
      requests.forEach(([_, __, rej]) => rej(err));
      submission.resolve();
    }
  };

  const trySubmitting = () => {
    count--;
    if (autoSubmit === false) {
      return;
    }
    submit();
  };

  return {
    ...(autoSubmit === false ? { submit } : {}),
    add(param) {
      checkSubmission();
      count++;
      let handled = false;

      return Object.assign(
        () => {
          return new Promise<Value>((res, rej) => {
            requests.push([param, res, rej]);
            if (!handled) {
              handled = true;
              trySubmitting();
            }
          });
        },
        {
          [HANDLE]: () => {
            if (!handled) {
              handled = true;
              trySubmitting();
            }
          },
        },
      );
    },
  };
}

export class Deferred<Value> {
  readonly promise: Promise<Value>;
  // @ts-ignore
  readonly resolve: (value: Value | Promise<Value>) => void;
  // @ts-ignore
  readonly reject: (reason: unknown) => void;
  constructor() {
    this.promise = new Promise((res, rej) => {
      // @ts-ignore
      this.resolve = res;
      // @ts-ignore
      this.reject = rej;
    });
  }
}
