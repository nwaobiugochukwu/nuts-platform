/**
 * The catalog of domain events: every fact the platform publishes (docs/architecture/
 * event-driven-and-resilience-audit.md, section 5; rules in ADR 0007).
 *
 * A name is `<aggregate>.<fact>`: the aggregate first, then the past-tense fact in snake_case.
 * `domain-events.constants.spec.ts` enforces the rule and that no name appears twice. An event
 * listed here is not necessarily published yet; the catalog table in the audit says which are.
 *
 * Commands (do this: `email.dispatch`, `notification.dispatch`, `workflow.start`,
 * `analytics.event`) are not facts and live in RABBITMQ_ROUTING_KEYS.
 */
export const DomainEvents = {
  // ── Identity ──────────────────────────────────────────
  USER_REGISTERED: 'user.registered',
  USER_OTP_REQUESTED: 'user.otp_requested',
  USER_PASSWORD_RESET_REQUESTED: 'user.password_reset_requested',
  USER_PASSWORD_CHANGED: 'user.password_changed',
  USER_LOGIN_FROM_NEW_DEVICE: 'user.login_from_new_device',
  USER_SUSPENDED: 'user.suspended',
  USER_REACTIVATED: 'user.reactivated',
  USER_DELETION_REQUESTED: 'user.deletion_requested',
  USER_DELETED: 'user.deleted',

  // ── Vendors ───────────────────────────────────────────
  VENDOR_REGISTERED: 'vendor.registered',
  VENDOR_APPROVED: 'vendor.approved',
  VENDOR_REJECTED: 'vendor.rejected',
  VENDOR_VERIFIED: 'vendor.verified',
  VENDOR_DEACTIVATED: 'vendor.deactivated',
  VENDOR_REACTIVATED: 'vendor.reactivated',
  VENDOR_FOLLOWED: 'vendor.followed',
  VENDOR_UNFOLLOWED: 'vendor.unfollowed',
  VENDOR_WEEKLY_SUMMARY_READY: 'vendor.weekly_summary_ready',
  VENDOR_EARNINGS_AVAILABLE: 'vendor.earnings_available',

  // ── Catalog ───────────────────────────────────────────
  PRODUCT_CREATED: 'product.created',
  PRODUCT_UPDATED: 'product.updated',
  PRODUCT_PUBLISHED: 'product.published',
  PRODUCT_UNPUBLISHED: 'product.unpublished',
  PRODUCT_DELETED: 'product.deleted',
  PRODUCT_PRICE_CHANGED: 'product.price_changed',
  PRODUCT_LOW_STOCK_DETECTED: 'product.low_stock_detected',
  PRODUCT_OUT_OF_STOCK: 'product.out_of_stock',
  PRODUCT_RESTOCKED: 'product.restocked',
  CATEGORY_CHANGED: 'category.changed',
  REVIEW_CREATED: 'review.created',
  REVIEW_UPDATED: 'review.updated',
  REVIEW_DELETED: 'review.deleted',
  IMAGE_UPLOADED: 'image.uploaded',
  IMAGE_PROCESSED: 'image.processed',

  // ── Cart ──────────────────────────────────────────────
  CART_ABANDONED: 'cart.abandoned',
  CART_CHECKED_OUT: 'cart.checked_out',

  // ── Orders ────────────────────────────────────────────
  ORDER_PLACED: 'order.placed',
  ORDER_PAID: 'order.paid',
  ORDER_PROCESSING: 'order.processing',
  ORDER_SHIPPED: 'order.shipped',
  ORDER_DELIVERED: 'order.delivered',
  ORDER_CANCELLED: 'order.cancelled',
  ORDER_EXPIRED: 'order.expired',

  // ── Payments ──────────────────────────────────────────
  PAYMENT_INITIATED: 'payment.initiated',
  PAYMENT_CONFIRMED: 'payment.confirmed',
  PAYMENT_FAILED: 'payment.failed',
  PAYMENT_REFUND_REQUESTED: 'payment.refund_requested',
  PAYMENT_REFUNDED: 'payment.refunded',
  PAYMENT_REFUND_FAILED: 'payment.refund_failed',
  PAYMENT_RECONCILIATION_NEEDED: 'payment.reconciliation_needed',
  PAYMENT_WEBHOOK_RECEIVED: 'payment.webhook_received',

  // ── Wallets ───────────────────────────────────────────
  WALLET_CREDITED: 'wallet.credited',
  WALLET_DEBITED: 'wallet.debited',
  PAYOUT_REQUESTED: 'payout.requested',
  PAYOUT_PROCESSED: 'payout.processed',
  PAYOUT_FAILED: 'payout.failed',

  // ── Promotions ────────────────────────────────────────
  DISCOUNT_CREATED: 'discount.created',
  DISCOUNT_ACTIVATED: 'discount.activated',
  DISCOUNT_EXPIRED: 'discount.expired',
  DISCOUNT_USED: 'discount.used',
  VOUCHER_CLAIMED: 'voucher.claimed',

  // ── Referrals ─────────────────────────────────────────
  REFERRAL_CODE_APPLIED: 'referral.code_applied',
  REFERRAL_REWARD_CREDITED: 'referral.reward_credited',

  // ── Notifications ─────────────────────────────────────
  PUSH_DELIVERY_FAILED: 'push.delivery_failed',

  // ── Shopper activity ──────────────────────────────────
  // Everything a shopper does that analytics and recommendations learn from. One namespace,
  // `shopper.<what they did>`; these are behaviour signals, not business facts about a cart or a
  // wishlist (those, if a consumer ever needs them, would be `cart.*` and `wishlist.*`).
  SHOPPER_PRODUCT_VIEWED: 'shopper.product_viewed',
  SHOPPER_SEARCHED: 'shopper.searched',
  SHOPPER_STORE_VIEWED: 'shopper.store_viewed',
  SHOPPER_CART_ITEM_ADDED: 'shopper.cart_item_added',
  SHOPPER_CART_ITEM_REMOVED: 'shopper.cart_item_removed',
  SHOPPER_WISHLIST_ITEM_ADDED: 'shopper.wishlist_item_added',
  SHOPPER_WISHLIST_ITEM_REMOVED: 'shopper.wishlist_item_removed',
  /** A recommendation shelf item scrolled into view. */
  SHOPPER_SHELF_ITEM_SEEN: 'shopper.shelf_item_seen',
  SHOPPER_SHELF_ITEM_CLICKED: 'shopper.shelf_item_clicked',
  SHOPPER_SHELF_ITEM_DISMISSED: 'shopper.shelf_item_dismissed',
  /** Opened a category from a shelf or the browse page. */
  SHOPPER_CATEGORY_VIEWED: 'shopper.category_viewed',

  // ── Platform ──────────────────────────────────────────
  ANNOUNCEMENT_PUBLISHED: 'announcement.published',
  ANNOUNCEMENT_SCHEDULED: 'announcement.scheduled',
  PLATFORM_CONFIG_CHANGED: 'platform.config_changed',
  AUDIT_RECORDED: 'audit.recorded',

  // ── Security ──────────────────────────────────────────
  SECURITY_BOT_BLOCKED: 'security.bot_blocked',
  SECURITY_RATE_LIMITED: 'security.rate_limited',
  SECURITY_SUSPICIOUS_ACTIVITY: 'security.suspicious_activity',

  // ── Operations ────────────────────────────────────────
  DLQ_MESSAGE_DEAD_LETTERED: 'dlq.message_dead_lettered',
  OUTBOX_EVENT_DEAD: 'outbox.event_dead',
} as const;

export type DomainEvent = (typeof DomainEvents)[keyof typeof DomainEvents];
