import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '@api/modules/auth/auth.module';
import { MailModule } from '@api/infrastructure/mail/mail.module';
import { ReferralsModule } from '@api/modules/referrals/referrals.module';
import { UsersModule } from '@api/modules/users/users.module';
import { WalletsModule } from '@api/modules/wallets/wallets.module';
import {
  OrderPaymentController,
  PaymentsController,
} from './controllers/payments.controller';
import { OrderConfirmationEmailConsumer } from './consumers/order-confirmation-email.consumer';
import { PaymentWebhookConsumer } from './consumers/payment-webhook.consumer';
import { PaymentConfirmationService } from './services/payment-confirmation.service';
import { PaymentRefundsService } from './services/payment-refunds.service';
import { PaymentsService } from './services/payments.service';
import { PaystackClientService } from './services/paystack-client.service';
import { WebhookInboxService } from './services/webhook-inbox.service';

@Module({
  imports: [
    forwardRef(() => UsersModule),
    forwardRef(() => AuthModule),
    forwardRef(() => WalletsModule),
    forwardRef(() => ReferralsModule),
    MailModule,
  ],
  controllers: [PaymentsController, OrderPaymentController],
  providers: [
    PaymentsService,
    PaymentRefundsService,
    PaymentConfirmationService,
    PaystackClientService,
    WebhookInboxService,
    PaymentWebhookConsumer,
    OrderConfirmationEmailConsumer,
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
