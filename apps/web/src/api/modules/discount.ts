import { adminApi, vendorApi } from "@/api/core/client";
import type { DiscountCodeResponseDto } from "@/api/dto/discount";
import type { ProductQueryParams } from "./product";

export interface DiscountCodePayload {
  code: string;
  description?: string;
  type: "PERCENTAGE" | "FIXED";
  value: number;
  maxDiscountAmount?: number | null;
  minOrderAmount?: number;
  usageLimit?: number | null;
  perUserUsageLimit?: number | null;
  startsAt?: string | null;
  expiresAt?: string | null;
  platformwide?: boolean;
  applicableProductIds?: string[];
  applicableCategoryIds?: string[];
  firstOrderOnly?: boolean;
  scope?: string;
  vendorId?: string | null;
}

export const adminDiscountService = {
  list(params: ProductQueryParams) {
    return adminApi.get<DiscountCodeResponseDto[]>("/admin/discounts", { params });
  },
  create(payload: DiscountCodePayload) {
    return adminApi.post<DiscountCodeResponseDto>("/admin/discounts", payload);
  },
  update(id: string, payload: Partial<DiscountCodePayload>) {
    return adminApi.patch<DiscountCodeResponseDto>(`/admin/discounts/${id}`, payload);
  },
  deactivate(id: string) {
    return adminApi.patch<DiscountCodeResponseDto>(`/admin/discounts/${id}/deactivate`);
  },
  delete(id: string) {
    return adminApi.delete<void>(`/admin/discounts/${id}`);
  },
};

export const vendorDiscountService = {
  list(params?: ProductQueryParams) {
    return vendorApi.get<DiscountCodeResponseDto[]>("/vendor/discounts", { params });
  },
  create(payload: DiscountCodePayload) {
    return vendorApi.post<DiscountCodeResponseDto>("/vendor/discounts", payload);
  },
  update(id: string, payload: Partial<DiscountCodePayload>) {
    return vendorApi.patch<DiscountCodeResponseDto>(`/vendor/discounts/${id}`, payload);
  },
  deactivate(id: string) {
    return vendorApi.patch<DiscountCodeResponseDto>(`/vendor/discounts/${id}/deactivate`);
  },
  delete(id: string) {
    return vendorApi.delete<void>(`/vendor/discounts/${id}`);
  },
};

export const dashboardDiscountService = vendorDiscountService;
