import { Inject, Injectable } from '@nestjs/common';
import { OpenStates } from '@mesa/shared';
import type Redis from 'ioredis';
import { AppError } from '../../common/errors';
import type { AuthenticatedUser } from '../../common/request-context';
import { SECRETS } from '../../config/config.module';
import type { FileSecretsProvider } from '../../config/secrets';
import { DomainEvents } from '../../events/ticket-events';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS } from '../../redis/redis.module';
import { TicketAccessService } from '../../tickets/access.service';
import { TwilioTelephonyProvider, asParams, verifyTwilio } from '../twilio/twilio';
import { GenericTelephonyProvider, normalizePhone, phoneDigits, type CtiEvent } from './phone';
import { verifySignature } from './signature';

@Injectable()
export class PhoneService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TicketAccessService,
    private readonly events: DomainEvents,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(SECRETS) private readonly secrets: FileSecretsProvider,
  ) {}

  private async customersByNumber(number: string) {
    const digits = phoneDigits(number);
    if (digits.length < 7) return [];
    return this.prisma.user.findMany({
      where: {
        role: 'CUSTOMER',
        status: 'ACTIVE',
        OR: [{ phone: { endsWith: digits } }, { mobile: { endsWith: digits } }],
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        mobile: true,
        organization: { select: { id: true, name: true } },
      },
      take: 10,
    });
  }

  /** Caller lookup for agents: matching customers and their open tickets the agent can see. */
  async lookup(actor: AuthenticatedUser, number: string) {
    const customers = await this.customersByNumber(number);
    const scope = await this.access.scope(actor, 'read');
    const tickets = customers.length
      ? await this.prisma.ticket.findMany({
          where: {
            AND: [
              scope,
              { customerId: { in: customers.map((c) => c.id) } },
              { state: { in: [...OpenStates] } },
            ],
          },
          select: {
            id: true,
            number: true,
            title: true,
            state: true,
            customerId: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: 'desc' },
          take: 20,
        })
      : [];
    return { normalized: normalizePhone(number), customers, tickets };
  }

  async recentCalls(actor: AuthenticatedUser) {
    void actor;
    return this.prisma.callLog.findMany({ orderBy: { startedAt: 'desc' }, take: 50 });
  }

  /**
   * Generic CTI webhook. Authenticated by HMAC over the raw body with a
   * timestamp (5 minutes tolerance); each signature is accepted once.
   */
  async handleWebhook(
    signature: string | undefined,
    rawBody: Buffer | undefined,
    payload: unknown,
  ): Promise<void> {
    const secret = this.secrets.get('cti_webhook_secret');
    if (!secret || !rawBody) throw new AppError('unauthenticated');
    const v = verifySignature(secret, signature, rawBody);
    if (!v.ok) throw new AppError('unauthenticated');
    const fresh = await this.redis.set(`cti:sig:${v.mac}`, '1', 'EX', 600, 'NX');
    if (fresh !== 'OK') throw new AppError('conflict', 'Replayed webhook.');
    let event: CtiEvent;
    try {
      event = GenericTelephonyProvider.parse(payload);
    } catch {
      throw new AppError('validation_failed');
    }
    await this.apply(event);
  }

  /**
   * Twilio Programmable Voice status callback, authenticated by
   * X-Twilio-Signature over the public URL and the form parameters. Events
   * are idempotent (upsert by CallSid), so a replay changes nothing.
   */
  async handleTwilioVoice(url: string, signature: string | undefined, body: unknown) {
    const token = this.secrets.get('twilio_auth_token');
    const params = asParams(body);
    if (!token || !params || !verifyTwilio(token, url, params, signature))
      throw new AppError('unauthenticated');
    const agent = new URL(url).searchParams.get('agent') ?? undefined;
    let event: CtiEvent;
    try {
      event = TwilioTelephonyProvider.parse(params, agent);
    } catch {
      throw new AppError('validation_failed');
    }
    await this.apply(event);
  }

  private async apply(e: CtiEvent) {
    const external = e.direction === 'in' ? e.from : e.to;
    const agent = e.user
      ? await this.prisma.user.findFirst({
          where: {
            email: e.user.toLowerCase(),
            status: 'ACTIVE',
            role: { in: ['ADMIN', 'AGENT'] },
          },
        })
      : null;
    const customer = (await this.customersByNumber(external))[0] ?? null;
    const now = new Date();
    const state = e.event === 'newCall' ? 'ringing' : e.event === 'answer' ? 'answered' : 'ended';
    const log = await this.prisma.callLog.upsert({
      where: { callId: e.callId },
      create: {
        callId: e.callId,
        direction: e.direction,
        fromNumber: e.from,
        toNumber: e.to,
        state,
        userId: agent?.id ?? null,
        customerId: customer?.id ?? null,
        answeredAt: e.event === 'answer' ? now : null,
        endedAt: e.event === 'hangup' ? now : null,
        cause: e.cause ?? null,
      },
      update: {
        state,
        ...(agent ? { userId: agent.id } : {}),
        ...(e.event === 'answer' ? { answeredAt: now } : {}),
        ...(e.event === 'hangup' ? { endedAt: now, cause: e.cause ?? null } : {}),
      },
    });
    this.events.emit({
      type: 'call.updated',
      callId: log.callId,
      state,
      direction: log.direction,
      number: external,
      customerId: log.customerId,
      userId: log.userId,
    });
  }
}
