import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AccountLockGuard } from './guards/account-lock.guard';
import { PaystackWebhookGuard } from './guards/paystack-webhook.guard';
import { BotDetectionMiddleware } from './middleware/bot-detection.middleware';
import { SecurityHeadersMiddleware } from './middleware/security-headers.middleware';
import { AccountLockService } from './services/account-lock.service';
import { TokenService } from './services/token.service';
import { ProgressiveDelayService } from './throttler/progressive-delay.throttler';

@Module({
  imports: [JwtModule.register({})],
  providers: [
    AccountLockService,
    TokenService,
    PaystackWebhookGuard,
    AccountLockGuard,
    ProgressiveDelayService,
    SecurityHeadersMiddleware,
    BotDetectionMiddleware,
  ],
  exports: [
    AccountLockService,
    TokenService,
    PaystackWebhookGuard,
    AccountLockGuard,
    ProgressiveDelayService,
    SecurityHeadersMiddleware,
    BotDetectionMiddleware,
  ],
})
export class SecurityModule {}
