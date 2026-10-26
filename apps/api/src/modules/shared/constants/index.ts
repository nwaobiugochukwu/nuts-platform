export const CACHE_TTL = {
  PRODUCT_VIEWS_FLUSH: 10, // seconds before flushing batched views
  ANALYTICS_SNAPSHOT: 300, // 5 minutes
  PRODUCT_CATALOG: 60, // 1 minute
  CATEGORY_TREE: 300, // 5 minutes
} as const;

export const TRACKING = {
  PRODUCT_VIEW_BATCH_SIZE: 100,
  PRODUCT_VIEW_FLUSH_INTERVAL_MS: 10_000, // 10 seconds
  SEARCH_TRACK_BATCH_SIZE: 50,
} as const;

export const ABANDONED_CART = {
  FIRST_REMINDER_HOURS: 2,
  SECOND_REMINDER_HOURS: 24,
  CRON_SCHEDULE: '0 * * * *', // every hour
} as const;

export const LOW_STOCK = {
  THRESHOLD: 5,
  DUPLICATE_WINDOW_HOURS: 24,
  CRON_SCHEDULE: '0 6 * * *', // daily at 06:00
} as const;

export const VENDOR_SUMMARY = {
  CRON_SCHEDULE: '0 8 * * 1', // every Monday at 08:00
} as const;

export const UNPAID_ORDER_EXPIRATION = {
  get PENDING_TTL_MINUTES(): number {
    const envVal = Number(process.env.UNPAID_ORDER_TTL_MINUTES);
    return Number.isFinite(envVal) && envVal >= 5 && envVal <= 120
      ? Math.floor(envVal)
      : 15;
  },
  BATCH_SIZE: 100,
  CRON_SCHEDULE: '* * * * *', // every minute
  LOCK_TTL_MS: 55 * 1000, // 55 seconds (must be < 60s cron interval)
};

export const SECURITY = {
  MAX_LOGIN_ATTEMPTS: 5,
  LOCKOUT_DURATION_MINUTES: 30,
  PROGRESSIVE_DELAY_BASE_MS: 1000,
  REFRESH_TOKEN_ROTATION: true,
  PAYSTACK_IPS: ['52.31.139.75', '52.49.173.169', '52.214.14.220'],
  MAX_BODY_SIZE_BYTES: 10 * 1024 * 1024, // 10mb
} as const;
