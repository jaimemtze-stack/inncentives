import { PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';
import { AppError } from './errors';

/**
 * Validates and strips input with a Zod schema. Error details carry the field
 * paths and issue codes only, never the submitted values.
 */
export class ZodPipe<T extends ZodTypeAny> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new AppError(
        'validation_failed',
        'Invalid input.',
        result.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code })),
      );
    }
    return result.data;
  }
}
