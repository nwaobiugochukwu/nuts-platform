import { CacheWarmupModule } from '@api/bootstrap/cache-warmup/cache-warmup.module';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { SentryModule } from '@sentry/nestjs/setup';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

// ── Framework & Core ──────────────────────────────────────
import { AuditModule } from './modules/audit/audit.module';
import { PerformanceInterceptor } from './common/interceptors/performance.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { OtpGuard } from './modules/auth/guards/otp.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { MaintenanceModeGuard } from './common/guards/maintenance-mode.guard';

// ── Infrastructure Layer ──────────────────────────────────
import { PrismaModule } from './infrastructure/database/prisma.module';
import { RedisModule } from './infrastructure/cache/redis.module';
import { CacheModule } from './infrastructure/cache/cache.module';
import { RedisThrottlerStorage } from './infrastructure/cache/redis-throttler.storage';
import { RabbitMQModule } from './infrastructure/messaging/rabbitmq/rabbitmq.module';
import { IdempotencyModule } from './infrastructure/messaging/idempotency/idempotency.module';
import { OutboxModule } from './infrastructure/messaging/outbox/outbox.module';
import { TransactionModule } from './infrastructure/database/transaction.module';
import { MetricsModule } from './infrastructure/observability/metrics/metrics.module';
import { TemporalModule } from './infrastructure/workflows/temporal.module';
import { HeartbeatModule } from './infrastructure/observability/health/heartbeat.module';
import { RequestContextMiddleware } from './common/request-context/request-context.middleware';
import { ResilienceModule } from './infrastructure/resilience/resilience.module';
import { MailModule } from './infrastructure/mail/mail.module';
import { CloudinaryModule } from './infrastructure/storage/cloudinary.module';
import { validateEnv } from './config/env.validation';
import { pinoLoggerConfig } from './config/logger.config';

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
import { WishlistsModule } from './modules/wishlists/wishlists.module';
import { ReferralsModule } from './modules/referrals/referrals.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { SearchModule } from './modules/search/search.module';
import { UploadModule } from './modules/upload/upload.module';
import { SecurityModule } from './modules/security/security.module';
import { HealthModule } from './modules/health/health.module';
import { AnnouncementsModule } from './modules/announcements/announcements.module';
import { PlatformModule } from './modules/platform/platform.module';
import { StaffModule } from './modules/staff/staff.module';
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
    AuditModule,
    PrismaModule,
    RedisModule,
    CacheModule,
    RabbitMQModule,
    OutboxModule,
    IdempotencyModule,
    TransactionModule,
    MetricsModule,
    TemporalModule,
    HeartbeatModule,
    ResilienceModule,
    MailModule,
    CloudinaryModule,

    // ── Direct Feature Modules ────────────────────────────
    AuthModule,
    UsersModule,
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
    VendorsModule,
    UploadModule,
    SecurityModule,
    HealthModule,
    CacheWarmupModule,
    StaffModule,
    PlatformModule,
    AnnouncementsModule,
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
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Runs after the pino HTTP logger so the request id it assigned is available.
    consumer.apply(RequestContextMiddleware).forRoutes('*path');
  }
}
