import { Inject, Injectable, Logger } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuditService } from '../audit/audit.service';
import { SECRETS } from '../config/config.module';
import type { FileSecretsProvider } from '../config/secrets';
import { AppError } from '../common/errors';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { safeEqual } from '../security/tokens';
import { SettingsService } from '../settings/settings.service';
import { TicketAccessService } from '../tickets/access.service';
import { escapeHtml } from '../tickets/sanitize';
import { TicketService } from '../tickets/ticket.service';
import { DevOpsClient } from './devops.client';

/** Azure DevOps work items linked to tickets (create, link, sync, service hooks). */
@Injectable()
export class DevOpsService {
  private readonly logger = new Logger(DevOpsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TicketAccessService,
    private readonly tickets: TicketService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    @Inject(SECRETS) private readonly secrets: FileSecretsProvider,
  ) {}

  /** Overridable in tests. */
  async client(): Promise<DevOpsClient> {
    const cfg = await this.settings.get('azure_devops');
    const pat = this.secrets.get(cfg.secretName);
    if (!pat || !cfg.organization)
      throw new AppError('conflict', 'Azure DevOps is not configured.');
    return new DevOpsClient(cfg, pat);
  }

  async list(req: FastifyRequest, ticketId: string) {
    await this.access.load(req.auth!.user, ticketId, 'read');
    return this.prisma.devOpsLink.findMany({ where: { ticketId }, orderBy: { createdAt: 'asc' } });
  }

  async create(
    req: FastifyRequest,
    ticketId: string,
    input: { type?: string; title?: string; description?: string },
  ) {
    const actor = req.auth!.user;
    const t = await this.access.load(actor, ticketId, 'change');
    const cfg = await this.settings.get('azure_devops');
    // Only ticket metadata and what the agent wrote: never the customer's messages.
    const description =
      `<p>${escapeHtml(input.description ?? '')}</p>` +
      `<p>Ticket <a href="${escapeHtml(this.mail.link('agent', `/tickets/${t.id}`))}">#${escapeHtml(t.number)}</a></p>`;
    const wi = await (
      await this.client()
    ).create(
      input.type ?? cfg.defaultType,
      input.title ?? `[#${t.number}] ${t.title}`,
      description,
    );
    return this.save(req, t.id, wi, 'devops.work_item.created');
  }

  async link(req: FastifyRequest, ticketId: string, workItemId: number) {
    const t = await this.access.load(req.auth!.user, ticketId, 'change');
    const wi = await (await this.client()).get(workItemId);
    return this.save(req, t.id, wi, 'devops.work_item.linked');
  }

  async unlink(req: FastifyRequest, ticketId: string, linkId: string) {
    await this.access.load(req.auth!.user, ticketId, 'change');
    const res = await this.prisma.devOpsLink.deleteMany({ where: { id: linkId, ticketId } });
    if (!res.count) throw new AppError('not_found');
  }

  private async save(
    req: FastifyRequest,
    ticketId: string,
    wi: Awaited<ReturnType<DevOpsClient['get']>>,
    action: string,
  ) {
    const link = await this.prisma.devOpsLink.upsert({
      where: { ticketId_workItemId: { ticketId, workItemId: wi.id } },
      create: {
        ticketId,
        workItemId: wi.id,
        workItemType: wi.type,
        title: wi.title,
        state: wi.state,
        url: wi.url,
        lastSyncedAt: new Date(),
        createdById: req.auth!.user.id,
      },
      update: { title: wi.title, state: wi.state, url: wi.url, lastSyncedAt: new Date() },
    });
    await this.prisma.ticketHistory.create({
      data: { ticketId, actorId: req.auth!.user.id, field: 'devops', newValue: `#${wi.id}` },
    });
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action,
      targetType: 'ticket',
      targetId: ticketId,
      data: { workItemId: wi.id },
    });
    return link;
  }

  /** Refreshes linked work items; a state change adds an internal note. */
  async sync(workItemIds?: number[]): Promise<number> {
    const links = await this.prisma.devOpsLink.findMany({
      where: workItemIds
        ? { workItemId: { in: workItemIds } }
        : { ticket: { state: { notIn: ['closed', 'merged'] } } },
      include: { ticket: { include: { tags: true } } },
      take: 500,
      orderBy: { lastSyncedAt: { sort: 'asc', nulls: 'first' } },
    });
    if (!links.length) return 0;
    const client = await this.client();
    let changed = 0;
    for (const l of links) {
      try {
        const wi = await client.get(l.workItemId);
        await this.prisma.devOpsLink.update({
          where: { id: l.id },
          data: { state: wi.state, title: wi.title, lastSyncedAt: new Date() },
        });
        if (wi.state !== l.state) {
          changed++;
          await this.tickets.addArticleCore(
            l.ticket,
            {
              type: 'note',
              sender: 'system',
              internal: true,
              body: `Azure DevOps: el work item #${wi.id} (${wi.type}) cambió de "${l.state}" a "${wi.state}".`,
              isHtml: false,
            },
            { actorId: null, depth: 3 },
          );
        }
      } catch (err) {
        this.logger.warn(`work item ${l.workItemId}: ${(err as Error).message}`);
      }
    }
    return changed;
  }

  /**
   * Service hook endpoint. Azure DevOps sends HTTP basic credentials; the
   * payload is only used to learn which work item changed — its state is
   * read back from the API, never trusted from the request.
   */
  async hook(authorization: string | undefined, payload: unknown): Promise<void> {
    const secret = this.secrets.get('azure_devops_hook_secret');
    const given = /^Basic (.+)$/.exec(authorization ?? '')?.[1];
    const password = given
      ? Buffer.from(given, 'base64').toString('utf8').split(':').slice(1).join(':')
      : '';
    if (!secret || !password || !safeEqual(password, secret)) throw new AppError('unauthenticated');
    const p = payload as { resource?: { workItemId?: unknown; id?: unknown } };
    const id = Number(p?.resource?.workItemId ?? p?.resource?.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new AppError('validation_failed');
    await this.sync([id]);
  }
}
