import type { LoggerService } from '@nestjs/common';
import pino, { type Logger } from 'pino';

/** Paths never written to logs (ASVS 7.1.1 / 7.1.2). */
export const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.token',
  '*.csrfToken',
  '*.code',
  '*.recoveryCode',
  '*.secret',
  '*.otpauthUri',
];

export function createRootLogger(level: string): Logger {
  return pino({
    level,
    base: { service: 'mesa-api' },
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

/** Routes NestJS framework logs through the same pino instance as Fastify. */
export class PinoNestLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}

  private write(
    level: 'info' | 'warn' | 'error' | 'debug' | 'trace',
    message: unknown,
    params: unknown[],
  ) {
    const context =
      typeof params[params.length - 1] === 'string' ? (params.pop() as string) : undefined;
    if (message instanceof Error) this.logger[level]({ context, err: message }, message.message);
    else if (message && typeof message === 'object') this.logger[level]({ context, ...message });
    else
      this.logger[level]({ context, extra: params.length ? params : undefined }, String(message));
  }

  log(message: unknown, ...params: unknown[]) {
    this.write('info', message, params);
  }
  error(message: unknown, ...params: unknown[]) {
    this.write('error', message, params);
  }
  warn(message: unknown, ...params: unknown[]) {
    this.write('warn', message, params);
  }
  debug(message: unknown, ...params: unknown[]) {
    this.write('debug', message, params);
  }
  verbose(message: unknown, ...params: unknown[]) {
    this.write('trace', message, params);
  }
}
