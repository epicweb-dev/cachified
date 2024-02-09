import { format } from 'pretty-format';
import { CacheEvent } from './reporter';

export function prettyPrint(value: any) {
  return format(value, {
    min: true,
    plugins: [
      {
        test(val) {
          return typeof val === 'string';
        },
        serialize(val, config, indentation, depth, refs) {
          return refs[0] &&
            typeof refs[0] === 'object' &&
            Object.keys(refs[refs.length - 1] as any).includes(val)
            ? val
            : `'${val}'`;
        },
      },
    ],
  });
}

export function delay(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

export function report(calls: [event: CacheEvent<any>][]) {
  const totalCalls = String(calls.length + 1).length;
  return calls
    .map(([{ name, ...payload }], i) => {
      const data = JSON.stringify(payload);
      const title = `${String(i + 1).padStart(totalCalls, ' ')}. ${name}`;
      if (!payload || data === '{}') {
        return title;
      }
      return `${title}\n${String('').padStart(
        totalCalls + 2,
        ' ',
      )}${prettyPrint(payload)}`;
    })
    .join('\n');
}
