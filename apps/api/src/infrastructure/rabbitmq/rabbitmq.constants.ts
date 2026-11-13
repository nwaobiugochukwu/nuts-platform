export const RABBITMQ_EXCHANGES = {
  TOPIC: 'nuts.events',
  DLX: 'nuts.dlx',
} as const;

export const RABBITMQ_QUEUES = {
  EMAILS: 'q.nuts.emails',
  NOTIFICATIONS: 'q.nuts.notifications',
  ANALYTICS: 'q.nuts.analytics',
  VENDOR_EVENTS: 'q.nuts.vendor-events',
  INVENTORY: 'q.nuts.inventory',
  DLQ: 'q.nuts.dlq',
} as const;

export const RABBITMQ_ROUTING_KEYS = {
  ORDER_CREATED: 'order.created',
  ORDER_CONFIRMED: 'order.confirmed',
  ORDER_STATUS_CHANGED: 'order.status_changed',
  PAYMENT_SUCCESS: 'payment.success',
  NOTIFICATION_DISPATCH: 'notification.dispatch',
  EMAIL_DISPATCH: 'email.dispatch',
  ANALYTICS_EVENT: 'analytics.event',
  VENDOR_FOLLOWED: 'vendor.followed',
  VENDOR_UNFOLLOWED: 'vendor.unfollowed',
} as const;
