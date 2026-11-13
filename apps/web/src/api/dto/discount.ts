import type { DiscountCodeScope,DiscountCodeType } from "../core/types";

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
  startsAt?: Date | null;
  expiresAt?: Date | null;
  scope: DiscountCodeScope;
  applicableProductIds: string[];
  vendorId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}