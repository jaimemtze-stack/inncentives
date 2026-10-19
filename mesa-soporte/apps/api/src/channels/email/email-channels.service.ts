import { Inject, Injectable, Logger } from '@nestjs/common';
import type { EmailChannel } from '@prisma/client';
import MailComposer from 'nodemailer/lib/mail-composer';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { SECRETS } from '../../config/config.module';
import type { FileSecretsProvider } from '../../config/secrets';
import { PrismaService } from '../../prisma/prisma.service';
import { STORAGE, type StorageProvider } from '../../storage/storage.provider';
import { renderTemplate } from '../../tickets/render';
import { escapeHtml, htmlToText } from '../../tickets/sanitize';
import { TicketService } from '../../tickets/ticket.service';
import { adapterFor, type MailboxAdapter } from './adapters';
import { MailIngestService } from './ingest.service';
import { assertHeaderSafe } from './mail-rules';

const FETCH_BATCH = 25;

/** Thrown while attachments are still being scanned: the job retries later. */
export class NotReadyError extends Error {}

/**
 * Mailbox polling and outbound delivery. Runs in the jobs process; the API
 * only queues article ids.
 */
@Injectable()
export class EmailChannelsService {
  private readonly logger = new Logger(EmailChannelsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingest: MailIngestService,
    private readonly tickets: TicketService,
    @Inject(SECRETS) private readonly secrets: FileSecretsProvider,
    @Inject(STORAGE) private readonly storage: StorageProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Overridable in tests. */
  adapter(channel: EmailChannel): MailboxAdapter {
    return adapterFor(
      channel,
      channel.secretName ? this.secrets.get(channel.secretName) : undefined,
      this.config.NODE_ENV === 'production',
    );
  }

  async fetchAll(): Promise<void> {
    const channels = await this.prisma.emailChannel.findMany({ where: { active: true } });
    for (const ch of channels) {
      try {
        const n = await this.adapter(ch).fetch(async (raw) => {
          await this.ingest.ingest(ch, raw);
        }, FETCH_BATCH);
        await this.prisma.emailChannel.update({
          where: { id: ch.id },
          data: { lastFetchAt: new Date(), lastError: null },
        });
        if (n) this.logger.log(`channel ${ch.name}: ${n} message(s)`);
      } catch (err) {
        const msg = (err as Error).message.slice(0, 500);
        this.logger.error(`channel ${ch.name} fetch failed: ${msg}`);
        await this.prisma.emailChannel.update({ where: { id: ch.id }, data: { lastError: msg } });
      }
    }
  }

  /** Builds and sends the e-mail of an outbound article. */
  async sendArticle(articleId: string, finalAttempt: boolean): Promise<void> {
    const article = await this.prisma.article.findUnique({
      where: { id: articleId },
      include: {
        attachments: { where: { deletedAt: null } },
        ticket: { include: { group: { include: { signature: true } } } },
      },
    });
    if (
      !article ||
      article.deliveryStatus === 'sent' ||
      article.type !== 'email' ||
      article.internal
    )
      return;
    const ticket = article.ticket;
    const channel =
      (await this.prisma.emailChannel.findFirst({
        where: { active: true, groupId: ticket.groupId },
      })) ??
      (await this.prisma.emailChannel.findFirst({
        where: { active: true },
        orderBy: { createdAt: 'asc' },
      }));
    try {
      if (!channel) throw new Error('No active e-mail channel');
      if (article.attachments.some((a) => a.scanStatus === 'pending'))
        throw new NotReadyError('Attachments not scanned yet');
      const fromAddress = assertHeaderSafe(ticket.group.emailAddress ?? channel.address);
      const domain = fromAddress.split('@')[1] ?? 'localhost';
      const messageId = `<${article.id}@${domain}>`;
      const to = (article.toAddresses ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map(assertHeaderSafe);
      const cc = (article.ccAddresses ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map(assertHeaderSafe);
      if (!to.length) throw new Error('No recipients');
      const previous = await this.prisma.article.findFirst({
        where: { ticketId: ticket.id, messageId: { not: null }, id: { not: article.id } },
        orderBy: { createdAt: 'desc' },
      });
      const references = [previous?.references, previous?.messageId]
        .filter(Boolean)
        .join(' ')
        .split(/\s+/)
        .filter(Boolean)
        .slice(-20);

      let html = article.bodyHtml;
      if (ticket.group.signature?.active && article.sender === 'agent') {
        const values = await this.tickets.templateValues(ticket, article.createdById);
        const sig = renderTemplate(ticket.group.signature.body, values, false);
        // nosemgrep: javascript.lang.security.html-in-template-string.html-in-template-string -- value escaped
        html += `<br><div class="signature">${escapeHtml(sig).replace(/\n/g, '<br>')}</div>`;
      }
      const files = [];
      for (const a of article.attachments.filter(
        (x) => x.scanStatus === 'clean' || x.scanStatus === 'skipped',
      )) {
        const chunks: Buffer[] = [];
        for await (const c of await this.storage.getObject(a.storageKey)) chunks.push(c as Buffer);
        files.push({
          filename: a.filename,
          content: Buffer.concat(chunks),
          contentType: a.contentType,
          cid: a.contentId ?? undefined,
        });
      }
      const mime = await new MailComposer({
        from: { name: assertHeaderSafe(this.config.APP_NAME), address: fromAddress },
        to,
        cc,
        subject: assertHeaderSafe(article.subject ?? ticket.title),
        messageId,
        inReplyTo: previous?.messageId ?? undefined,
        references: references.length ? references : undefined,
        html,
        text: htmlToText(html),
        attachments: files,
        headers: {
          'X-Loop': 'mesa-soporte',
          'X-Auto-Response-Suppress': 'OOF, AutoReply',
          ...(article.autoGenerated ? { 'Auto-Submitted': 'auto-replied' } : {}),
        },
      })
        .compile()
        .build();
      await this.adapter(channel).send(mime, { from: fromAddress, to: [...to, ...cc] });
      await this.prisma.article.update({
        where: { id: article.id },
        data: {
          deliveryStatus: 'sent',
          deliveryError: null,
          messageId,
          fromAddress,
          references: references.join(' ') || null,
        },
      });
    } catch (err) {
      const msg = (err as Error).message.slice(0, 500);
      await this.prisma.article.update({
        where: { id: article.id },
        data: { deliveryStatus: finalAttempt ? 'failed' : 'retrying', deliveryError: msg },
      });
      throw err;
    }
  }
}
