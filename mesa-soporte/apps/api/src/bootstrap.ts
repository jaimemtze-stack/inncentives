import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ApiErrorBody, ErrorCode } from '@mesa/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppModule } from './app.module';
import { resolveClientIp } from './common/client-ip';
import { isHostAgnosticPath, resolveArea } from './common/host-area';
import { createRootLogger, PinoNestLogger } from './common/logger';
import { type AppConfig, loadConfig } from './config/config';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function reject(
  reply: FastifyReply,
  req: FastifyRequest,
  status: number,
  code: ErrorCode,
  message: string,
) {
  const body: ApiErrorBody = { error: { code, message, correlationId: req.id } };
  return reply.status(status).header('Cache-Control', 'no-store').send(body);
}

/**
 * Origin check for state-changing requests (defence in depth on top of
 * SameSite cookies and the per-session CSRF token). Webhooks under /hooks/
 * authenticate with signatures instead.
 */
export function originAllowed(req: FastifyRequest, config: AppConfig): boolean {
  if (!UNSAFE_METHODS.has(req.method) || req.url.startsWith('/hooks/')) return true;
  const site = req.headers['sec-fetch-site'];
  if (typeof site === 'string' && site !== 'same-origin') return false;
  const expected = `${config.PUBLIC_SCHEME}://${req.headers.host ?? ''}`;
  const origin = req.headers.origin;
  if (typeof origin === 'string') return origin === expected;
  const referer = req.headers.referer;
  if (typeof referer === 'string') {
    try {
      return new URL(referer).origin === expected;
    } catch {
      return false;
    }
  }
  return false;
}

export async function createApp(config: AppConfig = loadConfig()): Promise<NestFastifyApplication> {
  const logger = createRootLogger(config.LOG_LEVEL);
  const adapter = new FastifyAdapter({
    loggerInstance: logger,
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
    genReqId: () => randomUUID(),
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(config), adapter, {
    logger: new PinoNestLogger(logger),
    bufferLogs: true,
  });

  const fastify = app.getHttpAdapter().getInstance();
  await fastify.register(fastifyCookie);
  await fastify.register(fastifyHelmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    hsts: { maxAge: 63_072_000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  });

  fastify.addHook('onRequest', async (req, reply) => {
    req.correlationId = req.id;
    void reply.header('X-Correlation-Id', req.id);
    req.clientIp = resolveClientIp(req, config.TRUST_CF_CONNECTING_IP);
    req.area = resolveArea(req.headers.host, {
      portal: config.PORTAL_HOST,
      agent: config.AGENT_HOST,
    });
    if (!req.area && !isHostAgnosticPath(req.url)) {
      return reject(reply, req, 421, 'wrong_host', 'Unknown host.');
    }
    if (!originAllowed(req, config)) {
      return reject(reply, req, 403, 'csrf_failed', 'Request origin could not be verified.');
    }
  });

  fastify.addHook('onSend', async (_req, reply, payload) => {
    if (!reply.hasHeader('Cache-Control')) void reply.header('Cache-Control', 'no-store');
    return payload;
  });

  app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
  app.enableShutdownHooks();
  await app.init();
  await fastify.ready();
  return app;
}
