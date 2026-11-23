"use client";

import { cartService } from "@/api/services/cart";
import { voucherService } from "@/api/services/vouchers";
import { getApiErrorMessage } from "@/lib/api-error";
import { useAuthStore } from "@/zustand/auth";
import { useDiscountStore } from "@/zustand/discount";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

interface CartLine {
  productId: string;
  quantity: number;
}

/** A claimed voucher that is held but not (yet) taking anything off the cart. */
export interface PendingVoucher {
  code: string;
  reason: string;
}

/** Wait for rapid +/- clicks to settle before asking the server. */
const REVALIDATE_DEBOUNCE_MS = 300;

function statusOf(error: unknown): number | undefined {
  return (error as { response?: { status?: number } })?.response?.status;
}

/**
 * A voucher failure is PERMANENT (drop the claim) when it can never become
 * valid for this shopper: unknown/inactive, expired, or a usage limit reached.
 * Everything else (minimum spend not met, no eligible items yet, not started,
 * can't combine with the other voucher) depends on the cart or the clock, so
 * the claim is kept.
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
 * Keeps the claimed vouchers in step with the cart, in one place (cart page,
 * drawer and checkout all use it).
 *
 *  - Applies the claimed vouchers (up to two combinable ones) once the cart has
 *    items, and shows what EACH one takes off.
 *  - Re-checks them when the cart changes, so the shown discount never goes
 *    stale (remove the eligible item and its voucher is withdrawn).
 *  - Runs at most once per (vouchers, cart contents): a failure can never turn
 *    into a retry loop.
 *  - Keeps a claim when the cart merely does not qualify yet or the vouchers
 *    can't combine; drops it only when it is permanently unusable.
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
  const claimedCodes = useDiscountStore((state) => state.claimedCodes);
  const setAppliedDiscounts = useDiscountStore((state) => state.setAppliedDiscounts);
  const removeClaim = useDiscountStore((state) => state.removeClaim);

  const [isSyncing, setIsSyncing] = useState(false);
  const [pending, setPending] = useState<PendingVoucher[]>([]);
  const lastEvaluated = useRef("");
  const notified = useRef(new Set<string>());

  const signature = useMemo(
    () =>
      items
        .map((item) => `${item.productId}:${item.quantity}`)
        .sort()
        .join("|"),
    [items],
  );
  const codesKey = claimedCodes.join("+");
  const hasItems = items.length > 0;

  useEffect(() => {
    // No claimed codes is fine: automatic offers still apply to a qualifying cart.
    if (!enabled || !isCustomer || !hasItems) return;

    const codes = codesKey ? codesKey.split("+") : [];
    const runKey = `${codesKey}|${signature}`;
    let cancelled = false;

    const dropClaim = (code: string) => {
      removeClaim(code);
      // Hand a reserved unit back; best effort (it expires on its own anyway).
      void voucherService.release(code).catch(() => undefined);
    };

    const tell = (key: string, show: () => void) => {
      if (notified.current.has(key)) return;
      notified.current.add(key);
      show();
    };

    const timer = setTimeout(async () => {
      // Marked only when the request really starts, so a React StrictMode
      // double-mount (which cancels the first timer) still evaluates once.
      if (lastEvaluated.current === runKey) return;
      lastEvaluated.current = runKey;

      setIsSyncing(true);
      try {
        const res = await cartService.previewDiscount(codes, { automatic: true });
        if (cancelled) return;
        const result = res.data;

        const previouslyApplied = new Set(
          useDiscountStore.getState().appliedDiscounts.map((d) => d.code),
        );
        setAppliedDiscounts(
          result.discounts.map((d) => ({
            code: d.code,
            amount: d.amount,
            scope: d.scope,
            automatic: d.automatic,
            label: d.label,
          })),
        );
        for (const d of result.discounts) {
          if (!previouslyApplied.has(d.code)) {
            toast.success(
              d.automatic ? `${d.label ?? "Offer"} applied automatically` : `Voucher "${d.code}" applied!`,
            );
          }
        }

        setPending(
          (result.rejected ?? [])
            .filter((r) => !r.permanent)
            .map((r) => ({ code: r.code, reason: r.reason })),
        );
        for (const r of result.rejected ?? []) {
          if (r.permanent) {
            dropClaim(r.code);
            tell(`${r.code}|${r.reason}`, () => toast.error(r.reason));
          } else if (previouslyApplied.has(r.code)) {
            // It was working a moment ago: say why it was withdrawn.
            tell(`${r.code}|${r.reason}`, () => toast.info(r.reason));
          }
        }
      } catch (error) {
        if (cancelled) return;
        const status = statusOf(error);
        // Not a verdict on the vouchers (offline, session expiry, server
        // error): change nothing and let the next cart change retry.
        if (!status || status === 401 || status === 403 || status >= 500) return;

        // A single claimed code is evaluated strictly: the server throws its
        // reason, which applies to that one code.
        const message = getApiErrorMessage(error, "");
        const wasApplied = useDiscountStore.getState().appliedDiscounts.length > 0;
        setAppliedDiscounts([]);

        const code = codes[0];
        if (!code) return;
        if (isPermanentFailure(error, message)) {
          dropClaim(code);
          if (message) tell(`${code}|${message}`, () => toast.error(message));
        } else {
          // Kept, but not applicable to this cart: show it, with the reason.
          if (message) setPending([{ code, reason: message }]);
          if (wasApplied && message) {
            tell(`${code}|${message}`, () => toast.info(message));
          }
        }
      } finally {
        if (!cancelled) setIsSyncing(false);
      }
    }, REVALIDATE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, isCustomer, codesKey, hasItems, signature, setAppliedDiscounts, removeClaim]);

  // Nothing claimed or nothing in the cart means nothing can be pending.
  const visiblePending = codesKey && hasItems ? pending.filter((p) => claimedCodes.includes(p.code)) : [];

  return { isSyncing, pending: visiblePending };
}
