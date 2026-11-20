import { publicApi } from "@/api/core/client";
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

export const publicDiscountService = {
  /**
   * Fetch active site-wide platform promotions for announcement ticker.
   */
  getPlatformPromos(signal?: AbortSignal) {
    return publicApi.get<PublicPlatformPromoDto[]>("/discounts/public/platform-promos", { signal });
  },

  /**
   * Fetch best discount & available vouchers for a specific product.
   */
  getProductDeals(productId: string, signal?: AbortSignal) {
    return publicApi.get<PublicProductDealDto>(`/discounts/public/for-product/${productId}`, { signal });
  },

  /**
   * Fetch best deals in batch for a list of product IDs (catalog feeds, search, shelves).
   */
  getBatchProductDeals(productIds: string[], signal?: AbortSignal) {
    const payload: BatchProductDiscountsDto = { productIds };
    return publicApi.post<BatchProductDealsResult>("/discounts/public/batch-for-products", payload, { signal });
  },
};
