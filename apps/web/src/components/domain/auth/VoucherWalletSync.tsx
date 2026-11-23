"use client";

import { voucherService } from "@/api/services/vouchers";
import { useAuthStore } from "@/zustand/auth";
import { useDiscountStore } from "@/zustand/discount";
import { useEffect, useRef } from "react";

/**
 * Reconciles this browser's claimed vouchers with the customer's server-side
 * wallet, once per sign-in:
 *
 *  - vouchers saved on another device appear here;
 *  - vouchers claimed as a guest (or while offline) are pushed to the server,
 *    which validates them and reserves limited ones; any the server refuses are
 *    simply not kept.
 *
 * The server wallet is the source of truth for a signed-in customer.
 */
export function VoucherWalletSync() {
  const userId = useAuthStore((state) => state.user?.id);
  const isCustomer = useAuthStore(
    (state) => state.isAuthenticated && (state.capabilities?.canPurchase ?? false),
  );
  const reconciledFor = useRef("");

  useEffect(() => {
    if (!isCustomer || !userId || reconciledFor.current === userId) return;
    reconciledFor.current = userId;
    let cancelled = false;

    void (async () => {
      try {
        const server = (await voucherService.list()).data ?? [];
        // Oldest first, so the newest claims win when only two are kept.
        const serverCodes = [...server]
          .sort((a, b) => a.claimedAt.localeCompare(b.claimedAt))
          .map((v) => v.code);

        const localOnly = useDiscountStore
          .getState()
          .claimedCodes.filter((code) => !serverCodes.includes(code));

        const pushed: string[] = [];
        for (const code of localOnly) {
          try {
            await voucherService.claim(code);
            pushed.push(code);
          } catch {
            // Refused (expired, sold out, not eligible): do not keep it.
          }
        }
        if (cancelled) return;
        useDiscountStore.getState().setClaims([...serverCodes, ...pushed]);
      } catch {
        // Offline or session hiccup: keep the local claims; retry next load.
        reconciledFor.current = "";
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isCustomer, userId]);

  return null;
}
