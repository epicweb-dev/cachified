import type { Context } from './common';
import { MIGRATED } from './common';

export async function checkValue<Value>(
  context: Context<Value>,
  value: unknown,
): Promise<
  | { success: true; value: Value; migrated: boolean }
  | { success: false; reason: unknown }
> {
  try {
    const checkResponse = await context.checkValue(
      value,
      (value, updateCache = true) => ({
        [MIGRATED]: updateCache,
        value,
      }),
    );

    if (typeof checkResponse === 'string') {
      return { success: false, reason: checkResponse };
    }

    if (checkResponse == null || checkResponse === true) {
      return {
        success: true,
        value: value as Value,
        migrated: false,
      };
    }

    if (checkResponse && typeof checkResponse[MIGRATED] === 'boolean') {
      return {
        success: true,
        migrated: checkResponse[MIGRATED],
        value: checkResponse.value,
      };
    }

    return { success: false, reason: 'unknown' };
  } catch (err) {
    return {
      success: false,
      reason: err,
    };
  }
}
