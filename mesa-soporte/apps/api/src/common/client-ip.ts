import { isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';

/**
 * Fastify already resolves req.ip through the trusted proxies (TRUST_PROXY).
 * CF-Connecting-IP is only honoured when explicitly enabled and the request
 * reached us through a trusted proxy (the tunnel / nginx), never directly.
 */
export function resolveClientIp(req: FastifyRequest, trustCfHeader: boolean): string {
  if (trustCfHeader) {
    const viaTrustedProxy = req.ips !== undefined && req.ips.length > 1;
    const cf = req.headers['cf-connecting-ip'];
    if (viaTrustedProxy && typeof cf === 'string' && isIP(cf.trim())) return cf.trim();
  }
  return req.ip;
}
