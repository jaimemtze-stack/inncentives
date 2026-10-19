import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { UuidParamSchema } from '@mesa/shared';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { APP_CONFIG, AppConfig } from '../config/config';
import { Inject } from '@nestjs/common';
import { AppError } from '../common/errors';
import { ZodPipe } from '../common/zod-validation.pipe';
import { AllowStates, RequirePermissions, RequireReauth } from '../policy/decorators';
import { setSessionCookie } from '../policy/session-cookie';
import { WebAuthnService } from './webauthn.service';

/** The browser's WebAuthn JSON is validated by SimpleWebAuthn; here only its envelope. */
const CredentialJson = z
  .object({
    id: z.string().max(1024),
    rawId: z.string().max(1024),
    type: z.literal('public-key'),
    response: z.record(z.unknown()),
  })
  .passthrough();
const RegisterSchema = z
  .object({ name: z.string().trim().min(1).max(80), response: CredentialJson })
  .strict();
const AuthenticateSchema = z.object({ response: CredentialJson }).strict();

@Controller('auth/webauthn')
export class WebAuthnController {
  constructor(
    private readonly webauthn: WebAuthnService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('register/options')
  @RequirePermissions()
  @AllowStates('mfa_enrollment_required')
  @HttpCode(200)
  registerOptions(@Req() req: FastifyRequest) {
    this.requireReauthWhenAuthenticated(req);
    return this.webauthn.registrationOptions(req, req.auth!);
  }

  @Post('register')
  @RequirePermissions()
  @AllowStates('mfa_enrollment_required')
  @HttpCode(200)
  async register(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body(new ZodPipe(RegisterSchema)) body: z.infer<typeof RegisterSchema>,
  ) {
    this.requireReauthWhenAuthenticated(req);
    const r = await this.webauthn.register(
      req,
      req.auth!,
      body.response as unknown as RegistrationResponseJSON,
      body.name,
    );
    if (r.session) setSessionCookie(reply, r.session.token, this.config);
    return {
      recoveryCodes: r.recoveryCodes,
      ...(r.session
        ? { state: r.session.record.state, csrfToken: r.session.record.csrfToken }
        : {}),
    };
  }

  @Post('authenticate/options')
  @RequirePermissions()
  @AllowStates('mfa_required')
  @HttpCode(200)
  authenticateOptions(@Req() req: FastifyRequest) {
    return this.webauthn.authenticationOptions(req, req.auth!);
  }

  @Post('authenticate')
  @RequirePermissions()
  @AllowStates('mfa_required')
  @HttpCode(200)
  async authenticate(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body(new ZodPipe(AuthenticateSchema)) body: z.infer<typeof AuthenticateSchema>,
  ) {
    const s = await this.webauthn.authenticate(
      req,
      req.auth!,
      body.response as unknown as AuthenticationResponseJSON,
    );
    setSessionCookie(reply, s.token, this.config);
    return { state: s.record.state, csrfToken: s.record.csrfToken };
  }

  @Get('credentials')
  @RequirePermissions()
  list(@Req() req: FastifyRequest) {
    return this.webauthn.list(req.auth!);
  }

  @Delete('credentials/:id')
  @RequirePermissions()
  @RequireReauth()
  @HttpCode(204)
  async remove(@Req() req: FastifyRequest, @Param(new ZodPipe(UuidParamSchema)) p: { id: string }) {
    await this.webauthn.remove(req, req.auth!, p.id);
  }

  /** Adding a key to an existing account is sensitive (ASVS 3.7.1); first enrollment is not. */
  private requireReauthWhenAuthenticated(req: FastifyRequest) {
    const s = req.auth!.session;
    if (
      s.state === 'authenticated' &&
      (!s.reauthAt || Date.now() - s.reauthAt > this.config.REAUTH_WINDOW_MINUTES * 60_000)
    ) {
      throw new AppError('reauthentication_required');
    }
  }
}
