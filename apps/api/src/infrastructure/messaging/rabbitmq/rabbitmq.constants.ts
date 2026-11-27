import { DomainEvents } from '../events/domain-events.constants';

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
  AUDIT: 'q.nuts.audit',
  ORDER_EVENTS: 'q.nuts.order-events',
  PAYMENT_WEBHOOKS: 'q.nuts.payment-webhooks',
  WORKFLOWS: 'q.nuts.workflows',
  DLQ: 'q.nuts.dlq',
} as const;

/**
 * Routing keys for commands (do this) and for the few feeds that are not domain events. Domain
 * events (facts such as `order.shipped`) are listed in `DomainEvents` and use their own name as
 * the routing key.
 */
export const RABBITMQ_ROUTING_KEYS = {
  NOTIFICATION_DISPATCH: 'notification.dispatch',
  EMAIL_DISPATCH: 'email.dispatch',
  ANALYTICS_EVENT: 'analytics.event',
  INVENTORY_ADJUST: 'inventory.adjust',
  VENDOR_FOLLOWED: 'vendor.followed',
  VENDOR_UNFOLLOWED: 'vendor.unfollowed',
  AUDIT_EVENT: 'audit.event',
  WORKFLOW_START: 'workflow.start',
} as const;

/**
 * Each work queue belongs to one consumer, and is bound only to the exact keys that consumer
 * handles. No wildcards: a wildcard such as `order.*` would deliver every future order event to
 * a consumer that cannot read it. Cron jobs publish to a queue by its own name, so each queue is
 * also bound under that name until they publish commands instead.
 */
export const QUEUE_BINDINGS: Record<
  Exclude<(typeof RABBITMQ_QUEUES)[keyof typeof RABBITMQ_QUEUES], 'q.nuts.dlq'>,
  readonly string[]
> = {
  [RABBITMQ_QUEUES.EMAILS]: [
    RABBITMQ_QUEUES.EMAILS,
    RABBITMQ_ROUTING_KEYS.EMAIL_DISPATCH,
  ],
  [RABBITMQ_QUEUES.NOTIFICATIONS]: [
    RABBITMQ_QUEUES.NOTIFICATIONS,
    RABBITMQ_ROUTING_KEYS.NOTIFICATION_DISPATCH,
  ],
  [RABBITMQ_QUEUES.ANALYTICS]: [RABBITMQ_ROUTING_KEYS.ANALYTICS_EVENT],
  [RABBITMQ_QUEUES.VENDOR_EVENTS]: [
    RABBITMQ_ROUTING_KEYS.VENDOR_FOLLOWED,
    RABBITMQ_ROUTING_KEYS.VENDOR_UNFOLLOWED,
  ],
  [RABBITMQ_QUEUES.INVENTORY]: [RABBITMQ_ROUTING_KEYS.INVENTORY_ADJUST],
  [RABBITMQ_QUEUES.AUDIT]: [RABBITMQ_ROUTING_KEYS.AUDIT_EVENT],
  // Stored Paystack webhooks waiting to be applied (the webhook inbox).
  [RABBITMQ_QUEUES.PAYMENT_WEBHOOKS]: [DomainEvents.PAYMENT_WEBHOOK_RECEIVED],
  // Order, payment and referral facts that turn into emails and notifications.
  [RABBITMQ_QUEUES.ORDER_EVENTS]: [
    DomainEvents.ORDER_PROCESSING,
    DomainEvents.ORDER_SHIPPED,
    DomainEvents.ORDER_DELIVERED,
    DomainEvents.ORDER_CANCELLED,
    DomainEvents.PAYMENT_CONFIRMED,
    DomainEvents.PAYMENT_FAILED,
    DomainEvents.REFERRAL_REWARD_CREDITED,
  ],
  [RABBITMQ_QUEUES.WORKFLOWS]: [RABBITMQ_ROUTING_KEYS.WORKFLOW_START],
};

/**
 * Bindings earlier versions created. Declaring a queue never removes a binding, so a broker that
 * already has them keeps routing to the old keys until they are unbound at connect.
 */
export const OBSOLETE_BINDINGS: ReadonlyArray<{ queue: string; key: string }> =
  [
    { queue: RABBITMQ_QUEUES.EMAILS, key: 'email.*' },
    { queue: RABBITMQ_QUEUES.EMAILS, key: 'order.*' },
    { queue: RABBITMQ_QUEUES.NOTIFICATIONS, key: 'notification.*' },
    { queue: RABBITMQ_QUEUES.NOTIFICATIONS, key: 'order.*' },
    { queue: RABBITMQ_QUEUES.NOTIFICATIONS, key: 'payment.*' },
    { queue: RABBITMQ_QUEUES.INVENTORY, key: 'inventory.*' },
  ];
