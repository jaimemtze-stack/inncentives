import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { EmailChannel } from '@prisma/client';
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';
import { AttachmentsService } from '../../attachments/attachments.service';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../settings/settings.service';
import { textToHtml } from '../../tickets/sanitize';
import { TicketService, type NewArticle } from '../../tickets/ticket.service';
import {
  applyFilters,
  classifyInbound,
  senderAuthFromHeaders,
  threadIds,
  ticketNumberFromSubject,
  type FilterMatch,
  type FilterSet,
} from './mail-rules';

export type IngestOutcome =
  | { action: 'created' | 'appended'; ticketId: string }
  | { action: 'duplicate' | 'ignored' | 'bounce' | 'too_large' };

export const TRIAGE_GROUP_ID = '00000000-0000-4000-8000-000000000304';

interface ChannelConfig {
  /** Development only: accept senders without Authentication-Results. */
  allowUnauthenticated?: boolean;
}

function addresses(a: AddressObject | AddressObject[] | undefined): string[] {
  const list = Array.isArray(a) ? a : a ? [a] : [];
  return list
    .flatMap((x) => x.value)
    .map((v) => v.address?.toLowerCase())
    .filter((v): v is string => !!v && v.length <= 254);
}

/**
 * Turns an inbound e-mail into a ticket or article. Identity rules (4.2):
 * only registered, active senders whose mail passed SPF/DKIM/DMARC at a
 * trusted server are linked to a customer; everything else lands in the
 * triage group without auto-replies. Customers are never created from mail.
 */
@Injectable()
export class MailIngestService {
  private readonly logger = new Logger(MailIngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketService,
    private readonly attachments: AttachmentsService,
    private readonly settings: SettingsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async ingest(channel: EmailChannel, raw: Buffer): Promise<IngestOutcome> {
    if (raw.length > this.config.EMAIL_MAX_MB * 1024 * 1024) {
      this.logger.warn(
        `message over ${this.config.EMAIL_MAX_MB} MB skipped on channel ${channel.name}`,
      );
      return { action: 'too_large' };
    }
    const mail = await simpleParser(raw, { skipImageLinks: true, maxHtmlLengthToParse: 2_000_000 });
    const messageId = mail.messageId
      ? `<${mail.messageId.replace(/^<|>$/g, '')}>`.slice(0, 500)
      : null;
    const hash = createHash('sha256')
      .update(messageId ?? createHash('sha256').update(raw).digest('hex'))
      .digest('hex');
    const inserted = await this.prisma.inboundMessage.createMany({
      data: [{ messageIdHash: hash, channelId: channel.id }],
      skipDuplicates: true,
    });
    if (inserted.count === 0) return { action: 'duplicate' };

    const outcome = await this.process(channel, mail, messageId);
    if ('ticketId' in outcome) {
      await this.prisma.inboundMessage.update({
        where: { messageIdHash: hash },
        data: { ticketId: outcome.ticketId },
      });
    }
    return outcome;
  }

  private header(mail: ParsedMail) {
    return (name: string): string | undefined => {
      const v = mail.headers.get(name.toLowerCase());
      if (v === undefined || v === null) return undefined;
      if (typeof v === 'string') return v;
      if (Array.isArray(v)) return v.map(String).join(', ');
      if (typeof v === 'object' && 'text' in v) return String((v as { text: string }).text);
      if (typeof v === 'object' && 'value' in v) return String((v as { value: string }).value);
      return String(v);
    };
  }

  private async process(
    channel: EmailChannel,
    mail: ParsedMail,
    messageId: string | null,
  ): Promise<IngestOutcome> {
    const h = this.header(mail);
    const from = addresses(mail.from)[0];
    if (!from) return { action: 'ignored' };
    const ourAddresses = new Set(
      (await this.prisma.emailChannel.findMany({ select: { address: true } })).map((c) =>
        c.address.toLowerCase(),
      ),
    );
    // Our own outgoing mail coming back (loops, misconfigured forwards).
    if (ourAddresses.has(from) || (h('x-loop') ?? '').includes('mesa-soporte'))
      return { action: 'ignored' };

    const contentType = String(mail.headers.get('content-type') ? h('content-type') : '');
    const cls = classifyInbound(h, from, contentType);
    const refs = threadIds(mail.inReplyTo, mail.references);
    if (cls.bounce) {
      await this.markBounce(refs, mail);
      return { action: 'bounce' };
    }

    const filters = await this.prisma.postmasterFilter.findMany({
      where: { active: true },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    });
    const set: FilterSet = applyFilters(
      filters.map((f) => ({
        match: f.match as unknown as FilterMatch[],
        set: f.set as unknown as FilterSet,
      })),
      (n) => (n === 'from' ? from : h(n)),
    );
    if (set.ignore) return { action: 'ignored' };

    const authHeaders = ([] as string[]).concat(
      ...mail.headerLines
        .filter((l) => l.key === 'authentication-results')
        .map((l) => l.line.replace(/^[^:]*:\s*/, '')),
    );
    const senderAuth = senderAuthFromHeaders(authHeaders, channel.trustedAuthServ);
    const cfg = (channel.config ?? {}) as ChannelConfig;
    const authOk =
      senderAuth === 'pass' ||
      (cfg.allowUnauthenticated === true &&
        this.config.NODE_ENV !== 'production' &&
        senderAuth !== 'fail');
    const user = await this.prisma.user.findUnique({ where: { email: from } });
    const verifiedUser = user && user.status === 'ACTIVE' && authOk && !set.spam ? user : null;

    const hook = await this.settings.get('ticket_hook');
    const subject = (mail.subject ?? '').trim().slice(0, 500);
    const html = mail.html ? mail.html : textToHtml(mail.text ?? '');
    const article: NewArticle = {
      type: 'email',
      sender: verifiedUser && verifiedUser.role !== 'CUSTOMER' ? 'agent' : 'customer',
      internal: false,
      body: html || '<p></p>',
      isHtml: true,
      subject: subject || null,
      from,
      to: addresses(mail.to),
      cc: addresses(mail.cc),
      messageId,
      inReplyTo: mail.inReplyTo?.slice(0, 500) ?? null,
      references: refs.join(' ') || null,
      senderAuth,
      autoGenerated: cls.autoGenerated || !!set.spam,
      attachmentOwnerId: null,
    };

    // Existing thread: by our Message-IDs, else by the ticket number in the subject.
    let ticket = refs.length
      ? await this.prisma.ticket.findFirst({
          where: { articles: { some: { messageId: { in: refs } } }, state: { not: 'merged' } },
          include: { tags: true, group: true },
        })
      : null;
    if (!ticket) {
      const number = ticketNumberFromSubject(subject, hook);
      if (number)
        ticket = await this.prisma.ticket.findUnique({
          where: { number },
          include: { tags: true, group: true },
        });
    }
    if (ticket?.state === 'merged' && ticket.mergedIntoId) {
      ticket = await this.prisma.ticket.findUnique({
        where: { id: ticket.mergedIntoId },
        include: { tags: true, group: true },
      });
    }

    if (ticket && verifiedUser && (await this.senderBelongs(verifiedUser, ticket))) {
      const reopenBlocked = ticket.state === 'closed' && ticket.group.followUp === 'new_ticket';
      if (!reopenBlocked) {
        article.attachmentIds = await this.storeAttachments(mail, ticket.id);
        await this.tickets.addArticleCore(ticket, article, {
          actorId: verifiedUser.id,
          inboundAutoGenerated: article.autoGenerated,
        });
        if (set.tags?.length) await this.tickets.changeTags(ticket.id, set.tags, [], null);
        return { action: 'appended', ticketId: ticket.id };
      }
    }

    const customer = verifiedUser?.role === 'CUSTOMER' ? verifiedUser : null;
    article.attachmentIds = await this.storeAttachments(mail, null);
    const groupId = customer ? (set.groupId ?? channel.groupId) : TRIAGE_GROUP_ID;
    const id = await this.tickets.createCore(
      {
        title: subject || '(sin asunto)',
        groupId,
        priorityId: set.priorityId,
        state: 'new',
        channel: 'email',
        customerId: customer?.id ?? null,
        unverifiedFrom: customer ? null : from,
        tags: [
          ...(set.tags ?? []),
          ...(set.spam ? ['spam'] : []),
          ...(customer ? [] : ['por-verificar']),
        ],
        article: { ...article, sender: 'customer' },
      },
      // Unverified senders never get automatic replies (no information leak).
      { actorId: customer?.id ?? null, inboundAutoGenerated: article.autoGenerated || !customer },
    );
    if (ticket && customer) {
      await this.prisma.ticketLink
        .create({ data: { sourceId: id, targetId: ticket.id, type: 'related' } })
        .catch(() => undefined);
    }
    return { action: 'created', ticketId: id };
  }

  /** A follow-up is accepted from the ticket customer, a colleague with organization access, or staff. */
  private async senderBelongs(
    user: { id: string; role: string; organizationId: string; orgTicketAccess: boolean },
    ticket: {
      customerId: string | null;
      organizationId: string | null;
      groupId: string;
      ownerId: string | null;
    },
  ): Promise<boolean> {
    if (user.role === 'CUSTOMER') {
      return (
        ticket.customerId === user.id ||
        (user.orgTicketAccess && ticket.organizationId === user.organizationId)
      );
    }
    if (user.role === 'ADMIN' || ticket.ownerId === user.id) return true;
    const access = await this.prisma.groupAccess.findUnique({
      where: { userId_groupId: { userId: user.id, groupId: ticket.groupId } },
    });
    return !!access?.levels.some((l) => l === 'full' || l === 'change');
  }

  private async storeAttachments(mail: ParsedMail, ticketId: string | null): Promise<string[]> {
    const ids: string[] = [];
    for (const a of mail.attachments.slice(0, 50)) {
      const res = await this.attachments.store({
        buffer: a.content,
        filename: a.filename ?? (a.contentType.startsWith('image/') ? 'imagen.png' : 'adjunto'),
        uploadedById: null,
        ticketId,
        inline: a.contentDisposition === 'inline' || !!a.cid,
        contentId: a.cid ?? null,
      });
      if (res.ok) ids.push(res.attachment.id);
      else this.logger.warn(`attachment rejected (${res.reason})`);
    }
    return ids;
  }

  /** Marks the outbound article a DSN refers to as failed. */
  private async markBounce(refs: string[], mail: ParsedMail) {
    const embedded =
      (mail.text ?? '')
        .match(/Message-ID:\s*(<[^<>\s]{1,250}>)/gi)
        ?.map((m) => m.replace(/^Message-ID:\s*/i, '')) ?? [];
    const ids = [...refs, ...embedded];
    if (!ids.length) return;
    await this.prisma.article.updateMany({
      where: { messageId: { in: ids }, sender: { in: ['agent', 'system'] } },
      data: { deliveryStatus: 'failed', deliveryError: 'Rebote del servidor de correo (DSN).' },
    });
  }
}
