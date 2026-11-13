import { publicApi, userApi } from "@/api/core/client";

export interface ReferralValidateResult {
  valid: boolean;
  message: string;
}

export interface ReferralStatsDto {
  code: string | null;
  totalReferred: number;
  rewardedCount: number;
  pendingCount: number;
}

export const referralService = {
  /**
   * Validate a referral code before registration.
   * Used for live feedback in the registration form.
   * Supply email only when available so the server can
   * reject self-referral early (optional at pre-check stage).
   */
  validate(code: string, email?: string): Promise<{ data: ReferralValidateResult }> {
    const cleanCode = code.trim().toUpperCase();
    return publicApi.get<ReferralValidateResult>("/account/referral/validate", {
      params: {
        code: cleanCode,
        ...(email ? { email } : {}),
      },
    });
  },

  /**
   * Get the authenticated user's referral programme stats.
   * Returns their own code, total referrals made, rewarded count, pending count.
   */
  getStats(): Promise<{ data: ReferralStatsDto }> {
    return userApi.get<ReferralStatsDto>("/account/referral/stats");
  },
};
