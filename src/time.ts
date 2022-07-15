import type { Timings } from './common';

interface TimeOptions<ReturnType> {
  name: string;
  type: string;
  performance: Pick<Performance, 'now'>;
  fn: () => ReturnType | Promise<ReturnType>;
  timings?: Timings;
}
export async function time<ReturnType>({
  name,
  type,
  fn,
  performance,
  timings,
}: TimeOptions<ReturnType>): Promise<ReturnType> {
  if (!timings) return fn();

  const start = performance.now();
  const result = await fn();
  type = type.replaceAll(' ', '_');
  let timingType = timings[type];
  if (!timingType) {
    // eslint-disable-next-line no-multi-assign
    timingType = timings[type] = [];
  }

  timingType.push({ name, type, time: performance.now() - start });
  return result;
}
