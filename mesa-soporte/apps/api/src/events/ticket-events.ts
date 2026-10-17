import { Global, Injectable, Module } from '@nestjs/common';
import { EventEmitter } from 'node:events';

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
 * In-process domain events, emitted after a transaction commits. The realtime
 * gateway relays them to browsers; listeners must never throw.
 */
@Injectable()
export class DomainEvents {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  emit(event: DomainEvent): void {
    this.emitter.emit('event', event);
  }

  on(listener: (e: DomainEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }
}

@Global()
@Module({ providers: [DomainEvents], exports: [DomainEvents] })
export class EventsModule {}
