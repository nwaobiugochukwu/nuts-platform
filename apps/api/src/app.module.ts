import { Module } from '@nestjs/common';
import { SentryModule } from '@sentry/nestjs/setup';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

// ── Framework & Core ──────────────────────────────────────
import { AuditLogModule } from './common/audit-log/audit-log.module';
import { PerformanceInterceptor } from './common/interceptors/performance.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { OtpGuard } from './common/guards/otp.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { MaintenanceModeGuard } from './common/guards/maintenance-mode.guard';

// ── Infrastructure Layer ──────────────────────────────────
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { CacheModule } from './infrastructure/cache/cache.module';
import { RedisThrottlerStorage } from './infrastructure/cache/redis-throttler.storage';
import { RabbitMQModule } from './infrastructure/rabbitmq/rabbitmq.module';
import { OutboxModule } from './infrastructure/outbox/outbox.module';
import { ResiliencyModule } from './infrastructure/resiliency/resiliency.module';
import { MailModule } from './infrastructure/mail/mail.module';
import { CloudinaryModule } from './infrastructure/cloudinary/cloudinary.module';
import { validateEnv } from './infrastructure/configuration/env.validation';
import { pinoLoggerConfig } from './infrastructure/configuration/logger.config';

// ── Direct Feature Slices (Screaming Architecture) ────────
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { VendorsModule } from './modules/vendors/vendors.module';
import { ProductsModule } from './modules/products/products.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { CartModule } from './modules/cart/cart.module';
import { OrdersModule } from './modules/orders/orders.module';
import { DiscountsModule } from './modules/discounts/discounts.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { WalletsModule } from './modules/wallets/wallets.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { WishlistsModule } from './modules/wishlists/wishlist.module';
import { ReferralsModule } from './modules/referrals/referral.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { SearchModule } from './modules/search/search.module';
import { UploadModule } from './modules/upload/upload.module';
import { SecurityModule } from './modules/security/security.module';
import { HealthModule } from './modules/health/health.module';
import { AdminModule } from './modules/admin/admin.module';
import { RecommendationsModule } from './modules/recommendations/recommendations.module';

@Module({
  imports: [
    SentryModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        `.env.${process.env.NODE_ENV}.local`,
        process.env.NODE_ENV !== 'test' ? '.env.local' : null,
        `.env.${process.env.NODE_ENV}`,
        '.env',
        `apps/api/.env.${process.env.NODE_ENV}.local`,
        `apps/api/.env.${process.env.NODE_ENV}`,
        'apps/api/.env',
      ].filter(Boolean) as string[],
      validate: validateEnv,
    }),
    LoggerModule.forRoot(pinoLoggerConfig()),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot({
      wildcard: false,
      delimiter: '.',
      newListener: false,
      removeListener: false,
      maxListeners: 20,
      verboseMemoryLeak: false,
      ignoreErrors: false,
    }),
    ThrottlerModule.forRootAsync({
      inject: ['REDIS_CLIENT'],
      useFactory: (redis: import('ioredis').default) => ({
        throttlers: [
          {
            name: 'default',
            ttl: 60_000,
            limit: 100,
          },
        ],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),

    // ── Infrastructure Layer ──────────────────────────────
    AuditLogModule,
    PrismaModule,
    RedisModule,
    CacheModule,
    RabbitMQModule,
    OutboxModule,
    ResiliencyModule,
    MailModule,
    CloudinaryModule,

    // ── Direct Feature Modules ────────────────────────────
    AuthModule,
    UsersModule,
    VendorsModule,
    ProductsModule,
    CategoriesModule,
    CartModule,
    OrdersModule,
    DiscountsModule,
    PaymentsModule,
    WalletsModule,
    ReviewsModule,
    WishlistsModule,
    ReferralsModule,
    NotificationsModule,
    AnalyticsModule,
    SearchModule,
    UploadModule,
    SecurityModule,
    HealthModule,
    AdminModule,
    RecommendationsModule,
  ],

  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: OtpGuard },
    { provide: APP_GUARD, useClass: MaintenanceModeGuard },
    { provide: APP_INTERCEPTOR, useClass: PerformanceInterceptor },
  ],
})
export class AppModule {}
