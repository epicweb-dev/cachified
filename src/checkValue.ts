import type { Context } from './common';
import { MIGRATED } from './common';

export async function checkValue<Value>(
  context: Context<Value>,
  value: unknown,
): Promise<
  | { success: true; value: Value; migrated: boolean }
  | { success: false; reason: string }
> {
  try {
    const checkResponse = await context.checkValue(value, (value) => ({
      [MIGRATED]: true,
      value,
    }));

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

    if (checkResponse && checkResponse[MIGRATED] === true) {
      return {
        success: true,
        migrated: true,
        value: checkResponse.value,
      };
    }

    return { success: false, reason: 'unknown' };
  } catch (err) {
    return {
      success: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
