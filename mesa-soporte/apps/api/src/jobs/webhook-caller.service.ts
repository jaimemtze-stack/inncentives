import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import type { WebhookJob } from '../queue/job-queues.service';
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
    try {
      const res = await this.post(hook.url, body, headers);
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
      await this.prisma.webhook.update({
        where: { id: hook.id },
        data: { lastError: (err as Error).message.slice(0, 500), lastCalledAt: new Date() },
      });
      throw err;
    }
  }
}
