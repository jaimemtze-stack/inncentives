import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { errors, jwtVerify } from 'jose';
import { z } from 'zod';
import { AppError } from '../../common/errors';
import type { AuthenticatedUser } from '../../common/request-context';
import { SECRETS } from '../../config/config.module';
import type { FileSecretsProvider } from '../../config/secrets';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS } from '../../redis/redis.module';
import { SettingsService } from '../../settings/settings.service';

export const WIDGET_AUDIENCE = 'mesa-soporte';
const MAX_AGE = '15m';

const Claims = z.object({
  jti: z.string().min(8).max(100),
  tenant: z.string().regex(/^[a-z0-9-]{2,63}$/),
  environment: z.object({
    id: z.string().min(1).max(100),
    name: z.string().max(120),
    kind: z.enum(['production', 'test', 'development']),
  }),
  module: z.string().max(60).optional(),
  url: z.string().url().max(500).startsWith('https://').optional(),
  version: z.string().max(40).optional(),
  email: z.string().email().max(254).optional(),
});

export type WidgetContext = z.infer<typeof Claims> & { reportedAt: Date };

/** Values of the "inncentives_module" select field; anything else is "otro". */
const MODULES = new Set([
  'organizacion',
  'beneficiarios',
  'tablas',
  'carga',
  'calendarios',
  'planes',
  'procesos',
  'flujos',
  'reportes',
  'portal',
  'centro_comando',
  'seguridad',
  'api',
]);
const ENV_FIELD = { production: 'prod', test: 'qa', development: 'dev' } as const;

/**
 * "Reportar un problema" from inside Inncentives. The Inncentives backend
 * signs a short-lived context token (HS256, shared secret, ≤ 15 min, jti);
 * the widget opens the portal with it. The context is only trusted after
 * verifying the signature, the audience and that the tenant belongs to the
 * signed-in customer's organization; each token creates at most one ticket.
 */
@Injectable()
export class WidgetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(SECRETS) private readonly secrets: FileSecretsProvider,
  ) {}

  async verify(actor: AuthenticatedUser, token: string): Promise<WidgetContext> {
    const cfg = await this.settings.get('inncentives');
    const secret = this.secrets.get(cfg.widgetSecretName);
    if (!secret || secret.length < 32)
      throw new AppError('conflict', 'The widget is not configured.');
    let payload: unknown;
    let iat: number | undefined;
    try {
      const r = await jwtVerify(token, new TextEncoder().encode(secret), {
        algorithms: ['HS256'],
        issuer: cfg.widgetIssuer,
        audience: WIDGET_AUDIENCE,
        maxTokenAge: MAX_AGE,
        requiredClaims: ['exp', 'iat', 'jti'],
      });
      payload = r.payload;
      iat = r.payload.iat;
    } catch (err) {
      if (err instanceof errors.JOSEError)
        throw new AppError('validation_failed', 'Invalid context.');
      throw err;
    }
    const claims = Claims.safeParse(payload);
    if (!claims.success) throw new AppError('validation_failed', 'Invalid context.');
    const org = await this.prisma.organization.findUnique({
      where: { id: actor.organizationId },
      select: { inncentivesTenantKey: true },
    });
    // The report must come from the customer's own Inncentives tenant.
    if (!org?.inncentivesTenantKey || org.inncentivesTenantKey !== claims.data.tenant)
      throw new AppError('forbidden', 'This context belongs to another customer.');
    return { ...claims.data, reportedAt: new Date((iat ?? 0) * 1000) };
  }

  /** Marks the token as used; a second ticket from the same token is refused. */
  async consume(ctx: WidgetContext): Promise<void> {
    const ok = await this.redis.set(`widget:jti:${ctx.jti}`, '1', 'EX', 3600, 'NX');
    if (ok !== 'OK') throw new AppError('conflict', 'This report was already sent.');
  }

  /** Values for the ticket's custom fields. */
  customFields(ctx: WidgetContext): Record<string, string> {
    const module = ctx.module && MODULES.has(ctx.module) ? ctx.module : 'otro';
    return {
      inncentives_environment: ENV_FIELD[ctx.environment.kind],
      inncentives_module: module,
      ...(ctx.version ? { inncentives_version: ctx.version } : {}),
    };
  }

  /** Plain-text summary for the internal note. */
  summary(ctx: WidgetContext): string {
    return [
      'Reporte desde Inncentives (contexto verificado):',
      `Ambiente: ${ctx.environment.name} (${ctx.environment.id})`,
      `Módulo: ${ctx.module ?? '—'}`,
      `URL: ${ctx.url ?? '—'}`,
      `Versión: ${ctx.version ?? '—'}`,
      `Hora: ${ctx.reportedAt.toISOString()}`,
      `Usuario en Inncentives: ${ctx.email ?? '—'}`,
    ].join('\n');
  }
}
