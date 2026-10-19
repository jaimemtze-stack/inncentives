import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { AppError } from '../../common/errors';
import type { AuthenticatedUser } from '../../common/request-context';
import { SECRETS } from '../../config/config.module';
import type { FileSecretsProvider } from '../../config/secrets';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS } from '../../redis/redis.module';
import { SettingsService } from '../../settings/settings.service';
import { TicketAccessService } from '../../tickets/access.service';
import { MockInncentivesClient, type InncentivesClient } from './inncentives.client';
import { HttpInncentivesClient } from './inncentives.http';

const CACHE_SECONDS = 60;

/**
 * Inncentives context of a ticket's customer for the agents' sidebar.
 * Informational: any failure of the API yields `available: false` and the
 * ticket keeps working.
 */
@Injectable()
export class InncentivesService {
  private readonly logger = new Logger(InncentivesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TicketAccessService,
    private readonly settings: SettingsService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(SECRETS) private readonly secrets: FileSecretsProvider,
  ) {}

  /** The configured client, or null while the integration is off. */
  async client(): Promise<InncentivesClient | null> {
    const cfg = await this.settings.get('inncentives');
    if (cfg.mode === 'mock') return new MockInncentivesClient();
    if (cfg.mode !== 'http' || !cfg.baseUrl) return null;
    const token = this.secrets.get(cfg.secretName);
    return token ? new HttpInncentivesClient(cfg.baseUrl, token) : null;
  }

  async forTicket(actor: AuthenticatedUser, ticketId: string) {
    const t = await this.access.load(actor, ticketId, 'read');
    if (!t.organizationId) return { available: false as const, reason: 'no_organization' };
    const org = await this.prisma.organization.findUnique({
      where: { id: t.organizationId },
      select: { inncentivesTenantKey: true },
    });
    const key = org?.inncentivesTenantKey;
    if (!key) return { available: false as const, reason: 'no_tenant' };
    const client = await this.client();
    if (!client) return { available: false as const, reason: 'disabled' };

    const cacheKey = `inncentives:tenant:${key}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as unknown;
    try {
      const envs = await client.environments(key);
      const environments = await Promise.all(
        envs.slice(0, 5).map(async (e) => ({
          ...e,
          failedRuns: await client.failedRuns(e.id, 5),
          recentEvents: await client.recentEvents(e.id, 5),
        })),
      );
      const out = { available: true as const, tenantKey: key, environments };
      await this.redis.set(cacheKey, JSON.stringify(out), 'EX', CACHE_SECONDS);
      return out;
    } catch (err) {
      this.logger.warn(`Inncentives API unavailable: ${(err as Error).message}`);
      return { available: false as const, reason: 'unavailable' };
    }
  }

  /** Used by the widget: the organization that owns a tenant key. */
  async organizationForTenant(tenantKey: string) {
    const org = await this.prisma.organization.findUnique({
      where: { inncentivesTenantKey: tenantKey },
      select: { id: true, name: true },
    });
    if (!org) throw new AppError('not_found');
    return org;
  }
}
