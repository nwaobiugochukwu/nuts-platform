import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthCookieService } from './auth-cookie.service';

@Module({
  imports: [
    /**
     * Required if ConfigModule is not configured globally.
     *
     * If your root ConfigModule uses isGlobal: true, this import is
     * harmless and keeps the module self-contained.
     */
    ConfigModule,
  ],

  providers: [AuthCookieService],

  exports: [AuthCookieService],
})
export class AuthCookiesModule {}
