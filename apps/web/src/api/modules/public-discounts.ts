import { publicApi, userApi } from "@/api/core/client";
import type {
  BatchProductDiscountsDto,
  ProductVoucherSummaryDto,
  PublicPlatformPromoDto,
  PublicProductDealDto,
} from "@/api/dto/discount";

export interface BatchProductDealsResult {
  [productId: string]: {
    bestDiscount: (ProductVoucherSummaryDto & { dealPrice: number }) | null;
    unlockableDiscount?: (ProductVoucherSummaryDto & {
      minOrderAmount: number;
      minOrderShortfall: number;
    }) | null;
  };
}

interface ProductDealRequest {
  promise: Promise<BatchProductDealsResult[string] | undefined>;
  resolve: (result: BatchProductDealsResult[string] | undefined) => void;
  reject: (error: unknown) => void;
}

interface CachedProductDeal {
  value: BatchProductDealsResult[string] | undefined;
  expiresAt: number;
}

const pendingProductIds = new Set<string>();
let pendingAuthenticated = false;
let batchFlushTimer: ReturnType<typeof setTimeout> | undefined;
let batchFirstQueuedAt: number | undefined;

const productDealRequests = new Map<string, ProductDealRequest>();
const productDealCache = new Map<string, CachedProductDeal>();
const PRODUCT_DEAL_CACHE_MS = 180_000;
const PRODUCT_DEAL_BATCH_DEBOUNCE_MS = 300;
const PRODUCT_DEAL_BATCH_MAX_WAIT_MS = 800;

async function flushProductDealBatch() {
  if (batchFlushTimer) {
    clearTimeout(batchFlushTimer);
    batchFlushTimer = undefined;
  }
  batchFirstQueuedAt = undefined;
  if (pendingProductIds.size === 0) return;

  const ids = Array.from(pendingProductIds);
  pendingProductIds.clear();

  const client = pendingAuthenticated ? userApi : publicApi;
  pendingAuthenticated = false;

  const result: BatchProductDealsResult = {};

  try {
    for (let offset = 0; offset < ids.length; offset += 100) {
      const chunk = ids.slice(offset, offset + 100);
      const response = await client.post<BatchProductDealsResult>(
        "/public/discounts/best-value-deal",
        { productIds: chunk } satisfies BatchProductDiscountsDto,
      );
      const payload = (response.data as { data?: BatchProductDealsResult })?.data ?? response.data;
      Object.assign(result, payload);
    }

    for (const productId of ids) {
      const value = result[productId];
      productDealCache.set(productId, { value, expiresAt: Date.now() + PRODUCT_DEAL_CACHE_MS });
      const request = productDealRequests.get(productId);
      if (!request) continue;
      productDealRequests.delete(productId);
      request.resolve(value);
    }
  } catch (error) {
    for (const productId of ids) {
      const request = productDealRequests.get(productId);
      if (!request) continue;
      productDealRequests.delete(productId);
      request.reject(error);
    }
  }
}

function queueBatchProductDeals(
  productIds: string[],
  authenticated = false,
): Promise<BatchProductDealsResult> {
  const ids = Array.from(new Set(productIds.filter(Boolean)));
  if (authenticated) {
    pendingAuthenticated = true;
  }

  let newlyQueued = false;
  const resultEntries = ids.map((productId) => {
    const cached = productDealCache.get(productId);
    if (cached && cached.expiresAt > Date.now()) {
      return [productId, Promise.resolve(cached.value)] as const;
    }
    if (cached) productDealCache.delete(productId);

    let request = productDealRequests.get(productId);
    if (!request) {
      let resolve!: ProductDealRequest["resolve"];
      let reject!: ProductDealRequest["reject"];
      const promise = new Promise<BatchProductDealsResult[string] | undefined>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      request = { promise, resolve, reject };
      productDealRequests.set(productId, request);

      pendingProductIds.add(productId);
      newlyQueued = true;
    }
    return [productId, request.promise] as const;
  });

  if (newlyQueued) {
    const now = Date.now();
    if (!batchFirstQueuedAt) {
      batchFirstQueuedAt = now;
    }
    const elapsed = now - batchFirstQueuedAt;
    const remainingMax = Math.max(50, PRODUCT_DEAL_BATCH_MAX_WAIT_MS - elapsed);
    const delay = Math.min(PRODUCT_DEAL_BATCH_DEBOUNCE_MS, remainingMax);

    if (batchFlushTimer) clearTimeout(batchFlushTimer);
    batchFlushTimer = setTimeout(() => {
      void flushProductDealBatch();
    }, delay);
  }

  return Promise.all(resultEntries.map(async ([productId, promise]) => [productId, await promise] as const))
    .then((entries) => {
      const result: BatchProductDealsResult = {};
      for (const [productId, value] of entries) {
        if (value !== undefined) result[productId] = value;
      }
      return result;
    });
}

export const publicDiscountService = {
  /**
   * Fetch active site-wide platform promotions for announcement ticker.
   */
  getPlatformPromos(authenticated = false, signal?: AbortSignal) {
    const client = authenticated ? userApi : publicApi;
    return client.get<PublicPlatformPromoDto[]>("/public/discounts/campaigns", { signal });
  },

  /**
   * Fetch best discount & available vouchers for a specific product.
   */
  getProductDeals(productId: string, authenticated = false, signal?: AbortSignal) {
    const client = authenticated ? userApi : publicApi;
    return client.get<PublicProductDealDto>(
      `/public/discounts/${encodeURIComponent(productId)}/available-product-deals-and-vouchers`,
      { signal },
    );
  },

  /**
   * Fetch best deals in batch for a list of product IDs (catalog feeds, search, shelves).
   */
  getBatchProductDeals(
    productIds: string[],
    authenticated = false,
  ) {
    return queueBatchProductDeals(productIds, authenticated);
  },
};
