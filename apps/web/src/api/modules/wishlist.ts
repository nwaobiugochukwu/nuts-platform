import { userApi } from "@/api/core/client";
import type { WishlistResponseDto } from "@/api/dto/wishlist";

export const wishlistService = {
  list() {
    return userApi.get<WishlistResponseDto[]>("/wishlist");
  },
  add(productId: string, variantId?: string) {
    return userApi.post<WishlistResponseDto>(
      `/wishlist/items/${productId}`,
      variantId ? { variantId } : {}
    );
  },
  remove(productId: string, variantId?: string) {
    return userApi.delete<void>(`/wishlist/items/${productId}`, {
      params: variantId ? { variantId } : {},
    });
  },
};