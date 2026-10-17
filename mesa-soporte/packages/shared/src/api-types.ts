import type { HostArea, Role } from './permissions';

export type AuthState = 'authenticated' | 'mfa_required' | 'mfa_enrollment_required';

export interface MeResponse {
  state: AuthState;
  area: HostArea;
  user: {
    id: string;
    email: string;
    name: string;
    role: Role;
    organizationId: string;
    locale: string;
    mfaEnabled: boolean;
  };
  permissions: string[];
}

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    correlationId?: string;
    details?: unknown;
  };
}

export const ErrorCodes = [
  'bad_request',
  'validation_failed',
  'unauthenticated',
  'invalid_credentials',
  'mfa_required',
  'mfa_invalid',
  'mfa_enrollment_required',
  'reauthentication_required',
  'forbidden',
  'wrong_host',
  'csrf_failed',
  'not_found',
  'conflict',
  'rate_limited',
  'token_invalid',
  'password_breached',
  'internal_error',
] as const;
export type ErrorCode = (typeof ErrorCodes)[number];

export interface SessionInfo {
  id: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  ip: string | null;
  userAgent: string | null;
}
