import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  acceptInvitationSchema,
  changePasswordSchema,
  loginSchema,
  mfaEnableSchema,
  mfaVerifySchema,
  reauthSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  type LoginInput,
} from '@inn/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import type { Area, SessionInfo } from '../../common/auth/actor';
import { clearCookie, setCookie } from '../../common/auth/cookies';
import { CsrfService } from '../../common/auth/csrf.service';
import { AllowMfaSetup, AreaOnly, Authenticated, Public } from '../../common/auth/decorators';
import { requestMeta } from '../../common/http/request-meta';
import { ZodPipe } from '../../common/http/zod.pipe';
import { ActorLoaderService } from '../../common/auth/actor-loader.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthService } from './auth.service';

const DEVICE_COOKIE_MAX_AGE = 400 * 24 * 3600;

@Controller('auth')
@AreaOnly('any')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly csrf: CsrfService,
    private readonly actors: ActorLoaderService,
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private area(req: FastifyRequest): Area {
    return req.area!;
  }

  /** Sets the session cookie and a fresh CSRF token bound to it. Returns the CSRF token. */
  private establish(
    reply: FastifyReply,
    area: Area,
    sessionId: string,
    session: SessionInfo,
    deviceCookie?: string,
  ) {
    setCookie(reply, this.config, 'sid', area, sessionId);
    if (deviceCookie)
      setCookie(reply, this.config, 'dev', area, deviceCookie, {
        maxAgeSeconds: DEVICE_COOKIE_MAX_AGE,
      });
    return this.issueCsrf(reply, area, session.hash);
  }

  private issueCsrf(reply: FastifyReply, area: Area, binding: string) {
    const token = this.csrf.issue(binding);
    // Readable by the SPA so it can echo it in X-CSRF-Token (double submit).
    setCookie(reply, this.config, 'csrf', area, token, { httpOnly: false });
    return token;
  }

  @Get('csrf')
  @Public()
  csrfToken(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    return { csrfToken: this.issueCsrf(reply, this.area(req), req.session?.hash ?? 'anon') };
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(loginSchema)) body: LoginInput,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const area = this.area(req);
    if (req.session) await this.auth.logout(req.session, requestMeta(req, this.config));
    const r = await this.auth.login(
      body.email,
      body.password,
      area,
      requestMeta(req, this.config, area),
    );
    const csrfToken = this.establish(
      reply,
      area,
      r.sessionId,
      r.session,
      'newDeviceCookie' in r ? r.newDeviceCookie : undefined,
    );
    return { status: r.status, csrfToken };
  }

  @Post('mfa/verify')
  @Public()
  @HttpCode(200)
  async verifyMfa(
    @Body(new ZodPipe(mfaVerifySchema)) body: z.infer<typeof mfaVerifySchema>,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (!req.session?.mfaPending) throw new UnauthorizedException();
    const area = this.area(req);
    const r = await this.auth.verifyMfa(
      req.session,
      body.code,
      requestMeta(req, this.config, area),
    );
    return {
      status: 'ok',
      csrfToken: this.establish(reply, area, r.id, r.info, r.newDeviceCookie),
    };
  }

  @Post('mfa/setup')
  @Authenticated()
  @AllowMfaSetup()
  @HttpCode(200)
  async mfaSetup(@Req() req: FastifyRequest) {
    const s = req.session!;
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: s.userId },
      select: { mfaEnabled: true },
    });
    // Replacing an existing factor requires a recent re-authentication.
    if (
      user.mfaEnabled &&
      (!s.reauthAt || Date.now() - s.reauthAt > this.config.REAUTH_MAX_AGE_MINUTES * 60_000)
    ) {
      throw new UnauthorizedException('reauth_required');
    }
    return this.auth.beginMfaSetup(s.userId);
  }

  @Post('mfa/enable')
  @Authenticated()
  @AllowMfaSetup()
  @HttpCode(200)
  async mfaEnable(
    @Body(new ZodPipe(mfaEnableSchema)) body: z.infer<typeof mfaEnableSchema>,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const area = this.area(req);
    const r = await this.auth.enableMfa(req.session!, body.code, requestMeta(req, this.config));
    return { recoveryCodes: r.recoveryCodes, csrfToken: this.establish(reply, area, r.id, r.info) };
  }

  @Post('reauth')
  @Authenticated()
  @HttpCode(200)
  async reauth(
    @Body(new ZodPipe(reauthSchema)) body: z.infer<typeof reauthSchema>,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const area = this.area(req);
    const r = await this.auth.reauthenticate(
      req.session!,
      body.password,
      body.code,
      requestMeta(req, this.config),
    );
    return { status: 'ok', csrfToken: this.establish(reply, area, r.id, r.info) };
  }

  @Post('password/change')
  @Authenticated()
  @HttpCode(200)
  async changePassword(
    @Body(new ZodPipe(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const area = this.area(req);
    const r = await this.auth.changePassword(
      req.session!,
      body.currentPassword,
      body.newPassword,
      requestMeta(req, this.config),
    );
    return { status: 'ok', csrfToken: this.establish(reply, area, r.id, r.info) };
  }

  @Post('password/forgot')
  @Public()
  @HttpCode(202)
  async forgot(
    @Body(new ZodPipe(requestPasswordResetSchema)) body: { email: string },
    @Req() req: FastifyRequest,
  ) {
    await this.auth.requestPasswordReset(body.email, this.area(req), requestMeta(req, this.config));
    return { status: 'accepted' };
  }

  @Post('password/reset')
  @Public()
  @HttpCode(200)
  async reset(
    @Body(new ZodPipe(resetPasswordSchema)) body: z.infer<typeof resetPasswordSchema>,
    @Req() req: FastifyRequest,
  ) {
    await this.auth.resetPassword(body.token, body.password, requestMeta(req, this.config));
    return { status: 'ok' };
  }

  @Post('invitations/accept')
  @Public()
  @HttpCode(200)
  async acceptInvitation(
    @Body(new ZodPipe(acceptInvitationSchema)) body: z.infer<typeof acceptInvitationSchema>,
    @Req() req: FastifyRequest,
  ) {
    await this.auth.acceptInvitation(body, requestMeta(req, this.config));
    return { status: 'ok' };
  }

  @Post('logout')
  @Public()
  @HttpCode(204)
  async logout(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    if (req.session) await this.auth.logout(req.session, requestMeta(req, this.config));
    clearCookie(reply, this.config, 'sid', this.area(req));
  }

  @Get('me')
  @Authenticated()
  @AllowMfaSetup()
  async me(@Req() req: FastifyRequest) {
    const actor = req.actor ?? (await this.actors.load(req.session!.userId));
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: req.session!.userId },
      select: {
        id: true,
        email: true,
        firstname: true,
        lastname: true,
        locale: true,
        timezone: true,
        mfaEnabled: true,
        organizationId: true,
      },
    });
    return {
      ...user,
      roles: actor?.roles ?? [],
      permissions: [...(actor?.permissions ?? [])].sort(),
      area: req.session!.area,
      mfaSetupRequired: req.session!.mfaSetupRequired,
    };
  }
}
