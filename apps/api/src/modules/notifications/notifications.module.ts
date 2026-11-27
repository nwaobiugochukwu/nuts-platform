import { EmailConsumer } from './consumers/email.consumer';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RabbitMQModule } from '@api/infrastructure/messaging/rabbitmq/rabbitmq.module';
import { NotificationsConsumer } from './consumers/notifications.consumer';
import { NotificationListener } from './listeners/notification.listener';
import { NotificationsController } from './controllers/notifications.controller';
import { NotificationsService } from './services/notifications.service';
import { NotificationsSseController } from './controllers/notifications-sse.controller';
import { WebPushService } from './services/push.service';
import { PushSubscriptionsController } from './controllers/push.controller';
import { NotificationPreferencesService } from './services/preferences.service';
import { NotificationPreferencesController } from './controllers/preferences.controller';
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
    NotificationListener,
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
