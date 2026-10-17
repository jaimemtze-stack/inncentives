import { Global, Inject, Injectable, Logger, Module } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

/** Redis channel that carries domain events from the API and jobs processes to the realtime gateway. */
export const EVENTS_CHANNEL = 'mesa:events';

export type DomainEvent =
  | {
      type: 'ticket.created' | 'ticket.updated' | 'article.created';
      ticketId: string;
      groupId: string;
      customerId: string | null;
      organizationId: string | null;
      actorId: string | null;
      /** Internal notes are not announced to customers. */
      internal?: boolean;
    }
  | { type: 'notification.created'; userId: string }
  | {
      type: 'call.updated';
      callId: string;
      state: string;
      direction: string;
      number: string;
      customerId: string | null;
      /** Agent the call is routed to; null announces it to every agent. */
      userId: string | null;
    };

/**
 * Domain events, emitted after a transaction commits. They are published on
 * Redis so the realtime gateway also sees events raised by the jobs process
 * (e-mail, SLA). Listeners must never throw.
 */
@Injectable()
export class DomainEvents {
  private readonly emitter = new EventEmitter();
  private readonly logger = new Logger(DomainEvents.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {
    this.emitter.setMaxListeners(50);
  }

  emit(event: DomainEvent): void {
    this.emitter.emit('event', event);
    this.redis.publish(EVENTS_CHANNEL, JSON.stringify(event)).catch((err: Error) => {
      this.logger.warn(`event publish failed: ${err.message}`);
    });
  }

  on(listener: (e: DomainEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }
}

@Global()
@Module({ providers: [DomainEvents], exports: [DomainEvents] })
export class EventsModule {}
