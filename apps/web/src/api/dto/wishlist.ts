// ── Wishlist ─────────────────────────────────────────────────────────────────

export interface WishlistResponseDto {
  id: string;
  productId: string;
  variantId?: string | null;
  productName: string;
  productSlug: string;
  productPrice: number;
  productImage?: string | null;
  variantName?: string | null;
  createdAt: Date;
}