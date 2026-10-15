import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Uniform error responses. Unexpected errors return a generic 500 with the correlation id;
 * details go to the (redacted) log only.
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('Error');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const req = ctx.getRequest<FastifyRequest>();
    const correlationId = req.correlationId;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const body =
        typeof res === 'string'
          ? { statusCode: status, message: res }
          : (res as Record<string, unknown>);
      void reply.status(status).send({ ...body, statusCode: status, correlationId });
      return;
    }
    const fastifyStatus = (exception as { statusCode?: number })?.statusCode;
    if (fastifyStatus && fastifyStatus >= 400 && fastifyStatus < 500) {
      void reply
        .status(fastifyStatus)
        .send({ statusCode: fastifyStatus, message: 'bad_request', correlationId });
      return;
    }
    this.logger.error({
      err:
        exception instanceof Error
          ? { name: exception.name, message: exception.message, stack: exception.stack }
          : String(exception),
      correlationId,
    });
    void reply.status(500).send({ statusCode: 500, message: 'internal_error', correlationId });
  }
}
