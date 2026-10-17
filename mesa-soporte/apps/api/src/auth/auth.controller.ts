import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  InvitationAcceptSchema,
  LoginSchema,
  MfaVerifySchema,
  PasswordChangeSchema,
  PasswordForgotSchema,
  PasswordResetSchema,
  Permission,
  ReauthSchema,
  TokenSchema,
  TotpConfirmSchema,
  type AuthState,
  type MeResponse,
  type SessionInfo,
} from '@mesa/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { APP_CONFIG, AppConfig } from '../config/config';
import { AppError } from '../common/errors';
import { ZodPipe } from '../common/zod-validation.pipe';
import { AllowStates, Public, RequirePermissions, RequireReauth } from '../policy/decorators';
import { clearSessionCookie, setSessionCookie } from '../policy/session-cookie';
import type { CreatedSession } from '../security/session.service';
import { AuthService } from './auth.service';

const ALL_STATES: AuthState[] = ['mfa_required', 'mfa_enrollment_required'];

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private issue(reply: FastifyReply, s: CreatedSession): { state: AuthState; csrfToken: string } {
    setSessionCookie(reply, s.token, this.config);
    return { state: s.record.state, csrfToken: s.record.csrfToken };
  }

  /** Lets the single-page app know which area (portal or agents) it is serving. */
  @Get('area')
  @Public()
  area(@Req() req: FastifyRequest): { area: string | null } {
    return { area: req.area };
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  async login(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body(new ZodPipe(LoginSchema)) body: z.infer<typeof LoginSchema>,
  ) {
    // An existing session on this browser is replaced (session fixation defence).
    await this.auth.logout(req);
    return this.issue(reply, await this.auth.login(req, body.email, body.password));
  }

  @Post('logout')
  @Public()
  @HttpCode(204)
  async logout(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.auth.logout(req);
    clearSessionCookie(reply, this.config);
  }

  @Get('me')
  @RequirePermissions()
  @AllowStates(...ALL_STATES)
  me(@Req() req: FastifyRequest): MeResponse & { csrfToken: string } {
    return { ...this.auth.me(req.auth!), csrfToken: req.auth!.session.csrfToken };
  }

  @Post('mfa/verify')
  @RequirePermissions()
  @AllowStates('mfa_required')
  @HttpCode(200)
  async verifyMfa(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body(new ZodPipe(MfaVerifySchema)) body: z.infer<typeof MfaVerifySchema>,
  ) {
    return this.issue(reply, await this.auth.verifyMfa(req, req.auth!, body));
  }

  @Post('mfa/totp/setup')
  @RequirePermissions(Permission.SelfManage)
  @AllowStates('mfa_enrollment_required')
  @HttpCode(200)
  totpSetup(@Req() req: FastifyRequest) {
    const auth = req.auth!;
    // Replacing an existing authenticator needs a fresh password.
    if (auth.user.mfaEnabled && !this.recentReauth(req))
      throw new AppError('reauthentication_required');
    return this.auth.startTotpEnrollment(auth);
  }

  @Post('mfa/totp/confirm')
  @RequirePermissions(Permission.SelfManage)
  @AllowStates('mfa_enrollment_required')
  @HttpCode(200)
  async totpConfirm(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body(new ZodPipe(TotpConfirmSchema)) body: z.infer<typeof TotpConfirmSchema>,
  ) {
    const result = await this.auth.confirmTotpEnrollment(req, req.auth!, body.code);
    const session = result.session ? this.issue(reply, result.session) : undefined;
    return { recoveryCodes: result.recoveryCodes, ...(session ?? {}) };
  }

  @Delete('mfa/totp')
  @RequirePermissions(Permission.SelfManage)
  @RequireReauth()
  @HttpCode(204)
  async totpDisable(@Req() req: FastifyRequest): Promise<void> {
    await this.auth.disableTotp(req, req.auth!);
  }

  @Post('mfa/recovery-codes')
  @RequirePermissions(Permission.SelfManage)
  @RequireReauth()
  @HttpCode(200)
  async regenerateRecoveryCodes(@Req() req: FastifyRequest) {
    return { recoveryCodes: await this.auth.regenerateRecoveryCodes(req, req.auth!) };
  }

  @Post('reauth')
  @RequirePermissions(Permission.SelfManage)
  @HttpCode(204)
  async reauth(
    @Req() req: FastifyRequest,
    @Body(new ZodPipe(ReauthSchema)) body: z.infer<typeof ReauthSchema>,
  ): Promise<void> {
    await this.auth.reauthenticate(req, req.auth!, body.password);
  }

  @Post('password/change')
  @RequirePermissions(Permission.SelfManage)
  @HttpCode(200)
  async changePassword(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body(new ZodPipe(PasswordChangeSchema)) body: z.infer<typeof PasswordChangeSchema>,
  ) {
    return this.issue(
      reply,
      await this.auth.changePassword(req, req.auth!, body.currentPassword, body.newPassword),
    );
  }

  @Post('password/forgot')
  @Public()
  @HttpCode(202)
  async forgot(
    @Req() req: FastifyRequest,
    @Body(new ZodPipe(PasswordForgotSchema)) body: z.infer<typeof PasswordForgotSchema>,
  ): Promise<{ accepted: true }> {
    await this.auth.forgotPassword(req, body.email);
    return { accepted: true };
  }

  @Post('password/reset')
  @Public()
  @HttpCode(204)
  async reset(
    @Req() req: FastifyRequest,
    @Body(new ZodPipe(PasswordResetSchema)) body: z.infer<typeof PasswordResetSchema>,
  ): Promise<void> {
    await this.auth.resetPassword(req, body.token, body.password);
  }

  @Post('invitations/inspect')
  @Public()
  @HttpCode(200)
  inspectInvitation(
    @Req() req: FastifyRequest,
    @Body(new ZodPipe(z.object({ token: TokenSchema }).strict())) body: { token: string },
  ) {
    return this.auth.inspectInvitation(req, body.token);
  }

  @Post('invitations/accept')
  @Public()
  @HttpCode(204)
  async acceptInvitation(
    @Req() req: FastifyRequest,
    @Body(new ZodPipe(InvitationAcceptSchema)) body: z.infer<typeof InvitationAcceptSchema>,
  ): Promise<void> {
    await this.auth.acceptInvitation(req, body.token, body.name, body.password);
  }

  @Get('sessions')
  @RequirePermissions(Permission.SelfManage)
  sessions(@Req() req: FastifyRequest): Promise<SessionInfo[]> {
    return this.auth.listSessions(req.auth!);
  }

  @Delete('sessions/:id')
  @RequirePermissions(Permission.SelfManage)
  @HttpCode(204)
  async revokeSession(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(z.object({ id: z.string().regex(/^[a-f0-9]{64}$/) })))
    params: { id: string },
  ): Promise<void> {
    await this.auth.revokeSession(req, req.auth!, params.id);
  }

  @Delete('sessions')
  @RequirePermissions(Permission.SelfManage)
  async revokeOthers(@Req() req: FastifyRequest): Promise<{ revoked: number }> {
    return { revoked: await this.auth.revokeOtherSessions(req, req.auth!) };
  }

  private recentReauth(req: FastifyRequest): boolean {
    const at = req.auth?.session.reauthAt;
    return !!at && Date.now() - at <= this.config.REAUTH_WINDOW_MINUTES * 60_000;
  }
}
