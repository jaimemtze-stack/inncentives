import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module';
import { RealtimeGateway } from './realtime.gateway';

@Module({ imports: [TicketsModule], providers: [RealtimeGateway] })
export class RealtimeModule {}
