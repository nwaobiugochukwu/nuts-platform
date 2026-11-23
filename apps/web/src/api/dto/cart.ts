import type { DiscountTargetsDto } from "@/api/dto/discount";
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

export interface AppliedVoucherDto {
  code: string;
  /** What THIS voucher takes off. */
  amount: number;
  scope: "VENDOR" | "PLATFORM";
  stackable: boolean;
  /** Applied automatically (no code). */
  automatic?: boolean;
  /** Offer name for automatic discounts. */
  label?: string;
}

export interface RejectedVoucherDto {
  code: string;
  reason: string;
  /** true = can never work for this shopper (expired, exhausted...); drop the claim. */
  permanent: boolean;
  appliesTo?: DiscountTargetsDto | null;
}

export interface DiscountPreviewDto {
  /** First applied code (single-voucher compatibility). */
  code: string;
  subtotal: number;
  /** Total taken off by every applied voucher. */
  discountAmount: number;
  deliveryCharge: number;
  serviceCharge: number;
  totalAmount: number;
  discounts: AppliedVoucherDto[];
  rejected: RejectedVoucherDto[];
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