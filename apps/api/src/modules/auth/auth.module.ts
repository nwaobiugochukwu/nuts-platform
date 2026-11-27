import { VendorAuthController } from './controllers/vendor-auth.controller';
import { VendorAuthService } from './services/vendor-auth.service';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ReferralsModule } from '@api/modules/referrals/referrals.module';
import { SecurityModule } from '@api/modules/security/security.module';
import { AuthController } from './controllers/auth.controller';
import { AuthService } from './services/auth.service';
import { AdminAuthController } from './controllers/admin-auth.controller';
import { AdminAuthService } from './services/admin-auth.service';
import { OtpService } from './services/otp.service';
import { AuthSessionService } from './services/auth-session.service';
import { DeviceTrackingService } from './services/device-tracking.service';
import { RefreshSessionService } from './services/refresh-session.service';
import { AuthCookiesModule } from './auth-cookies.module';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import { JwtStrategy } from './strategies/access/jwt.strategy';
import { GoogleAuthService } from './services/google-auth.service';
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
    VendorAuthService,
    OtpService,
    AuthSessionService,
    DeviceTrackingService,
    RefreshSessionService,
    GoogleAuthService,
    JwtStrategy,
    JwtRefreshStrategy,
    JwtRefreshGuard,
    RegistrationsGuard,
  ],
  controllers: [AuthController, AdminAuthController, VendorAuthController],
  exports: [
    AuthService,
    AdminAuthService,
    VendorAuthService,
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
