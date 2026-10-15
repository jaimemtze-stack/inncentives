import type { FastifyInstance } from 'fastify';

/**
 * Security headers for every response (ASVS V14.4). The API serves JSON only, so the CSP is
 * maximally strict; the SPA's own CSP is set by the web server (apps/web/nginx.conf).
 */
export const API_CSP =
  "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

export function registerSecurityHeaders(app: FastifyInstance, opts: { hsts: boolean }): void {
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('Content-Security-Policy', API_CSP);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    );
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    reply.header('Cache-Control', 'no-store');
    if (opts.hsts)
      reply.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    reply.removeHeader('X-Powered-By');
    return payload;
  });
}
