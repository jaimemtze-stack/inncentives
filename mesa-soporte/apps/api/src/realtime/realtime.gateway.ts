import { Inject, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { effectivePermissions } from '@mesa/shared';
import type Redis from 'ioredis';
import type { Server, Socket } from 'socket.io';
import { APP_CONFIG, AppConfig } from '../config/config';
import { resolveArea } from '../common/host-area';
import type { AuthenticatedUser } from '../common/request-context';
import { EVENTS_CHANNEL, type DomainEvent } from '../events/ticket-events';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';
import { SessionService } from '../security/session.service';
import { TicketAccessService } from '../tickets/access.service';

interface SocketData {
  token: string;
  user: AuthenticatedUser;
  staff: boolean;
  watching: Set<string>;
}

const PRESENCE_TTL = 120;
const REVALIDATE_MS = 60_000;

/**
 * Realtime updates. Sockets authenticate with the session cookie (same host
 * and origin rules as HTTP), join only the rooms their permissions allow, and
 * receive minimal events ({type, ticketId}): the client then reloads through
 * the API, which applies the full ticket policy again.
 */
@WebSocketGateway({
  path: '/socket.io',
  serveClient: false,
  transports: ['websocket'],
  cors: false,
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(RealtimeGateway.name);
  private subscriber?: Redis;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
    private readonly access: TicketAccessService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    this.subscriber = this.redis.duplicate();
    await this.subscriber.subscribe(EVENTS_CHANNEL);
    this.subscriber.on('message', (_channel, message) => {
      try {
        this.relay(JSON.parse(message) as DomainEvent);
      } catch (err) {
        this.logger.warn(`bad event: ${(err as Error).message}`);
      }
    });
    this.timer = setInterval(() => void this.revalidate(), REVALIDATE_MS);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.subscriber?.quit().catch(() => undefined);
  }

  private async authenticate(socket: Socket): Promise<SocketData | null> {
    const host = socket.handshake.headers.host;
    const area = resolveArea(host, {
      portal: this.config.PORTAL_HOST,
      agent: this.config.AGENT_HOST,
    });
    if (!area) return null;
    if (socket.handshake.headers.origin !== `${this.config.PUBLIC_SCHEME}://${host}`) return null;
    const token = /(?:^|;\s*)__Host-sid=([A-Za-z0-9_-]{43})(?:;|$)/.exec(
      socket.handshake.headers.cookie ?? '',
    )?.[1];
    const resolved = await this.sessions.resolve(token);
    if (!resolved || resolved.record.state !== 'authenticated' || resolved.record.area !== area)
      return null;
    const user = await this.loadUser(resolved.record.userId);
    if (!user || (area === 'portal') !== (user.role === 'CUSTOMER')) return null;
    return { token: token!, user, staff: this.access.isStaff(user), watching: new Set() };
  }

  private async loadUser(id: string): Promise<AuthenticatedUser | null> {
    const u = await this.prisma.user.findUnique({
      where: { id },
      include: { customRoles: { where: { role: { active: true } }, select: { role: true } } },
    });
    if (!u || u.status !== 'ACTIVE') return null;
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      organizationId: u.organizationId,
      locale: u.locale,
      mfaEnabled: u.totpEnabledAt !== null,
      permissions: effectivePermissions(
        u.role,
        u.customRoles.flatMap((c) => c.role.permissions),
      ),
    };
  }

  /** Rooms a user may listen to. */
  private async rooms(data: SocketData): Promise<string[]> {
    const rooms = [`user:${data.user.id}`];
    if (data.staff) {
      rooms.push('agents');
      const groups = await this.access.groupIds(data.user, 'overview');
      if (groups === 'all') rooms.push('admins');
      else rooms.push(...groups.map((g) => `group:${g}`));
    } else {
      const orgs = await this.access.customerOrganizations(data.user);
      if (orgs) rooms.push(...orgs.map((o) => `org:${o}`));
    }
    return rooms;
  }

  async handleConnection(socket: Socket): Promise<void> {
    const data = await this.authenticate(socket).catch(() => null);
    if (!data) {
      socket.disconnect(true);
      return;
    }
    socket.data = data;
    await socket.join(await this.rooms(data));
  }

  async handleDisconnect(socket: Socket): Promise<void> {
    const data = socket.data as SocketData | undefined;
    if (!data?.watching) return;
    for (const ticketId of data.watching) await this.leave(socket, ticketId);
  }

  /** Drops sockets whose session ended and refreshes room membership. */
  private async revalidate(): Promise<void> {
    for (const socket of await this.server.fetchSockets()) {
      const data = socket.data as SocketData;
      const resolved = await this.sessions.resolve(data.token).catch(() => null);
      const user = resolved ? await this.loadUser(resolved.record.userId) : null;
      if (!resolved || !user) {
        socket.disconnect(true);
        continue;
      }
      data.user = user;
      const wanted = new Set(await this.rooms(data));
      for (const r of socket.rooms) {
        if (r !== socket.id && !r.startsWith('ticket:') && !wanted.has(r)) socket.leave(r);
      }
      socket.join([...wanted]);
    }
  }

  private relay(e: DomainEvent): void {
    if (!this.server) return;
    if (e.type === 'notification.created') {
      this.server.to(`user:${e.userId}`).emit('notification', {});
      return;
    }
    if (e.type === 'chat.updated') {
      // Queue changes for the chat group's agents; the customer follows their own session.
      this.server
        .to([`group:${e.groupId}`, 'admins', `user:${e.customerId}`])
        .emit('chat', { sessionId: e.sessionId, ticketId: e.ticketId, state: e.state });
      return;
    }
    if (e.type === 'call.updated') {
      const target = e.userId ? `user:${e.userId}` : 'agents';
      this.server.to(target).emit('call', {
        callId: e.callId,
        state: e.state,
        direction: e.direction,
        number: e.number,
        customerId: e.customerId,
      });
      return;
    }
    const payload = { type: e.type, ticketId: e.ticketId };
    this.server
      .to([`group:${e.groupId}`, 'admins', `ticket:${e.ticketId}`])
      .emit('ticket', payload);
    if (!e.internal) {
      const rooms = [
        e.customerId ? `user:${e.customerId}` : null,
        e.organizationId ? `org:${e.organizationId}` : null,
      ].filter((r): r is string => !!r);
      if (rooms.length) this.server.to(rooms).emit('ticket', payload);
    }
  }

  // ------------------------------------------------- presence (agents only)

  private async viewers(ticketId: string) {
    const raw = await this.redis.hgetall(`presence:${ticketId}`);
    const now = Date.now();
    return Object.values(raw)
      .map((v) => JSON.parse(v) as { id: string; name: string; typing: boolean; at: number })
      .filter((v) => now - v.at < PRESENCE_TTL * 1000)
      .map(({ id, name, typing }) => ({ id, name, typing }));
  }

  private async broadcastPresence(ticketId: string) {
    this.server
      .to(`ticket:${ticketId}`)
      .emit('presence', { ticketId, viewers: await this.viewers(ticketId) });
  }

  private async setPresence(data: SocketData, ticketId: string, typing: boolean) {
    const key = `presence:${ticketId}`;
    await this.redis.hset(
      key,
      data.user.id,
      JSON.stringify({ id: data.user.id, name: data.user.name, typing, at: Date.now() }),
    );
    await this.redis.expire(key, PRESENCE_TTL);
  }

  private async leave(socket: Socket, ticketId: string) {
    const data = socket.data as SocketData;
    data.watching.delete(ticketId);
    await socket.leave(`ticket:${ticketId}`);
    await this.redis.hdel(`presence:${ticketId}`, data.user.id);
    await this.broadcastPresence(ticketId);
  }

  @SubscribeMessage('ticket:watch')
  async watch(@ConnectedSocket() socket: Socket, @MessageBody() body: { ticketId?: unknown }) {
    const data = socket.data as SocketData;
    const ticketId = typeof body?.ticketId === 'string' ? body.ticketId : '';
    if (!data?.staff || !/^[0-9a-f-]{36}$/.test(ticketId) || data.watching.size >= 20)
      return { ok: false };
    try {
      await this.access.load(data.user, ticketId, 'read');
    } catch {
      return { ok: false };
    }
    data.watching.add(ticketId);
    await socket.join(`ticket:${ticketId}`);
    await this.setPresence(data, ticketId, false);
    await this.broadcastPresence(ticketId);
    return { ok: true };
  }

  @SubscribeMessage('ticket:unwatch')
  async unwatch(@ConnectedSocket() socket: Socket, @MessageBody() body: { ticketId?: unknown }) {
    const data = socket.data as SocketData;
    const ticketId = typeof body?.ticketId === 'string' ? body.ticketId : '';
    if (data?.watching?.has(ticketId)) await this.leave(socket, ticketId);
    return { ok: true };
  }

  @SubscribeMessage('ticket:typing')
  async typing(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { ticketId?: unknown; typing?: unknown },
  ) {
    const data = socket.data as SocketData;
    const ticketId = typeof body?.ticketId === 'string' ? body.ticketId : '';
    if (!data?.watching?.has(ticketId)) return { ok: false };
    await this.setPresence(data, ticketId, body.typing === true);
    await this.broadcastPresence(ticketId);
    return { ok: true };
  }
}
