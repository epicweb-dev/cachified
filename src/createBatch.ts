import type { GetFreshValue } from './common';
import { HANDLE } from './common';

export type AddFn<Value, Param> = (param: Param) => GetFreshValue<Value>;

export function createBatch<Value, Param>(
  getFreshValue: (params: Param[]) => Value[] | Promise<Value[]>,
  autoSubmit: false,
): {
  submit: () => Promise<void>;
  add: AddFn<Value, Param>;
};
export function createBatch<Value, Param>(
  getFreshValue: (params: Param[]) => Value[] | Promise<Value[]>,
): {
  add: AddFn<Value, Param>;
};
export function createBatch<Value, Param>(
  getFreshValue: (params: Param[]) => Value[] | Promise<Value[]>,
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
  let adds = 0;
  let handled = 0;
  let submitted = false;
  const checkSubmission = () => {
    if (submitted) {
      throw new Error('Can not add to batch after submission');
    }
  };
  let resolveSubmission: () => void;
  let rejectSubmission: (reason: unknown) => void;
  const submissionP = new Promise<void>((res, rej) => {
    resolveSubmission = res;
    rejectSubmission = rej;
  });

  const submit = async () => {
    if (handled !== adds) {
      autoSubmit = true;
      return submissionP;
    }
    checkSubmission();
    submitted = true;
    try {
      const results = await Promise.resolve(
        getFreshValue(requests.map(([param]) => param)),
      );
      results.forEach((value, index) => requests[index][1](value));
      resolveSubmission();
    } catch (err) {
      requests.forEach(([_, __, rej]) => rej(err));
      rejectSubmission(err);
    }
  };

  const trySubmitting = () => {
    handled++;
    if (autoSubmit === false) {
      return;
    }
    submit();
  };

  return {
    ...(autoSubmit === false ? { submit } : {}),
    add(param) {
      checkSubmission();
      adds++;
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
