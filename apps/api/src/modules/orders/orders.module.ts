import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '@api/infrastructure/prisma/prisma.module';
import { RedisModule } from '@api/infrastructure/redis/redis.module';
import { UsersModule } from '@api/modules/users/users.module';
import { DiscountsModule } from '@api/modules/discounts/discounts.module';
import { ReferralsModule } from '@api/modules/referrals/referral.module';
import { PaymentsModule } from '@api/modules/payments/payments.module';
import { WalletsModule } from '@api/modules/wallets/wallets.module';
import { OrdersController } from './controllers/orders.controller';
import { AdminOrdersController } from './controllers/admin-order.controller';
import { VendorOrdersController } from './controllers/vendor-orders.controller';
import { OrdersService } from './orders.service';
import { UnpaidOrdersCron } from './jobs/unpaid-orders.cron';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    forwardRef(() => UsersModule),
    forwardRef(() => DiscountsModule),
    forwardRef(() => ReferralsModule),
    forwardRef(() => PaymentsModule),
    forwardRef(() => WalletsModule),
  ],
  controllers: [
    OrdersController,
    AdminOrdersController,
    VendorOrdersController,
  ],
  providers: [OrdersService, UnpaidOrdersCron],
  exports: [OrdersService],
})
export class OrdersModule {}
