import { SetMetadata } from '@nestjs/common';
import type { ZodTypeAny } from 'zod';

export const API_BODY_KEY = 'openapi:body';

/** Documents a body that the handler validates itself (one of these schemas). */
export const ApiBody = (...schemas: ZodTypeAny[]) => SetMetadata(API_BODY_KEY, schemas);
