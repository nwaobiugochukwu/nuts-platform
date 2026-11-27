import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/infrastructure/database/prisma.module';
import { RedisModule } from '@api/infrastructure/cache/redis.module';
import { AnalyticsModule } from '@api/modules/analytics/analytics.module';
import { UsersModule } from '@api/modules/users/users.module';
import { DiscountsModule } from '@api/modules/discounts/discounts.module';
import { CartController } from './controllers/cart.controller';
import { CartService } from './services/cart.service';
import { AbandonedCartJob } from './jobs/abandoned-cart.job';
import { AbandonedCartPurgeJob } from './jobs/abandoned-cart-purge.job';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    UsersModule,
    DiscountsModule,
    AnalyticsModule,
  ],
  controllers: [CartController],
  providers: [CartService, AbandonedCartJob, AbandonedCartPurgeJob],
  exports: [CartService],
})
export class CartModule {}
