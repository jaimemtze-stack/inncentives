import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { ApiErrorBody, ErrorCode } from '@mesa/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from './errors';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const req = ctx.getRequest<FastifyRequest>();

    let status = 500;
    let code: ErrorCode = 'internal_error';
    let message = 'Unexpected error.';
    let details: unknown;

    if (exception instanceof AppError) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      details = exception.details;
      if (exception.retryAfterSeconds) {
        void reply.header('Retry-After', String(exception.retryAfterSeconds));
      }
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = status === 404 ? 'not_found' : status === 403 ? 'forbidden' : 'bad_request';
      message = status === 404 ? 'Not found.' : exception.message;
    } else if (isFastifyError(exception) && exception.statusCode < 500) {
      status = exception.statusCode;
      code = 'bad_request';
      message = 'Malformed request.';
    }

    if (status >= 500) {
      this.logger.error({ err: exception, correlationId: req.correlationId }, 'Unhandled error');
    }

    const body: ApiErrorBody = {
      error: { code, message, correlationId: req.correlationId, ...(details ? { details } : {}) },
    };
    // Routes may declare another content type (TwiML, plain text); errors are always JSON.
    void reply
      .status(status)
      .header('Cache-Control', 'no-store')
      .header('Content-Type', 'application/json; charset=utf-8')
      .send(body);
  }
}

function isFastifyError(e: unknown): e is { statusCode: number } {
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof (e as { statusCode?: unknown }).statusCode === 'number'
  );
}
