import { Inject, Injectable, Logger } from '@nestjs/common';
import { OpenStates } from '@mesa/shared';
import { Prisma, type MessagingChannel } from '@prisma/client';
import { AttachmentsService } from '../../attachments/attachments.service';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { SECRETS } from '../../config/config.module';
import type { FileSecretsProvider } from '../../config/secrets';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../settings/settings.service';
import { TicketService, type NewArticle } from '../../tickets/ticket.service';
import { TRIAGE_GROUP_ID } from '../email/ingest.service';
import { PhoneService } from '../phone/phone.service';
import { TwilioSmsClient, WhatsAppClient } from './clients';
import type { DeliveryReceipt, InboundMessage } from './providers';

const RECEIPT_RANK: Record<string, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
};

/**
 * WhatsApp Business and SMS channels. Inbound messages become tickets (or
 * articles of the contact's recent ticket on the same channel); unknown
 * numbers go to the triage group without a customer, as unverified e-mail
 * does. Agents' replies are sent by the jobs service.
 */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketService,
    private readonly phone: PhoneService,
    private readonly attachments: AttachmentsService,
    private readonly settings: SettingsService,
    @Inject(SECRETS) private readonly secrets: FileSecretsProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async whatsapp(): Promise<WhatsAppClient> {
    const token = this.secrets.get('whatsapp_access_token');
    if (!token) throw new Error('WhatsApp is not configured');
    return new WhatsAppClient(token, (await this.settings.get('messaging')).whatsappApiVersion);
  }

  async twilio(): Promise<TwilioSmsClient> {
    const token = this.secrets.get('twilio_auth_token');
    const sid = (await this.settings.get('messaging')).twilioAccountSid;
    if (!token || !sid) throw new Error('Twilio SMS is not configured');
    return new TwilioSmsClient(sid, token);
  }

  /** Returns false when the message was already processed or has no channel. */
  async ingest(m: InboundMessage): Promise<boolean> {
    const channel = await this.prisma.messagingChannel.findUnique({
      where: { kind_providerId: { kind: m.kind, providerId: m.providerId } },
    });
    if (!channel?.active) {
      this.logger.warn(`${m.kind} message for an unknown number ${m.providerId}`);
      return false;
    }
    if (await this.prisma.article.findUnique({ where: { externalId: m.externalId } })) return false;

    const customer = (await this.phone.customersByNumber(m.from))[0] ?? null;
    const { attachmentIds, notes } = await this.media(m);
    const body = [m.text, ...notes].filter(Boolean).join('\n') || '—';
    const article: NewArticle = {
      type: m.kind,
      sender: 'customer',
      internal: false,
      body,
      isHtml: false,
      from: m.from,
      to: [channel.displayNumber],
      externalId: m.externalId,
      attachmentIds,
      attachmentOwnerId: null,
    };
    try {
      const existing = await this.openConversation(channel, m.from, customer?.id ?? null);
      if (existing) {
        await this.tickets.addArticleCore(await this.tickets.loadForRules(existing), article, {
          actorId: null,
        });
      } else {
        const who = m.name ? `${m.name} (${m.from})` : m.from;
        await this.tickets.createCore(
          {
            title: (
              m.text.split('\n')[0] || `${m.kind === 'whatsapp' ? 'WhatsApp' : 'SMS'} de ${who}`
            ).slice(0, 120),
            groupId: customer ? channel.groupId : TRIAGE_GROUP_ID,
            state: 'new',
            channel: m.kind,
            customerId: customer?.id ?? null,
            unverifiedFrom: customer ? null : who.slice(0, 254),
            article,
          },
          { actorId: null },
        );
      }
    } catch (err) {
      // Two deliveries of the same message racing: the unique external id wins once.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false;
      throw err;
    }
    return true;
  }

  /** The contact's open (or recently updated) ticket on this channel. */
  private async openConversation(
    channel: MessagingChannel,
    from: string,
    customerId: string | null,
  ) {
    const days = (await this.settings.get('messaging')).reopenDays;
    const since = new Date(Date.now() - days * 86_400_000);
    const t = await this.prisma.ticket.findFirst({
      where: {
        channel: channel.kind,
        state: { not: 'merged' },
        ...(customerId ? { customerId } : { customerId: null, unverifiedFrom: { contains: from } }),
        OR: [{ state: { in: [...OpenStates] } }, { updatedAt: { gte: since } }],
        articles: { some: { type: channel.kind, toAddresses: channel.displayNumber } },
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    return t?.id ?? null;
  }

  /** Downloads WhatsApp media into scanned attachments; failures become a note in the text. */
  private async media(m: InboundMessage) {
    const attachmentIds: string[] = [];
    const notes: string[] = [];
    for (const item of m.media.slice(0, 5)) {
      try {
        const file = await (
          await this.whatsapp()
        ).download(item.id, this.config.ATTACHMENT_MAX_MB * 1024 * 1024);
        const ext =
          item.mimeType
            .split('/')[1]
            ?.replace(/[^a-z0-9]/g, '')
            .slice(0, 8) ?? 'bin';
        const stored = await this.attachments.store({
          buffer: file.buffer,
          filename: item.filename ?? `whatsapp-${item.id.slice(-8)}.${ext}`,
          uploadedById: null,
        });
        if (stored.ok) attachmentIds.push(stored.attachment.id);
        else notes.push(`[Adjunto rechazado: ${stored.filename} (${stored.reason})]`);
      } catch (err) {
        this.logger.warn(`WhatsApp media ${item.id}: ${(err as Error).message}`);
        notes.push('[No se pudo descargar un adjunto de WhatsApp]');
      }
    }
    return { attachmentIds, notes };
  }

  /** Applies a delivery receipt; states only move forward (read never goes back to delivered). */
  async receipt(r: DeliveryReceipt): Promise<void> {
    const a = await this.prisma.article.findUnique({
      where: { externalId: r.externalId },
      select: { id: true, deliveryStatus: true },
    });
    if (!a) return;
    if ((RECEIPT_RANK[r.status] ?? 0) <= (RECEIPT_RANK[a.deliveryStatus ?? 'queued'] ?? 0)) return;
    await this.prisma.article.update({
      where: { id: a.id },
      data: { deliveryStatus: r.status, deliveryError: r.error?.slice(0, 500) ?? null },
    });
  }

  /** Jobs service: sends an agent's WhatsApp / SMS article. */
  async sendArticle(articleId: string, finalAttempt: boolean): Promise<void> {
    const a = await this.prisma.article.findUnique({ where: { id: articleId } });
    if (
      !a ||
      (a.type !== 'whatsapp' && a.type !== 'sms') ||
      a.internal ||
      a.sender === 'customer' ||
      (a.deliveryStatus && a.deliveryStatus !== 'queued')
    )
      return;
    try {
      const channel = await this.prisma.messagingChannel.findFirst({
        where: { kind: a.type, displayNumber: a.fromAddress ?? '', active: true },
      });
      const to = a.toAddresses ?? '';
      if (!channel || !to) throw new Error('No active channel for this conversation');
      const externalId =
        a.type === 'whatsapp'
          ? await (await this.whatsapp()).sendText(channel.providerId, to, a.bodyText)
          : await (
              await this.twilio()
            ).send(
              channel.providerId,
              to,
              a.bodyText,
              `${this.config.PUBLIC_SCHEME}://${this.config.PORTAL_HOST}/hooks/twilio/sms`,
            );
      await this.prisma.article.update({
        where: { id: a.id },
        data: { deliveryStatus: 'sent', externalId, deliveryError: null },
      });
    } catch (err) {
      const msg = (err as Error).message.slice(0, 500);
      await this.prisma.article.update({
        where: { id: a.id },
        data: { deliveryError: msg, ...(finalAttempt ? { deliveryStatus: 'failed' } : {}) },
      });
      throw new Error(msg);
    }
  }
}
