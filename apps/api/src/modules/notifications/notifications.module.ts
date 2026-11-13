import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RabbitMQModule } from '@api/infrastructure/rabbitmq/rabbitmq.module';
import { NotificationsConsumer } from './consumers/notifications.consumer';
import { NotificationListener } from './listeners/notification.listener';
import { NotificationsController } from './controllers/notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsSseController } from './controllers/notifications-sse.controller';
import { WebPushService } from './push/push.service';
import { PushSubscriptionsController } from './controllers/push.controller';
import { NotificationPreferencesService } from './preferences/preferences.service';
import { NotificationPreferencesController } from './controllers/preferences.controller';
import { NotificationRetentionCron } from './jobs/notification-retention.cron';
import { WishlistAlertsCron } from './jobs/wishlist-alerts.cron';
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
    NotificationRetentionCron,
    WishlistAlertsCron,
  ],
  exports: [
    NotificationsService,
    WebPushService,
    NotificationPreferencesService,
  ],
})
export class NotificationsModule {}
