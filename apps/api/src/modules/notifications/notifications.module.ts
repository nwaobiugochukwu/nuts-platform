import { EmailConsumer } from './consumers/email.consumer';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RabbitMQModule } from '@api/infrastructure/messaging/rabbitmq/rabbitmq.module';
import { NotificationsConsumer } from './consumers/notifications.consumer';
import { OrderEventNotificationsService } from './services/order-event-notifications.service';
import { OrderEventsConsumer } from './consumers/order-events.consumer';
import { UserEmailsConsumer } from './consumers/user-emails.consumer';
import { NotificationsController } from './controllers/notifications.controller';
import { NotificationsService } from './services/notifications.service';
import { NotificationsSseController } from './controllers/notifications-sse.controller';
import { WebPushService } from './services/web-push.service';
import { PushSubscriptionsController } from './controllers/push-subscriptions.controller';
import { NotificationPreferencesService } from './services/notification-preferences.service';
import { NotificationPreferencesController } from './controllers/notification-preferences.controller';
import { NotificationRetentionJob } from './jobs/notification-retention.job';
import { WishlistAlertsJob } from './jobs/wishlist-alerts.job';
import { VendorFollowConsumer } from './consumers/vendor-follow.consumer';

@Module({
  imports: [RabbitMQModule, AuthModule],
  controllers: [
    NotificationPreferencesController,
    PushSubscriptionsController,
    NotificationsSseController,
    NotificationsController,
  ],
  providers: [
    NotificationsService,
    NotificationsConsumer,
    VendorFollowConsumer,
    OrderEventNotificationsService,
    OrderEventsConsumer,
    UserEmailsConsumer,
    WebPushService,
    NotificationPreferencesService,
    NotificationRetentionJob,
    WishlistAlertsJob,
    EmailConsumer,
  ],
  exports: [
    NotificationsService,
    WebPushService,
    NotificationPreferencesService,
  ],
})
export class NotificationsModule {}
