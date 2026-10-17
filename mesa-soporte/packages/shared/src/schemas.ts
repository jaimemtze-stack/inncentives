import { z } from 'zod';
import { Roles } from './permissions';

export const EmailSchema = z.string().trim().toLowerCase().min(3).max(254).email();

/** OWASP ASVS 2.1: length over composition rules. */
export const PasswordSchema = z.string().min(12).max(128);

export const LoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const TotpCodeSchema = z.string().regex(/^\d{6}$/);
export const RecoveryCodeSchema = z.string().regex(/^[a-z0-9]{5}-[a-z0-9]{5}$/);

export const MfaVerifySchema = z.union([
  z.object({ code: TotpCodeSchema }).strict(),
  z.object({ recoveryCode: RecoveryCodeSchema }).strict(),
]);
export type MfaVerifyInput = z.infer<typeof MfaVerifySchema>;

export const TotpConfirmSchema = z.object({ code: TotpCodeSchema }).strict();

export const ReauthSchema = z.object({ password: z.string().min(1).max(128) }).strict();

export const PasswordForgotSchema = z.object({ email: EmailSchema }).strict();

export const TokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const PasswordResetSchema = z
  .object({ token: TokenSchema, password: PasswordSchema })
  .strict();

export const PasswordChangeSchema = z
  .object({ currentPassword: z.string().min(1).max(128), newPassword: PasswordSchema })
  .strict();

export const InvitationCreateSchema = z
  .object({
    email: EmailSchema,
    name: z.string().trim().min(1).max(120),
    role: z.enum(Roles),
    organizationId: z.string().uuid(),
  })
  .strict();
export type InvitationCreateInput = z.infer<typeof InvitationCreateSchema>;

export const InvitationAcceptSchema = z
  .object({
    token: TokenSchema,
    name: z.string().trim().min(1).max(120),
    password: PasswordSchema,
  })
  .strict();

const DomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);

export const OrganizationCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    domains: z.array(DomainSchema).max(20).default([]),
    mfaRequiredForCustomers: z.boolean().default(false),
  })
  .strict();
export type OrganizationCreateInput = z.infer<typeof OrganizationCreateSchema>;

export const PaginationSchema = z.object({
  cursor: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const UuidParamSchema = z.object({ id: z.string().uuid() });
