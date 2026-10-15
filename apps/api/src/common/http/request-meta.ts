import type { FastifyRequest } from 'fastify';
import type { AppConfig } from '../../config/config';
import type { Area } from '../auth/actor';
import { readCookie } from '../auth/cookies';
import type { RequestMeta } from '../../modules/auth/auth.service';

export function requestMeta(req: FastifyRequest, config: AppConfig, area?: Area): RequestMeta {
  return {
    ip: req.clientIp,
    userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
    correlationId: req.correlationId,
    deviceCookie: area ? readCookie(req, config, 'dev', area) : undefined,
  };
}
