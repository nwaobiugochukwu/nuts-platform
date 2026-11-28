import type { DiscountCode } from '@prisma/client';
import type { DiscountCodeResponseDto } from '../dto';

/**
 * Discount codes are case-insensitive.
 *
 * Storing one canonical representation prevents:
 *
 * SAVE10
 * save10
 * Save10
 *
 * from being treated as different codes.
 */
export function normalizeDiscountCode(code: string): string {
  return code.trim().toUpperCase();
}

// ============================================================
// VALIDATION HELPERS
// ============================================================

export function toDiscountResponseDto(
  code: DiscountCode,
): DiscountCodeResponseDto {
  return {
    id: code.id,
    code: code.code,
    description: code.description,
    type: code.type,
    value: Number(code.value),
    maxDiscountAmount:
      code.maxDiscountAmount !== null ? Number(code.maxDiscountAmount) : null,
    minOrderAmount: Number(code.minOrderAmount),
    usageLimit: code.usageLimit,
    perUserUsageLimit: code.perUserUsageLimit,
    usageCount: code.usageCount,
    isActive: code.isActive,
    platformwide: code.platformwide,
    firstOrderOnly: code.firstOrderOnly,
    stackable: code.stackable,
    autoApply: code.autoApply,
    minQuantity: code.minQuantity,
    startsAt: code.startsAt,
    expiresAt: code.expiresAt,
    scope: code.scope,
    applicableProductIds: code.applicableProductIds,
    applicableCategoryIds: code.applicableCategoryIds,
    vendorId: code.vendorId,
    createdAt: code.createdAt,
    updatedAt: code.updatedAt,
  };
}
