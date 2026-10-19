import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type ChatSession } from '@prisma/client';
import type Redis from 'ioredis';
import { AppError } from '../common/errors';
import type { AuthenticatedUser } from '../common/request-context';
import { DomainEvents } from '../events/ticket-events';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';
import { SettingsService } from '../settings/settings.service';
import { TicketAccessService } from '../tickets/access.service';
import { TicketService } from '../tickets/ticket.service';

/** Agents send a heartbeat every minute while "available for chat". */
const AVAILABILITY_TTL_MS = 90_000;
const AGENTS_KEY = 'chat:agents';

/**
 * Live chat (portal and the Inncentives widget). A chat is a ticket of
 * channel "chat" whose messages are its articles, so history, SLA, search
 * and permissions are the ticket's. A session only adds the queue state:
 * waiting → active (accepted by an agent) → ended.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketService,
    private readonly access: TicketAccessService,
    private readonly settings: SettingsService,
    private readonly events: DomainEvents,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private async config() {
    return this.settings.get('chat');
  }

  /** Agents with change access to the chat group who sent a heartbeat recently. */
  private async availableAgents(groupId: string): Promise<string[]> {
    const now = Date.now();
    await this.redis.zremrangebyscore(AGENTS_KEY, 0, now);
    const ids = await this.redis.zrange(AGENTS_KEY, 0, -1);
    if (!ids.length) return [];
    const users = await this.prisma.user.findMany({
      where: {
        id: { in: ids },
        status: 'ACTIVE',
        OR: [
          { role: 'ADMIN' },
          { groupAccess: { some: { groupId, levels: { hasSome: ['full', 'change'] } } } },
        ],
      },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  private async assertChatAgent(actor: AuthenticatedUser) {
    const cfg = await this.config();
    if (!(await this.access.canInGroup(actor, cfg.groupId, 'change')))
      throw new AppError('forbidden');
    return cfg;
  }

  async setAvailability(actor: AuthenticatedUser, available: boolean) {
    await this.assertChatAgent(actor);
    if (available) await this.redis.zadd(AGENTS_KEY, Date.now() + AVAILABILITY_TTL_MS, actor.id);
    else await this.redis.zrem(AGENTS_KEY, actor.id);
    return { available };
  }

  private emit(s: ChatSession, groupId: string) {
    this.events.emit({
      type: 'chat.updated',
      sessionId: s.id,
      ticketId: s.ticketId,
      groupId,
      customerId: s.customerId,
      state: s.state,
    });
  }

  // ------------------------------------------------------------- customers

  async status(actor: AuthenticatedUser) {
    const cfg = await this.config();
    const session = await this.prisma.chatSession.findFirst({
      where: { customerId: actor.id, state: { not: 'ended' } },
    });
    return {
      enabled: cfg.enabled,
      available: cfg.enabled && (await this.availableAgents(cfg.groupId)).length > 0,
      session: session && { id: session.id, ticketId: session.ticketId, state: session.state },
    };
  }

  async start(actor: AuthenticatedUser, message: string, origin: 'portal' | 'widget') {
    const cfg = await this.config();
    if (!cfg.enabled) throw new AppError('conflict', 'Chat is disabled.');
    if (!(await this.availableAgents(cfg.groupId)).length)
      throw new AppError('conflict', 'No agent is available right now.');
    if (
      await this.prisma.chatSession.findFirst({
        where: { customerId: actor.id, state: { not: 'ended' } },
      })
    )
      throw new AppError('conflict', 'You already have an open chat.');
    const ticketId = await this.tickets.createCore(
      {
        title: `Chat: ${message.replace(/\s+/g, ' ').slice(0, 100)}`,
        groupId: cfg.groupId,
        state: 'new',
        channel: 'chat',
        customerId: actor.id,
        article: {
          type: 'chat',
          sender: 'customer',
          internal: false,
          body: message,
          isHtml: false,
          from: actor.email,
        },
      },
      { actorId: actor.id },
    );
    let session: ChatSession;
    try {
      session = await this.prisma.chatSession.create({
        data: { ticketId, customerId: actor.id, state: 'waiting', origin },
      });
    } catch (err) {
      // Two starts racing: the partial unique index keeps one open chat per customer.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
        throw new AppError('conflict', 'You already have an open chat.');
      throw err;
    }
    this.emit(session, cfg.groupId);
    return { id: session.id, ticketId, state: session.state };
  }

  // -------------------------------------------------------------- agents

  async queue(actor: AuthenticatedUser) {
    await this.assertChatAgent(actor);
    const rows = await this.prisma.chatSession.findMany({
      where: {
        OR: [{ state: 'waiting' }, { state: 'active', agentId: actor.id }],
      },
      orderBy: { startedAt: 'asc' },
      take: 50,
    });
    const tickets = await this.prisma.ticket.findMany({
      where: { id: { in: rows.map((r) => r.ticketId) } },
      select: { id: true, number: true, title: true, customer: { select: { name: true } } },
    });
    const byId = new Map(tickets.map((t) => [t.id, t]));
    return rows.map((r) => ({
      id: r.id,
      state: r.state,
      origin: r.origin,
      startedAt: r.startedAt,
      ticketId: r.ticketId,
      number: byId.get(r.ticketId)?.number,
      title: byId.get(r.ticketId)?.title,
      customer: byId.get(r.ticketId)?.customer?.name ?? null,
    }));
  }

  async accept(actor: AuthenticatedUser, id: string) {
    const cfg = await this.assertChatAgent(actor);
    // Atomic: only one agent wins a waiting chat.
    const won = await this.prisma.chatSession.updateMany({
      where: { id, state: 'waiting' },
      data: {
        state: 'active',
        agentId: actor.id,
        acceptedAt: new Date(),
        lastActivityAt: new Date(),
      },
    });
    if (!won.count) throw new AppError('conflict', 'The chat was already taken or ended.');
    const s = await this.prisma.chatSession.findUniqueOrThrow({ where: { id } });
    await this.tickets.updateByUser(actor, s.ticketId, { ownerId: actor.id });
    this.emit(s, cfg.groupId);
    return { id: s.id, ticketId: s.ticketId, state: s.state };
  }

  // -------------------------------------------------------------- both

  /** The session if the actor is its customer or its agent (otherwise 404). */
  private async mine(actor: AuthenticatedUser, id: string): Promise<ChatSession> {
    const s = await this.prisma.chatSession.findUnique({ where: { id } });
    const isCustomer = s?.customerId === actor.id;
    const isAgent = s?.agentId === actor.id && this.access.isStaff(actor);
    if (!s || (!isCustomer && !isAgent)) throw new AppError('not_found');
    return s;
  }

  async send(actor: AuthenticatedUser, id: string, body: string) {
    const s = await this.mine(actor, id);
    if (s.state === 'ended') throw new AppError('conflict', 'The chat has ended.');
    if (s.state === 'waiting' && s.customerId !== actor.id)
      throw new AppError('conflict', 'Accept the chat first.');
    const fromCustomer = s.customerId === actor.id;
    const articleId = await this.tickets.addArticleCore(
      await this.tickets.loadForRules(s.ticketId),
      {
        type: 'chat',
        sender: fromCustomer ? 'customer' : 'agent',
        internal: false,
        body,
        isHtml: false,
        from: fromCustomer ? actor.email : actor.name,
      },
      { actorId: actor.id },
    );
    await this.prisma.chatSession.update({ where: { id }, data: { lastActivityAt: new Date() } });
    return { articleId };
  }

  async end(actor: AuthenticatedUser | null, id: string, reason: 'customer' | 'agent' | 'idle') {
    const s = actor
      ? await this.mine(actor, id)
      : await this.prisma.chatSession.findUniqueOrThrow({ where: { id } });
    if (s.state === 'ended') return { id, state: 'ended' };
    const ended = await this.prisma.chatSession.update({
      where: { id },
      data: { state: 'ended', endedAt: new Date() },
    });
    const ticket = await this.tickets.loadForRules(s.ticketId);
    const text = {
      customer: 'El cliente finalizó el chat.',
      agent: 'El agente finalizó el chat.',
      idle: 'Chat finalizado por inactividad.',
    }[reason];
    await this.tickets.addArticleCore(
      ticket,
      { type: 'note', sender: 'system', internal: true, body: text, isHtml: false },
      { actorId: null },
    );
    // An answered chat is done; a chat nobody took stays open as a regular ticket.
    if (s.agentId && ticket.state !== 'closed')
      await this.tickets.applyChanges(s.ticketId, { state: 'closed' }, { actorId: null });
    this.emit(ended, ticket.groupId);
    return { id, state: 'ended' };
  }

  /** Jobs service: ends chats without activity for the configured minutes. */
  async closeIdle(): Promise<number> {
    const cfg = await this.config();
    const before = new Date(Date.now() - cfg.idleMinutes * 60_000);
    const idle = await this.prisma.chatSession.findMany({
      where: { state: { not: 'ended' }, lastActivityAt: { lt: before } },
      select: { id: true },
      take: 200,
    });
    for (const s of idle) await this.end(null, s.id, 'idle');
    return idle.length;
  }
}
