import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '@api/modules/auth/auth.module';
import { MailModule } from '@api/infrastructure/mail/mail.module';
import { ReferralsModule } from '@api/modules/referrals/referral.module';
import { UsersModule } from '@api/modules/users/users.module';
import { WalletsModule } from '@api/modules/wallets/wallets.module';
import {
  OrderPaymentCanonicalController,
  PaymentsController,
} from './controllers/payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [
    forwardRef(() => UsersModule),
    forwardRef(() => AuthModule),
    forwardRef(() => WalletsModule),
    forwardRef(() => ReferralsModule),
    MailModule,
  ],
  controllers: [PaymentsController, OrderPaymentCanonicalController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
