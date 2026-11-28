import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '@api/infrastructure/database/prisma.module';
import { RedisModule } from '@api/infrastructure/cache/redis.module';
import { UsersModule } from '@api/modules/users/users.module';
import { DiscountsModule } from '@api/modules/discounts/discounts.module';
import { ReferralsModule } from '@api/modules/referrals/referrals.module';
import { PaymentsModule } from '@api/modules/payments/payments.module';
import { WalletsModule } from '@api/modules/wallets/wallets.module';
import { OrdersController } from './controllers/orders.controller';
import { AdminOrdersController } from './controllers/admin-orders.controller';
import { VendorOrdersController } from './controllers/vendor-orders.controller';
import { OrderCheckoutService } from './services/order-checkout.service';
import { OrderStatusService } from './services/order-status.service';
import { OrdersService } from './services/orders.service';
import { UnpaidOrdersJob } from './jobs/unpaid-orders.job';

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
  providers: [
    OrdersService,
    OrderStatusService,
    OrderCheckoutService,
    UnpaidOrdersJob,
  ],
  exports: [OrdersService],
})
export class OrdersModule {}
