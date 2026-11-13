import type {
VariantOption
} from "../core/types";

// ── Cart ─────────────────────────────────────────────────────────────────────

export interface CartMetadataDto {
  id: string;
  userId: string;
  subtotal: number;
  discountAmount?: number;
  deliveryCharge: number;
  serviceCharge: number;
  totalAmount: number;
  totalItemCount: number;
  abandonedCartAlerted: boolean;
  addedFrom?: Record<string, string> | null;
  createdAt: Date;
  updatedAt: Date;
  checkedOut: boolean;
}

export interface DiscountPreviewDto {
  code: string;
  subtotal: number;
  discountAmount: number;
  deliveryCharge: number;
  serviceCharge: number;
  totalAmount: number;
}

export interface ProductAvailabilityDto {
  canAddToCart: boolean;
  isAvailable: boolean;
  sku: string;
}

export interface CartItemVariantDto {
  id: string;
  options: VariantOption[];
  isActive: boolean;
  isDeleted: boolean;
}

export interface CartItemProductDto {
  id: string;
  name: string;
  slug: string;
  sku: string;
  price: number;
  inStockQuantity: number;
  hasVariants: boolean;
  description?: string;
  isActive: boolean;
  isVariant: boolean;
  lowStockAlert: boolean;
  lowStockQuantity: number;
  hasDiscount: boolean;
  discountDetails?: unknown;
  imageUrl?: string | null;
  images?: { url: string }[];
  category?: { id: string; name: string; slug: string };
  subcategory?: { id: string; name: string; slug: string };
  vendor?: { id: string; name: string };
  productAvailability: ProductAvailabilityDto;
}

export interface CartItemResponseDto {
  id: string;
  cartId: string;
  productId: string;
  product: CartItemProductDto;
  variant?: CartItemVariantDto | null;
  quantity: number;
  price: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CartResponseDto {
  cart: CartMetadataDto;
  cartItems: CartItemResponseDto[];
}

export interface AddToCartResponseDto {
  cart: CartMetadataDto;
  addedItem: CartItemResponseDto;
}

export interface RemoveCartItemResponseDto {
  cart: CartResponseDto;
}

export type AddedFromType = "CATEGORY_PAGE" | "PRODUCT_PAGE";