import type { FastifyReply } from 'fastify';
import type { AppConfig } from '../config/config';

/**
 * "__Host-" prefix: the browser only accepts it with Secure, Path=/ and no
 * Domain, so the cookie is bound to exactly one host (portal or agents).
 */
export const SESSION_COOKIE = '__Host-sid';

export function setSessionCookie(reply: FastifyReply, token: string, config: AppConfig): void {
  void reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: config.SESSION_ABSOLUTE_HOURS * 3600,
  });
}

export function clearSessionCookie(reply: FastifyReply, config: AppConfig): void {
  void reply.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
  });
}
