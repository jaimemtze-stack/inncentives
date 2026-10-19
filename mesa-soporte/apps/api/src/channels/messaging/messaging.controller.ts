import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../../common/errors';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { SECRETS } from '../../config/config.module';
import type { FileSecretsProvider } from '../../config/secrets';
import { Public } from '../../policy/decorators';
import { safeEqual } from '../../security/tokens';
import { publicUrl } from '../phone/phone.controller';
import { asParams, verifyTwilio } from '../twilio/twilio';
import { MessagingService } from './messaging.service';
import { parseTwilioSms, parseWhatsApp, verifyMetaSignature } from './providers';

/** Provider webhooks of the messaging channels (portal host, outside /api/v1). */
@Controller('hooks')
export class MessagingHooksController {
  constructor(
    private readonly messaging: MessagingService,
    @Inject(SECRETS) private readonly secrets: FileSecretsProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Meta's subscription check: echo hub.challenge when the verify token matches. */
  @Get('whatsapp')
  @Public('portal')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  verify(@Query() q: Record<string, unknown>) {
    const expected = this.secrets.get('whatsapp_verify_token');
    const token = typeof q['hub.verify_token'] === 'string' ? q['hub.verify_token'] : '';
    const challenge = q['hub.challenge'];
    if (
      !expected ||
      q['hub.mode'] !== 'subscribe' ||
      !safeEqual(token, expected) ||
      typeof challenge !== 'string' ||
      !/^[\w-]{1,100}$/.test(challenge)
    )
      throw new AppError('forbidden');
    return challenge;
  }

  @Post('whatsapp')
  @Public('portal')
  @HttpCode(200)
  async whatsapp(@Req() req: RawBodyRequest<FastifyRequest>, @Body() body: unknown) {
    const secret = this.secrets.get('whatsapp_app_secret');
    const sig = req.headers['x-hub-signature-256'];
    if (
      !secret ||
      !req.rawBody ||
      !verifyMetaSignature(secret, req.rawBody, typeof sig === 'string' ? sig : undefined)
    )
      throw new AppError('unauthenticated');
    const { messages, receipts } = parseWhatsApp(body);
    for (const m of messages) await this.messaging.ingest(m);
    for (const r of receipts) await this.messaging.receipt(r);
    return { ok: true };
  }

  /** Inbound SMS and status callbacks of our messages; answers empty TwiML. */
  @Post('twilio/sms')
  @Public('portal')
  @HttpCode(200)
  @Header('Content-Type', 'text/xml; charset=utf-8')
  async sms(@Req() req: FastifyRequest, @Body() body: unknown) {
    const token = this.secrets.get('twilio_auth_token');
    const params = asParams(body);
    const sig = req.headers['x-twilio-signature'];
    if (
      !token ||
      !params ||
      !verifyTwilio(
        token,
        publicUrl(this.config, req),
        params,
        typeof sig === 'string' ? sig : undefined,
      )
    )
      throw new AppError('unauthenticated');
    const parsed = parseTwilioSms(params);
    if (parsed && 'message' in parsed) await this.messaging.ingest(parsed.message);
    else if (parsed) await this.messaging.receipt(parsed.receipt);
    return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
  }
}
