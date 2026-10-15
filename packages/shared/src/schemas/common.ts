import { z } from 'zod';

export const uuidSchema = z.string().uuid();

/** Cursor pagination (mandatory on list endpoints). */
export const paginationSchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type PaginationInput = z.infer<typeof paginationSchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Rejects CR/LF to prevent header injection in e-mail subjects and addresses. */
export const headerSafeString = (max = 998) =>
  z
    .string()
    .max(max)
    .refine((s) => !/[\r\n]/.test(s), { message: 'line_breaks_not_allowed' });
