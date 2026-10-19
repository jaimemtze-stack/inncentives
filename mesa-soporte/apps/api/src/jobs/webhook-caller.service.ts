import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { teamsCard, teamsUrlAad } from '../integrations/teams';
import type { TeamsJob, WebhookJob } from '../queue/job-queues.service';
import { FieldEncryption } from '../security/field-encryption';
import { safePost } from './safe-fetch';

export const webhookSecretAad = (id: string) => `webhook:${id}:secret`;

/**
 * Calls trigger webhooks. The payload carries ticket metadata only (no
 * article bodies or customer contact data) and is signed like the CTI hook.
 */
@Injectable()
export class WebhookCallerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fields: FieldEncryption,
    private readonly mail: MailService,
    @Inject(safePost) private readonly post: typeof safePost,
  ) {}

  async call(job: WebhookJob): Promise<void> {
    const hook = await this.prisma.webhook.findUnique({ where: { id: job.webhookId } });
    const t = await this.prisma.ticket.findUnique({
      where: { id: job.ticketId },
      include: {
        priority: { select: { name: true } },
        group: { select: { name: true } },
        owner: { select: { name: true } },
        organization: { select: { name: true } },
        tags: true,
      },
    });
    if (!hook || !hook.active || !t) return;
    const body = JSON.stringify({
      event: 'ticket.trigger',
      triggerId: job.triggerId,
      sentAt: new Date().toISOString(),
      ticket: {
        id: t.id,
        number: t.number,
        title: t.title,
        state: t.state,
        priority: t.priority.name,
        group: t.group.name,
        owner: t.owner?.name ?? null,
        organization: t.organization?.name ?? null,
        tags: t.tags.map((x) => x.name),
        escalationAt: t.escalationAt,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        url: this.mail.link('agent', `/tickets/${t.id}`),
      },
    });
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'user-agent': 'mesa-soporte-webhook/1',
    };
    if (hook.secretEnc) {
      const secret = this.fields.decrypt(hook.secretEnc, webhookSecretAad(hook.id));
      const ts = Math.floor(Date.now() / 1000);
      headers['x-mesa-signature'] =
        `t=${ts},v1=${createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`;
    }
    const started = Date.now();
    try {
      const res = await this.post(hook.url, body, headers);
      await this.log('webhook', hook.id, t.id, 'ticket.trigger', res.status, null, started);
      await this.prisma.webhook.update({
        where: { id: hook.id },
        data: {
          lastStatus: res.status,
          lastError: res.status >= 300 ? `HTTP ${res.status}` : null,
          lastCalledAt: new Date(),
        },
      });
      if (res.status >= 500 || res.status === 429) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      await this.log(
        'webhook',
        hook.id,
        t.id,
        'ticket.trigger',
        null,
        (err as Error).message,
        started,
      );
      await this.prisma.webhook.update({
        where: { id: hook.id },
        data: { lastError: (err as Error).message.slice(0, 500), lastCalledAt: new Date() },
      });
      throw err;
    }
  }

  /** Teams card for one channel (metadata only). */
  async callTeams(job: TeamsJob): Promise<void> {
    const ch = await this.prisma.teamsChannel.findUnique({ where: { id: job.channelId } });
    const t = await this.prisma.ticket.findUnique({
      where: { id: job.ticketId },
      include: { priority: { select: { name: true } }, organization: { select: { name: true } } },
    });
    if (!ch || !ch.active || !t) return;
    const url = this.fields.decrypt(ch.urlEnc, teamsUrlAad(ch.id));
    const body = JSON.stringify(
      teamsCard({
        number: t.number,
        title: t.title,
        organization: t.organization?.name ?? null,
        priority: t.priority.name,
        event: job.event,
        url: this.mail.link('agent', `/tickets/${t.id}`),
      }),
    );
    const started = Date.now();
    try {
      const res = await this.post(url, body, { 'content-type': 'application/json' });
      await this.log(
        'teams',
        ch.id,
        t.id,
        job.event,
        res.status,
        res.status >= 300 ? `HTTP ${res.status}` : null,
        started,
      );
      if (res.status >= 500 || res.status === 429) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      await this.log('teams', ch.id, t.id, job.event, null, (err as Error).message, started);
      throw err;
    }
  }

  private async log(
    kind: string,
    targetId: string,
    ticketId: string,
    event: string,
    status: number | null,
    error: string | null,
    started: number,
  ) {
    await this.prisma.webhookDelivery.create({
      data: {
        kind,
        targetId,
        ticketId,
        event,
        status,
        error: error?.slice(0, 500) ?? null,
        durationMs: Date.now() - started,
      },
    });
  }
}
