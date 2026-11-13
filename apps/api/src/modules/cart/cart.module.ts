import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/infrastructure/prisma/prisma.module';
import { RedisModule } from '@api/infrastructure/redis/redis.module';
import { AnalyticsModule } from '@api/modules/analytics/analytics.module';
import { UsersModule } from '@api/modules/users/users.module';
import { DiscountsModule } from '@api/modules/discounts/discounts.module';
import { CartController } from './controllers/cart.controller';
import { CartService } from './cart.service';
import { AbandonedCartCron } from './jobs/abandoned-cart.cron';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    UsersModule,
    DiscountsModule,
    AnalyticsModule,
  ],
  controllers: [CartController],
  providers: [CartService, AbandonedCartCron],
  exports: [CartService],
})
export class CartModule {}
