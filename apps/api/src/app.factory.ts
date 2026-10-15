import 'reflect-metadata';
import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import type { ModuleMetadata } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { Logger } from 'pino';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module';
import type {} from './common/auth/actor';
import type { AppConfig } from './config/config';
import { RedisService } from './common/redis/redis.service';
import { registerSecurityHeaders } from './common/http/security-headers';
import { createLogger } from './common/logger';

export interface CreateAppOptions {
  logger?: Logger;
  /** Test hook to override providers (e.g. the mail queue). */
  overrideProviders?: Array<{ provide: unknown; useValue: unknown }>;
}

function createAdapter(config: AppConfig): FastifyAdapter {
  return new FastifyAdapter({
    logger: false,
    bodyLimit: config.BODY_LIMIT_BYTES,
    trustProxy: config.TRUST_CLOUDFLARE,
    // Correlation ids are generated server-side; inbound ids are not trusted.
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    disableRequestLogging: true,
  });
}

export async function createApp(
  config: AppConfig,
  opts: CreateAppOptions = {},
): Promise<NestFastifyApplication> {
  const logger = opts.logger ?? createLogger(config.LOG_LEVEL);
  const fastifyAdapter = createAdapter(config);

  let app: NestFastifyApplication;
  if (opts.overrideProviders?.length) {
    let builder = Test.createTestingModule({
      imports: [AppModule.forRoot(config)],
    } as ModuleMetadata);
    for (const o of opts.overrideProviders)
      builder = builder.overrideProvider(o.provide).useValue(o.useValue);
    const moduleRef = await builder.compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(fastifyAdapter, {
      logger: false,
    });
  } else {
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule.forRoot(config),
      fastifyAdapter,
      {
        logger: ['error', 'warn'],
      },
    );
  }

  const fastify = app.getHttpAdapter().getInstance();

  fastify.addHook('onRequest', async (req) => {
    req.correlationId = req.id;
    const cf = config.TRUST_CLOUDFLARE
      ? (req.headers['cf-connecting-ip'] as string | undefined)
      : undefined;
    req.clientIp = cf ?? req.ip;
  });
  fastify.addHook('onResponse', async (req, reply) => {
    logger.info({
      correlationId: req.correlationId,
      method: req.method,
      route: req.routeOptions?.url,
      status: reply.statusCode,
      ms: Math.round(reply.elapsedTime),
    });
  });

  await app.register(fastifyCookie);
  await app.register(fastifyRateLimit, {
    max: config.RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    redis: app.get(RedisService),
    nameSpace: 'rl:',
    keyGenerator: (req: { clientIp?: string; ip: string }) => req.clientIp ?? req.ip,
  });
  registerSecurityHeaders(fastify, { hsts: config.COOKIE_SECURE });

  // CORS closed: the SPA is served from the same origin; no Access-Control-* headers are emitted.
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
  app.enableShutdownHooks();
  await app.init();
  await fastify.ready();
  return app;
}
