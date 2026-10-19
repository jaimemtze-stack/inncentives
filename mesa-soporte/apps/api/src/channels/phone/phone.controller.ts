import {
  Body,
  Controller,
  Inject,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { Permission } from '@mesa/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodPipe } from '../../common/zod-validation.pipe';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { Area, Public, RequirePermissions } from '../../policy/decorators';
import { PhoneService } from './phone.service';

const LookupQuery = z.object({ number: z.string().min(3).max(30) }).strict();

@Controller('phone')
@Area('agent')
export class PhoneController {
  constructor(private readonly phone: PhoneService) {}

  @Get('lookup')
  @RequirePermissions(Permission.TicketsAgent)
  lookup(
    @Req() req: FastifyRequest,
    @Query(new ZodPipe(LookupQuery)) q: z.infer<typeof LookupQuery>,
  ) {
    return this.phone.lookup(req.auth!.user, q.number);
  }

  @Get('calls')
  @RequirePermissions(Permission.TicketsAgent)
  calls(@Req() req: FastifyRequest) {
    return this.phone.recentCalls(req.auth!.user);
  }
}

/** Machine-to-machine webhooks, outside /api/v1 and authenticated by signature. */
@Controller('hooks')
export class HooksController {
  constructor(
    private readonly phone: PhoneService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Twilio Voice status callback (form-encoded, X-Twilio-Signature). */
  @Post('twilio/voice')
  @Public('portal')
  @HttpCode(204)
  async twilioVoice(@Req() req: FastifyRequest, @Body() body: unknown) {
    const sig = req.headers['x-twilio-signature'];
    await this.phone.handleTwilioVoice(
      publicUrl(this.config, req),
      typeof sig === 'string' ? sig : undefined,
      body,
    );
  }

  @Post('cti')
  @Public('any')
  @HttpCode(204)
  async cti(@Req() req: RawBodyRequest<FastifyRequest>, @Body() body: unknown) {
    const sig = req.headers['x-mesa-signature'];
    await this.phone.handleWebhook(typeof sig === 'string' ? sig : undefined, req.rawBody, body);
  }
}

/** The URL the provider called (it signs it): public scheme + Host + path and query. */
export function publicUrl(config: AppConfig, req: FastifyRequest): string {
  return `${config.PUBLIC_SCHEME}://${req.headers.host ?? ''}${req.url}`;
}
