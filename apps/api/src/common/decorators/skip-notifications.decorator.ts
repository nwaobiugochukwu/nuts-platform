import { SetMetadata } from '@nestjs/common';

export const SKIP_NOTIFICATIONS_KEY = 'skip_notifications';

/**
 * Decorator to skip sending notifications for a specific route/handler.
 */
export const SkipNotifications = () =>
  SetMetadata(SKIP_NOTIFICATIONS_KEY, true);
