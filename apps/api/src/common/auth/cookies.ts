import type {} from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../../config/config';
import type { Area } from './actor';

/**
 * Cookie names are distinct per host (portal / agent) and use the __Host- prefix when secure
 * (Secure, Path=/, no Domain → bound to the exact host).
 */
export function cookieName(config: AppConfig, base: 'sid' | 'csrf' | 'dev', area: Area): string {
  const name = `inn_${area}_${base}`;
  return config.COOKIE_SECURE ? `__Host-${name}` : name;
}

export function setCookie(
  reply: FastifyReply,
  config: AppConfig,
  base: 'sid' | 'csrf' | 'dev',
  area: Area,
  value: string,
  opts: { maxAgeSeconds?: number; httpOnly?: boolean } = {},
): void {
  reply.setCookie(cookieName(config, base, area), value, {
    path: '/',
    secure: config.COOKIE_SECURE,
    httpOnly: opts.httpOnly ?? true,
    sameSite: 'lax',
    ...(opts.maxAgeSeconds !== undefined ? { maxAge: opts.maxAgeSeconds } : {}),
  });
}

export function clearCookie(
  reply: FastifyReply,
  config: AppConfig,
  base: 'sid' | 'csrf' | 'dev',
  area: Area,
) {
  reply.clearCookie(cookieName(config, base, area), {
    path: '/',
    secure: config.COOKIE_SECURE,
    sameSite: 'lax',
  });
}

export function readCookie(
  req: FastifyRequest,
  config: AppConfig,
  base: 'sid' | 'csrf' | 'dev',
  area: Area,
) {
  return req.cookies?.[cookieName(config, base, area)];
}
