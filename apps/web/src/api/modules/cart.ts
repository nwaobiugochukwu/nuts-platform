import { userApi } from "@/api/core/client";
import type {
AddToCartResponseDto,
AddedFromType,
CartResponseDto,
DiscountPreviewDto,
RemoveCartItemResponseDto,
} from "@/api/dto/cart";
import type { RecommendationAttribution } from "@/api/modules/analytics";

export interface AddToCartPayload {
  quantity?: number;
  variantId?: string;
  addedFrom?: AddedFromType;
  recommendationContext?: RecommendationAttribution;
}

export interface UpdateCartItemPayload {
  quantity: number;
  variantId?: string;
}

export const cartService = {
  get() {
    return userApi.get<CartResponseDto>("/cart");
  },
  addItem(productId: string, payload: AddToCartPayload = {}) {
    return userApi.post<AddToCartResponseDto>(
      `/cart/items/${productId}`,
      payload
    );
  },
  updateItem(productId: string, payload: UpdateCartItemPayload) {
    return userApi.patch<CartResponseDto>(`/cart/items/${productId}`, payload);
  },
  removeItem(productId: string, variantId?: string) {
    return userApi.delete<RemoveCartItemResponseDto>(`/cart/items/${productId}`, {
      params: variantId ? { variantId } : {},
    });
  },
  clear() {
    return userApi.delete<CartResponseDto>("/cart");
  },
  previewDiscount(code: string) {
    return userApi.get<DiscountPreviewDto>(`/cart/discount-preview?code=${encodeURIComponent(code)}`);
  },
};
