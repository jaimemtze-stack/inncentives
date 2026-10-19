import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Attachment } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import sharp from 'sharp';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, AppConfig } from '../config/config';
import { AppError } from '../common/errors';
import type { AuthenticatedUser } from '../common/request-context';
import { DomainEvents } from '../events/ticket-events';
import { PrismaService } from '../prisma/prisma.service';
import { detectText, redactText } from '../privacy/sensitive';
import { JobQueuesService } from '../queue/job-queues.service';
import { STORAGE, type StorageProvider } from '../storage/storage.provider';
import { TicketAccessService } from '../tickets/access.service';
import { htmlToText, sanitizeHtml } from '../tickets/sanitize';
import { safeFilename, sniff } from './sniff';

export interface StoreInput {
  buffer: Buffer;
  filename: string;
  uploadedById: string | null;
  ticketId?: string | null;
  inline?: boolean;
  contentId?: string | null;
}

export type StoreResult =
  | { ok: true; attachment: Attachment }
  | { ok: false; filename: string; reason: string };

/** Attachments that may be handed out: scanned clean (or scanning disabled outside production). */
const DOWNLOADABLE = ['clean', 'skipped'];
const MAX_STAGED_PER_USER = 50;

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TicketAccessService,
    private readonly queues: JobQueuesService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    @Inject(STORAGE) private readonly storage: StorageProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get maxBytes(): number {
    return this.config.ATTACHMENT_MAX_MB * 1024 * 1024;
  }

  /**
   * Validates (size, allow-list, magic bytes), stores the object under a
   * generated key and queues the antivirus / sensitive-data scan.
   */
  async store(input: StoreInput): Promise<StoreResult> {
    const filename = safeFilename(input.filename);
    if (input.buffer.length > this.maxBytes) return { ok: false, filename, reason: 'too_large' };
    const s = sniff(input.buffer, filename);
    if (!s.ok) return { ok: false, filename, reason: s.reason };
    const now = new Date();
    const key = `att/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}`;
    await this.storage.putObject({
      key,
      body: input.buffer,
      contentType: s.contentType,
      contentLength: input.buffer.length,
    });
    const attachment = await this.prisma.attachment.create({
      data: {
        ticketId: input.ticketId ?? null,
        storageKey: key,
        filename,
        contentType: s.contentType,
        size: input.buffer.length,
        sha256: createHash('sha256').update(input.buffer).digest('hex'),
        inline: (input.inline ?? false) && s.image,
        contentId: input.contentId?.slice(0, 250) ?? null,
        uploadedById: input.uploadedById,
      },
    });
    await this.queues.scan(attachment.id);
    return { ok: true, attachment };
  }

  /** Staged upload from the web UI, bound to the uploader until attached to an article. */
  async upload(actor: AuthenticatedUser, buffer: Buffer, filename: string) {
    const staged = await this.prisma.attachment.count({
      where: { uploadedById: actor.id, articleId: null, deletedAt: null },
    });
    if (staged >= MAX_STAGED_PER_USER)
      throw new AppError('rate_limited', 'Too many pending uploads.', undefined, 429);
    const res = await this.store({ buffer, filename, uploadedById: actor.id });
    if (!res.ok) {
      throw new AppError('validation_failed', 'File not accepted.', [
        { path: 'file', code: res.reason },
      ]);
    }
    const a = res.attachment;
    return {
      id: a.id,
      filename: a.filename,
      size: a.size,
      contentType: a.contentType,
      scanStatus: a.scanStatus,
    };
  }

  /** Loads an attachment the actor may read, applying the ticket policy. */
  async loadReadable(actor: AuthenticatedUser, id: string) {
    const a = await this.prisma.attachment.findUnique({
      where: { id },
      include: { article: true },
    });
    if (!a || a.deletedAt) throw new AppError('not_found');
    if (!a.ticketId) {
      if (a.uploadedById !== actor.id) throw new AppError('not_found');
      return a;
    }
    await this.access.load(actor, a.ticketId, 'read');
    if (!this.access.isStaff(actor) && a.article?.internal) throw new AppError('not_found');
    return a;
  }

  private assertDownloadable(a: Attachment) {
    if (!DOWNLOADABLE.includes(a.scanStatus)) {
      throw new AppError(
        'conflict',
        a.scanStatus === 'infected'
          ? 'The file is quarantined.'
          : 'The file has not been scanned yet.',
        { scanStatus: a.scanStatus },
      );
    }
  }

  /** Short-lived signed URL, served as attachment from the storage host (no cookies). */
  async downloadUrl(req: FastifyRequest, id: string) {
    const actor = req.auth!.user;
    const a = await this.loadReadable(actor, id);
    this.assertDownloadable(a);
    const url = await this.storage.createDownloadUrl(a.storageKey, 60, a.filename);
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'attachment.downloaded',
      targetType: 'attachment',
      targetId: a.id,
      data: { ticketId: a.ticketId, filename: a.filename },
    });
    return { url, expiresInSeconds: 60 };
  }

  /** Image preview, re-encoded server-side (drops EXIF and anything hidden in the file). */
  async inlineImage(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<{ body: Buffer; contentType: string }> {
    const a = await this.loadReadable(actor, id);
    this.assertDownloadable(a);
    if (!a.contentType.startsWith('image/')) throw new AppError('not_found');
    const stream = await this.storage.getObject(a.storageKey);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    const body = await sharp(Buffer.concat(chunks), {
      limitInputPixels: 40_000_000,
      animated: false,
    })
      .rotate()
      .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
    return { body, contentType: 'image/png' };
  }

  /** Agents remove an attachment (e.g. payroll data sent by mistake). Audited. */
  async remove(req: FastifyRequest, id: string) {
    const actor = req.auth!.user;
    const a = await this.prisma.attachment.findUnique({ where: { id } });
    if (!a || a.deletedAt) throw new AppError('not_found');
    if (a.ticketId) await this.access.load(actor, a.ticketId, 'change');
    else if (a.uploadedById !== actor.id) throw new AppError('not_found');
    await this.prisma.$transaction(async (tx) => {
      await tx.attachment.update({ where: { id }, data: { deletedAt: new Date() } });
      if (a.ticketId) {
        await tx.ticketHistory.create({
          data: {
            ticketId: a.ticketId,
            actorId: actor.id,
            field: 'attachment_deleted',
            oldValue: a.filename,
          },
        });
      }
      await this.audit.record(
        {
          ...AuditService.fromRequest(req),
          action: 'attachment.deleted',
          targetType: 'attachment',
          targetId: id,
          data: { ticketId: a.ticketId, filename: a.filename, sensitiveData: a.sensitiveData },
        },
        tx,
      );
    });
    await this.storage.deleteObject(a.storageKey).catch(() => undefined);
    if (a.ticketId) await this.emitUpdate(a.ticketId, actor.id);
  }

  /** Replaces detected personal data in an article with a marker. Audited. */
  async redactArticle(req: FastifyRequest, articleId: string) {
    const actor = req.auth!.user;
    const article = await this.prisma.article.findUnique({ where: { id: articleId } });
    if (!article) throw new AppError('not_found');
    await this.access.load(actor, article.ticketId, 'change');
    const before = detectText(article.bodyText);
    const bodyHtml = sanitizeHtml(redactText(article.bodyHtml));
    const subject = article.subject ? redactText(article.subject) : null;
    await this.prisma.$transaction(async (tx) => {
      await tx.article.update({
        where: { id: articleId },
        data: {
          bodyHtml,
          bodyText: htmlToText(bodyHtml),
          subject,
          sensitiveData: false,
          redactedAt: new Date(),
        },
      });
      await tx.ticketHistory.create({
        data: {
          ticketId: article.ticketId,
          actorId: actor.id,
          field: 'article_redacted',
          newValue: articleId,
        },
      });
      await this.audit.record(
        {
          ...AuditService.fromRequest(req),
          action: 'article.redacted',
          targetType: 'article',
          targetId: articleId,
          data: { ticketId: article.ticketId, findings: before },
        },
        tx,
      );
    });
    await this.refreshTicketFlag(article.ticketId);
    await this.emitUpdate(article.ticketId, actor.id);
  }

  /** The ticket flag stays on while any article or live attachment is flagged. */
  async refreshTicketFlag(ticketId: string) {
    const [articles, files] = await Promise.all([
      this.prisma.article.count({ where: { ticketId, sensitiveData: true } }),
      this.prisma.attachment.count({ where: { ticketId, sensitiveData: true, deletedAt: null } }),
    ]);
    await this.prisma.ticket.update({
      where: { id: ticketId },
      data: { sensitiveData: articles + files > 0 },
    });
  }

  private async emitUpdate(ticketId: string, actorId: string) {
    const t = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!t) return;
    this.events.emit({
      type: 'ticket.updated',
      ticketId,
      groupId: t.groupId,
      customerId: t.customerId,
      organizationId: t.organizationId,
      actorId,
    });
  }
}
