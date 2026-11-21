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
  };
}

interface PendingBatch {
  productIds: Set<string>;
  authenticated: boolean;
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

const pendingBatches = new Map<string, PendingBatch>();
const productDealRequests = new Map<string, Map<string, ProductDealRequest>>();
const productDealCache = new Map<string, Map<string, CachedProductDeal>>();
const PRODUCT_DEAL_CACHE_MS = 45_000;
const PRODUCT_DEAL_BATCH_WINDOW_MS = 25;

function getOrCreateMap<K, V>(map: Map<string, Map<K, V>>, key: string) {
  let value = map.get(key);
  if (!value) {
    value = new Map<K, V>();
    map.set(key, value);
  }
  return value;
}

async function flushProductDealBatch(shopperKey: string) {
  const pending = pendingBatches.get(shopperKey);
  if (!pending) return;
  pendingBatches.delete(shopperKey);

  const requests = productDealRequests.get(shopperKey);
  if (!requests) return;
  const client = pending.authenticated ? userApi : publicApi;
  const ids = Array.from(pending.productIds);
  const result: BatchProductDealsResult = {};
  const cache = getOrCreateMap(productDealCache, shopperKey);

  try {
    for (let offset = 0; offset < ids.length; offset += 100) {
      const chunk = ids.slice(offset, offset + 100);
      const response = await client.post<BatchProductDealsResult>(
        "/public/discounts/products/batch",
        { productIds: chunk } satisfies BatchProductDiscountsDto,
      );
      Object.assign(result, response.data);
    }

    for (const productId of ids) {
      const value = result[productId];
      cache.set(productId, { value, expiresAt: Date.now() + PRODUCT_DEAL_CACHE_MS });
      const request = requests.get(productId);
      if (!request) continue;
      requests.delete(productId);
      request.resolve(value);
    }
  } catch (error) {
    for (const productId of ids) {
      const request = requests.get(productId);
      if (!request) continue;
      requests.delete(productId);
      request.reject(error);
    }
  }
}

function queueBatchProductDeals(
  productIds: string[],
  authenticated: boolean,
  shopperKey: string,
): Promise<BatchProductDealsResult> {
  const ids = Array.from(new Set(productIds.filter(Boolean)));
  const cache = getOrCreateMap(productDealCache, shopperKey);
  const requests = getOrCreateMap(productDealRequests, shopperKey);
  const resultEntries = ids.map((productId) => {
    const cached = cache.get(productId);
    if (cached && cached.expiresAt > Date.now()) {
      return [productId, Promise.resolve(cached.value)] as const;
    }
    if (cached) cache.delete(productId);

    let request = requests.get(productId);
    if (!request) {
      let resolve!: ProductDealRequest["resolve"];
      let reject!: ProductDealRequest["reject"];
      const promise = new Promise<BatchProductDealsResult[string] | undefined>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      request = { promise, resolve, reject };
      requests.set(productId, request);

      let pending = pendingBatches.get(shopperKey);
      if (!pending) {
        pending = {
          productIds: new Set(),
          authenticated,
        };
        pendingBatches.set(shopperKey, pending);
        setTimeout(() => void flushProductDealBatch(shopperKey), PRODUCT_DEAL_BATCH_WINDOW_MS);
      }
      pending.productIds.add(productId);
    }
    return [productId, request.promise] as const;
  });

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
    return client.get<PublicPlatformPromoDto[]>("/public/discounts", { signal });
  },

  /**
   * Fetch best discount & available vouchers for a specific product.
   */
  getProductDeals(productId: string, authenticated = false, signal?: AbortSignal) {
    const client = authenticated ? userApi : publicApi;
    return client.get<PublicProductDealDto>(`/public/discounts/products/${productId}`, { signal });
  },

  /**
   * Fetch best deals in batch for a list of product IDs (catalog feeds, search, shelves).
   */
  getBatchProductDeals(
    productIds: string[],
    authenticated = false,
    shopperKey = authenticated ? "authenticated" : "guest",
  ) {
    return queueBatchProductDeals(productIds, authenticated, shopperKey);
  },
};
