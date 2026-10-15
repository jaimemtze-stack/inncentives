import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

/** ASVS V2.1: length only, no composition rules; Unicode allowed. */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, { message: 'password_too_short' })
  .max(PASSWORD_MAX_LENGTH, { message: 'password_too_long' });

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const totpCodeSchema = z.string().regex(/^\d{6}$/);
export const recoveryCodeSchema = z.string().regex(/^[a-z0-9]{5}-[a-z0-9]{5}$/);

export const mfaVerifySchema = z.object({
  code: z.union([totpCodeSchema, recoveryCodeSchema]),
});

export const mfaEnableSchema = z.object({ code: totpCodeSchema });

export const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const acceptInvitationSchema = z.object({
  token: tokenSchema,
  password: passwordSchema,
  firstname: z.string().trim().min(1).max(100).optional(),
  lastname: z.string().trim().min(1).max(100).optional(),
});

export const requestPasswordResetSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({ token: tokenSchema, password: passwordSchema });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: passwordSchema,
});

export const reauthSchema = z.object({
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  code: totpCodeSchema.optional(),
});

export const localeSchema = z.enum(['es-MX', 'en']);
export type Locale = z.infer<typeof localeSchema>;

export const inviteUserSchema = z.object({
  email: emailSchema,
  firstname: z.string().trim().min(1).max(100),
  lastname: z.string().trim().min(1).max(100),
  organizationId: z.string().uuid().optional(),
  roles: z.array(z.enum(['admin', 'agent', 'customer'])).min(1),
  locale: localeSchema.default('es-MX'),
  sharedOrganization: z.boolean().default(false),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;
