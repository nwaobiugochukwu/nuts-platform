"use client";

import { cartService } from "@/api/cart";
import { getApiErrorMessage } from "@/lib/api-error";
import { useAuthStore } from "@/zustand/auth";
import { useDiscountStore } from "@/zustand/discount";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

interface CartLine {
  productId: string;
  quantity: number;
}

/** Wait for rapid +/- clicks to settle before asking the server. */
const REVALIDATE_DEBOUNCE_MS = 300;

function statusOf(error: unknown): number | undefined {
  return (error as { response?: { status?: number } })?.response?.status;
}

/**
 * A voucher failure is PERMANENT (drop the claim) when it can never become
 * valid for this shopper: unknown/inactive, expired, or a usage limit reached.
 * Everything else (minimum spend not met, no eligible items yet, not started)
 * depends on the cart or the clock, so the claim is kept.
 */
function isPermanentFailure(error: unknown, message: string): boolean {
  const status = statusOf(error);
  return (
    status === 404 ||
    status === 409 ||
    /expired|no longer active|invalid or inactive/i.test(message)
  );
}

/**
 * Keeps the claimed/applied voucher in step with the cart, in one place
 * (cart page, drawer and checkout all use it).
 *
 *  - Applies a claimed voucher once the cart has items.
 *  - Re-checks an applied voucher when the cart changes, so the shown discount
 *    never goes stale (remove the eligible item and it is withdrawn).
 *  - Runs at most once per (voucher, cart contents): a failure can never turn
 *    into a retry loop.
 *  - Keeps the claim when the cart simply does not qualify yet; drops it only
 *    when the voucher is permanently unusable.
 */
export function useClaimedVoucherSync({
  items,
  enabled = true,
}: {
  items: CartLine[];
  enabled?: boolean;
}) {
  const isCustomer = useAuthStore(
    (state) => state.isAuthenticated && (state.capabilities?.canPurchase ?? false),
  );
  const claimedCode = useDiscountStore((state) => state.claimedCode);
  const appliedCode = useDiscountStore((state) => state.appliedDiscount?.code);
  const setAppliedDiscount = useDiscountStore((state) => state.setAppliedDiscount);
  const clearApplied = useDiscountStore((state) => state.clearApplied);
  const clearDiscount = useDiscountStore((state) => state.clearDiscount);

  const [isSyncing, setIsSyncing] = useState(false);
  const lastEvaluated = useRef("");
  const lastNotice = useRef("");

  const signature = useMemo(
    () =>
      items
        .map((item) => `${item.productId}:${item.quantity}`)
        .sort()
        .join("|"),
    [items],
  );
  const code = appliedCode ?? claimedCode;
  const hasItems = items.length > 0;

  useEffect(() => {
    if (!enabled || !isCustomer || !code || !hasItems) return;

    const runKey = `${code}|${signature}`;
    let cancelled = false;

    const timer = setTimeout(async () => {
      // Marked only when the request really starts, so a React StrictMode
      // double-mount (which cancels the first timer) still evaluates once.
      if (lastEvaluated.current === runKey) return;
      lastEvaluated.current = runKey;

      setIsSyncing(true);
      try {
        const res = await cartService.previewDiscount(code);
        if (cancelled) return;
        const previous = useDiscountStore.getState().appliedDiscount;
        setAppliedDiscount({
          code: res.data.code,
          amount: res.data.discountAmount,
        });
        if (!previous || previous.code !== res.data.code) {
          toast.success(`Voucher "${res.data.code}" applied!`);
        }
        lastNotice.current = "";
      } catch (error) {
        if (cancelled) return;
        const status = statusOf(error);
        // Not a verdict on the voucher (offline, session expiry, server
        // error): change nothing and let the next cart change retry.
        if (!status || status === 401 || status === 403 || status >= 500) return;

        const message = getApiErrorMessage(error, "");
        const permanent = isPermanentFailure(error, message);
        const wasApplied = useDiscountStore.getState().appliedDiscount !== null;

        clearApplied();
        if (permanent) clearDiscount();

        // Tell the shopper once per distinct reason, and only when something
        // visibly changed or the claim was just rejected.
        const notice = `${code}|${message}`;
        if (message && lastNotice.current !== notice && (wasApplied || permanent)) {
          lastNotice.current = notice;
          if (permanent) toast.error(message);
          else toast.info(message);
        }
      } finally {
        if (!cancelled) setIsSyncing(false);
      }
    }, REVALIDATE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    enabled,
    isCustomer,
    code,
    hasItems,
    signature,
    setAppliedDiscount,
    clearApplied,
    clearDiscount,
  ]);

  return { isSyncing };
}
