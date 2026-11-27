export const CATEGORY_TREE = () => 'category:tree';
export const CATEGORY_BY_SLUG = (slug: string) => `category:${slug}`;
export const CATEGORY_BY_PATH = (path: string) => `category:path:${path}`;
export const PRODUCTS_PUBLIC = (page: number, limit: number) =>
  `products:public:page:${page}:limit:${limit}`;
export const PRODUCT_BY_SLUG = (slug: string) => `product:${slug}`;
export const VENDOR_STORE = (storeSlug: string) =>
  `vendor:store:${storeSlug}:v2`;
export const VENDOR_STORE_PRODUCTS = (storeSlug: string) =>
  `vendor:store:${storeSlug}:products:v2`;

// ── TTL Constants ─────────────────────────────────────────────────
// In development, short TTLs (15s) prevent stale cache lockup while retaining deduping.
// In production, high TTLs (30m - 1h) ensure maximum CDN and Redis throughput.
const isDev = process.env.NODE_ENV === 'development';
export const CATEGORY_TTL = isDev ? 15 : 3600; // 15s in dev, 1 hour in prod
export const PRODUCT_TTL = isDev ? 15 : 1800; // 15s in dev, 30 minutes in prod
export const VENDOR_STORE_TTL = isDev ? 15 : 3600; // 15s in dev, 1 hour in prod
