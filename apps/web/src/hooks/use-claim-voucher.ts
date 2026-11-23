"use client";

import { voucherService } from "@/api/vouchers";
import { getApiErrorMessage } from "@/lib/api-error";
import { useAuthStore } from "@/zustand/auth";
import { useDiscountStore } from "@/zustand/discount";
import { useCallback } from "react";
import { toast } from "sonner";

/**
 * Claim / release a voucher.
 *
 * Signed-in customers claim on the SERVER, which validates the code and, for
 * limited-quantity vouchers, reserves one use for 24 hours (so "claimed" really
 * means "yours"). If the server refuses (sold out, expired, not eligible), the
 * shopper sees why and nothing is claimed locally.
 *
 * Guests can only hold the claim locally; it is adopted by their account and
 * pushed to the server when they sign in (see VoucherWalletSync).
 */
export function useClaimVoucher() {
  const isCustomer = useAuthStore(
    (state) => state.isAuthenticated && (state.capabilities?.canPurchase ?? false),
  );
  const claimLocal = useDiscountStore((state) => state.claimCode);
  const removeLocal = useDiscountStore((state) => state.removeClaim);

  const claim = useCallback(
    async (
      code: string,
      options?: { silent?: boolean; copy?: boolean },
    ): Promise<boolean> => {
      if (isCustomer) {
        try {
          await voucherService.claim(code);
        } catch (error) {
          toast.error(getApiErrorMessage(error, "This voucher could not be claimed."));
          return false;
        }
      }
      claimLocal(code, options);
      return true;
    },
    [isCustomer, claimLocal],
  );

  const release = useCallback(
    async (code: string): Promise<void> => {
      removeLocal(code);
      if (isCustomer) {
        // Best effort: an unreleased reservation simply expires on its own.
        await voucherService.release(code).catch(() => undefined);
      }
    },
    [isCustomer, removeLocal],
  );

  return { claim, release, isCustomer };
}
