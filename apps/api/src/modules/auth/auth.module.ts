import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ReferralsModule } from '@api/modules/referrals/referral.module';
import { SecurityModule } from '@api/modules/security/security.module';
import { AuthController } from './controllers/auth.controller';
import { AuthService } from './auth.service';
import { AdminAuthController } from './controllers/admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { OtpService } from './otp/otp.service';
import { AuthSessionService } from './sessions/auth-session.service';
import { RefreshSessionService } from './sessions/refresh-session.service';
import { AuthCookiesModule } from './cookies/auth-cookie.module';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import { JwtStrategy } from './strategies/access/jwt.strategy';
import { GoogleAuthService } from './google-auth.service';
import { JwtRefreshStrategy } from './strategies/refresh/jwt-refresh.strategy';
import { RegistrationsGuard } from '@api/common/guards/registrations.guard';

@Module({
  imports: [
    AuthCookiesModule,
    ReferralsModule,
    SecurityModule,
    PassportModule.register({
      session: false,
      defaultStrategy: 'jwt',
    }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        issuer: config.getOrThrow<string>('JWT_ISSUER'),
        audience: config.getOrThrow<string>('JWT_ACCESS_AUDIENCE'),
        signOptions: {
          algorithm: 'HS256' as const,
        },
      }),
    }),
  ],
  providers: [
    AuthService,
    AdminAuthService,
    OtpService,
    AuthSessionService,
    RefreshSessionService,
    GoogleAuthService,
    JwtStrategy,
    JwtRefreshStrategy,
    JwtRefreshGuard,
    RegistrationsGuard,
  ],
  controllers: [AuthController, AdminAuthController],
  exports: [
    AuthService,
    AdminAuthService,
    OtpService,
    AuthCookiesModule,
    GoogleAuthService,
    JwtStrategy,
    JwtRefreshStrategy,
    JwtRefreshGuard,
    AuthSessionService,
    RefreshSessionService,
  ],
})
export class AuthModule {}
