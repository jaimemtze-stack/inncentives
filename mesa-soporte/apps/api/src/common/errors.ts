import { HttpException } from '@nestjs/common';
import type { ErrorCode } from '@mesa/shared';

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  validation_failed: 400,
  unauthenticated: 401,
  invalid_credentials: 401,
  mfa_required: 401,
  mfa_invalid: 401,
  mfa_enrollment_required: 403,
  reauthentication_required: 403,
  forbidden: 403,
  wrong_host: 421,
  csrf_failed: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  token_invalid: 400,
  password_breached: 400,
  internal_error: 500,
};

const DEFAULT_MESSAGE: Partial<Record<ErrorCode, string>> = {
  invalid_credentials: 'Invalid email or password.',
  unauthenticated: 'Authentication required.',
  forbidden: 'You do not have access to this resource.',
  not_found: 'Not found.',
  rate_limited: 'Too many attempts. Try again later.',
  token_invalid: 'The link is invalid or has expired.',
  csrf_failed: 'Request origin could not be verified.',
  wrong_host: 'This endpoint is not available on this host.',
  internal_error: 'Unexpected error.',
};

export class AppError extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    message?: string,
    public readonly details?: unknown,
    status?: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message ?? DEFAULT_MESSAGE[code] ?? code, status ?? DEFAULT_STATUS[code]);
  }
}
