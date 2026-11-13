export const DomainEvents = {
  // ── Order Events ──────────────────────────────────────
  ORDER_PROCESSING: 'order.processing',
  ORDER_SHIPPED: 'order.shipped',
  ORDER_DELIVERED: 'order.delivered',
  ORDER_CANCELLED: 'order.cancelled',

  // ── Payment Events ────────────────────────────────────
  PAYMENT_CONFIRMED: 'payment.confirmed',
  PAYMENT_FAILED: 'payment.failed',
  PAYMENT_REFUNDED: 'payment.refunded',

  // ── Referral Events ───────────────────────────────────
  REFERRAL_REWARD_CREDITED: 'referral.reward.credited',

  // ── Cart Events ───────────────────────────────────────
  CART_ABANDONED: 'cart.abandoned',
  CART_CHECKED_OUT: 'cart.checked_out',

  // ── Tracking Events ──────────────────────────────────
  PRODUCT_VIEWED: 'tracking.product.viewed',
  SEARCH_PERFORMED: 'tracking.search.performed',

  // ── Inventory Events ─────────────────────────────────
  LOW_STOCK_DETECTED: 'inventory.low_stock.detected',
  STOCK_RESTORED: 'inventory.stock.restored',

  // ── Vendor Events ──────────────────────────────────
  VENDOR_EARNINGS_CREDITED: 'vendor.earnings.credited',
  VENDOR_WEEKLY_SUMMARY: 'vendor.weekly.summary',
  VENDOR_FOLLOWED: 'vendor.followed',
  VENDOR_UNFOLLOWED: 'vendor.unfollowed',
} as const;

export type DomainEvent = (typeof DomainEvents)[keyof typeof DomainEvents];
