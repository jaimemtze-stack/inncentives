import pino, { type Logger, type LoggerOptions } from 'pino';

/**
 * Structured JSON logs. Credentials, tokens, message bodies and personal data are redacted
 * by path; free-text messages must never interpolate such values.
 */
export const REDACT_PATHS = [
  'password',
  'newPassword',
  'currentPassword',
  'passwordHash',
  'token',
  'code',
  'secret',
  'mfaSecretEnc',
  'mfaRecoveryCodes',
  'email',
  'phone',
  'phones',
  'bodyHtml',
  'bodyText',
  'body',
  'authorization',
  'cookie',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.passwordHash',
  '*.token',
  '*.code',
  '*.secret',
  '*.mfaSecretEnc',
  '*.email',
  '*.phone',
  '*.phones',
  '*.bodyHtml',
  '*.bodyText',
  '*.body',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
];

export function createLogger(
  level: LoggerOptions['level'] = 'info',
  destination?: pino.DestinationStream,
): Logger {
  return pino(
    {
      level,
      base: { service: 'inn-support-api' },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      formatters: { level: (label) => ({ level: label }) },
    },
    destination,
  );
}
