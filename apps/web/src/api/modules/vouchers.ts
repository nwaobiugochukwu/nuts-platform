import { userApi } from "@/api/core/client";

export interface VoucherClaimDto {
  code: string;
  description: string | null;
  type: "PERCENTAGE" | "FIXED";
  value: number;
  minOrderAmount: number;
  maxDiscountAmount: number | null;
  stackable: boolean;
  firstOrderOnly: boolean;
  scope: "VENDOR" | "PLATFORM";
  startsAt: string | null;
  /** When the held reservation ends. */
  expiresAt: string;
  claimedAt: string;
}

/** A customer's saved vouchers. Server-side, so they follow the account across devices. */
export const voucherService = {
  claim(code: string) {
    return userApi.post<VoucherClaimDto>("/discounts/claims", { code });
  },
  list() {
    return userApi.get<VoucherClaimDto[]>("/discounts/claims");
  },
  release(code: string) {
    return userApi.delete<null>(`/discounts/claims/${encodeURIComponent(code)}`);
  },
};
