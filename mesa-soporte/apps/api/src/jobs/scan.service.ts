import { Inject, Injectable, Logger } from '@nestjs/common';
import { AttachmentsService } from '../attachments/attachments.service';
import { sniff } from '../attachments/sniff';
import { APP_CONFIG, AppConfig } from '../config/config';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { detectFile } from '../privacy/sensitive';
import { STORAGE, type StorageProvider } from '../storage/storage.provider';
import { TicketService } from '../tickets/ticket.service';
import { clamScan } from './clamav';

/**
 * Antivirus and sensitive-data scan of one attachment. Infected files stay
 * in storage (quarantine) but are never served; owner and admins are told.
 */
@Injectable()
export class ScanService {
  private readonly logger = new Logger(ScanService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly attachments: AttachmentsService,
    private readonly notifications: NotificationsService,
    private readonly tickets: TicketService,
    @Inject(STORAGE) private readonly storage: StorageProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Overridable in tests. */
  virusScan(data: Buffer) {
    return clamScan(this.config.CLAMAV_HOST!, this.config.CLAMAV_PORT, data);
  }

  async scan(attachmentId: string, finalAttempt: boolean): Promise<void> {
    const a = await this.prisma.attachment.findUnique({ where: { id: attachmentId } });
    if (!a || a.deletedAt || a.scanStatus !== 'pending') return;
    const chunks: Buffer[] = [];
    for await (const c of await this.storage.getObject(a.storageKey)) chunks.push(c as Buffer);
    const data = Buffer.concat(chunks);

    let status: 'clean' | 'infected' | 'skipped' | 'error';
    let detail: string | null = null;
    if (this.config.CLAMAV_HOST) {
      try {
        const r = await this.virusScan(data);
        status = r.status;
        if (r.status === 'infected') detail = r.signature;
      } catch (err) {
        if (!finalAttempt) throw err;
        status = 'error';
        detail = (err as Error).message.slice(0, 200);
      }
    } else {
      // Without clamd nothing is downloadable in production (fail closed).
      status = this.config.NODE_ENV === 'production' ? 'error' : 'skipped';
      detail = 'clamd not configured';
    }

    let sensitive = false;
    if (status !== 'infected') {
      const kind = sniff(data, a.filename);
      try {
        sensitive = kind.ok && detectFile(data, kind.scanKind).length > 0;
      } catch (err) {
        this.logger.warn(`sensitive scan failed for ${a.id}: ${(err as Error).message}`);
      }
    }
    await this.prisma.attachment.update({
      where: { id: a.id },
      data: { scanStatus: status, scanDetail: detail, sensitiveData: sensitive },
    });
    if (!a.ticketId) return;
    if (sensitive) await this.attachments.refreshTicketFlag(a.ticketId);
    if (status === 'infected') await this.reportInfected(a.ticketId, a.filename, detail);
  }

  private async reportInfected(ticketId: string, filename: string, signature: string | null) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) return;
    await this.tickets.addArticleCore(
      { ...ticket, tags: [] },
      {
        type: 'note',
        sender: 'system',
        internal: true,
        body: `Adjunto en cuarentena: ${filename} (${signature ?? 'malware'}). No se puede descargar.`,
        isHtml: false,
      },
      { actorId: null, depth: 3 },
    );
    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN', status: 'ACTIVE' },
      select: { id: true },
    });
    const recipients = [
      ...(ticket.ownerId
        ? [ticket.ownerId]
        : await this.notifications.groupMembers(ticket.groupId)),
      ...admins.map((a) => a.id),
    ];
    await this.notifications.notify(
      recipients,
      ticket,
      'trigger',
      `Adjunto infectado en #${ticket.number}: ${filename}`,
    );
  }
}
