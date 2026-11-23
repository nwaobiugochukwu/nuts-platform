import type { DiscountCodeScope, DiscountCodeType } from "../core/types";

// ── Discount codes ───────────────────────────────────────────────────────────

export interface DiscountCodeResponseDto {
  id: string;
  code: string;
  description?: string | null;
  type: DiscountCodeType;
  value: number;
  maxDiscountAmount?: number | null;
  minOrderAmount: number;
  usageLimit?: number | null;
  perUserUsageLimit?: number | null;
  usageCount: number;
  isActive: boolean;
  platformwide: boolean;
  firstOrderOnly?: boolean;
  stackable?: boolean;
  startsAt?: Date | null;
  expiresAt?: Date | null;
  scope: DiscountCodeScope;
  applicableProductIds: string[];
  applicableCategoryIds: string[];
  vendorId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── Public Storefront Discount & Voucher DTOs ───────────────────────────────

export interface PublicPlatformPromoDto {
  id: string;
  code: string;
  description?: string | null;
  type: DiscountCodeType;
  value: number;
  maxDiscountAmount?: number | null;
  minOrderAmount: number;
  startsAt?: string | Date | null;
  expiresAt?: string | Date | null;
  isFirstOrderOnly?: boolean;
}

export interface ProductVoucherSummaryDto {
  id: string;
  code: string;
  description?: string | null;
  type: DiscountCodeType;
  value: number;
  scope: DiscountCodeScope;
  minOrderAmount: number;
  maxDiscountAmount?: number | null;
  estimatedSavings: number;
  dealPrice?: number;
  isApplicable?: boolean;
  minOrderShortfall?: number;
  expiresAt?: string | Date | null;
  isFirstOrderOnly?: boolean;
}

export interface PublicProductDealDto {
  productId: string;
  bestDiscount?: (ProductVoucherSummaryDto & { dealPrice: number }) | null;
  unlockableDiscount?: (ProductVoucherSummaryDto & {
    minOrderAmount: number;
    minOrderShortfall: number;
  }) | null;
  allVouchers: ProductVoucherSummaryDto[];
}

export interface BatchProductDiscountsDto {
  productIds: string[];
}
