import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SsoController } from './sso.controller';
import { SsoService } from './sso.service';
import { WebAuthnController } from './webauthn.controller';
import { WebAuthnService } from './webauthn.service';

@Module({
  controllers: [AuthController, WebAuthnController, SsoController],
  providers: [AuthService, WebAuthnService, SsoService],
})
export class AuthModule {}
