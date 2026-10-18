import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { UuidParamSchema } from '@mesa/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { APP_CONFIG, AppConfig } from '../config/config';
import { AppError } from '../common/errors';
import { ZodPipe } from '../common/zod-validation.pipe';
import { Public, RequirePermissions, RequireReauth } from '../policy/decorators';
import { setSessionCookie } from '../policy/session-cookie';
import { safeEqual } from '../security/tokens';
import { SsoService } from './sso.service';

const ProviderParam = z.object({ id: z.string().regex(/^[a-z0-9-]{1,40}$/) });
const StartSchema = z.object({ mode: z.enum(['login', 'link']).default('login') }).strict();
const CallbackQuery = z
  .object({
    code: z.string().max(4096).optional(),
    state: z.string().max(100).optional(),
    error: z.string().max(200).optional(),
    error_description: z.string().max(2000).optional(),
    session_state: z.string().max(200).optional(),
    iss: z.string().max(300).optional(),
  })
  .strict();

@Controller('auth/sso')
export class SsoController {
  constructor(
    private readonly sso: SsoService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('providers')
  @Public()
  providers(@Req() req: FastifyRequest) {
    if (!req.area) throw new AppError('wrong_host');
    return this.sso.providers(req.area);
  }

  @Post(':id/start')
  @Public()
  @HttpCode(200)
  start(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(ProviderParam)) p: z.infer<typeof ProviderParam>,
    @Body(new ZodPipe(StartSchema)) body: z.infer<typeof StartSchema>,
  ) {
    if (body.mode === 'link') {
      // Public route: the CSRF token is checked here for the signed-in "link" flow.
      const header = req.headers['x-csrf-token'];
      if (!req.auth || typeof header !== 'string' || !safeEqual(header, req.auth.session.csrfToken))
        throw new AppError('csrf_failed');
    }
    return this.sso.start(req, p.id, body.mode);
  }

  @Get(':id/callback')
  @Public()
  async callback(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @Param(new ZodPipe(ProviderParam)) p: z.infer<typeof ProviderParam>,
    @Query(new ZodPipe(CallbackQuery)) q: z.infer<typeof CallbackQuery>,
  ) {
    const r = await this.sso.callback(req, p.id, q);
    if (r.session) setSessionCookie(reply, r.session.token, this.config);
    return reply.redirect(r.redirect, 303);
  }

  @Get('identities')
  @RequirePermissions()
  identities(@Req() req: FastifyRequest) {
    return this.sso.identities(req.auth!.user.id);
  }

  @Delete('identities/:id')
  @RequirePermissions()
  @RequireReauth()
  @HttpCode(204)
  async unlink(@Req() req: FastifyRequest, @Param(new ZodPipe(UuidParamSchema)) p: { id: string }) {
    await this.sso.unlink(req, req.auth!.user.id, p.id);
  }
}
