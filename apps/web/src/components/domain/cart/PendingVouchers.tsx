"use client";

import { voucherService } from "@/api/services/vouchers";
import { VoucherAppliesTo } from "@/components/domain/voucher/VoucherAppliesTo";
import type { PendingVoucher } from "@/hooks/use-claimed-voucher";
import { queryKey } from "@/lib/query-key";
import { useAuthStore } from "@/zustand/auth";
import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";

/**
 * Vouchers the shopper has claimed that are not taking anything off this cart
 * yet (e.g. a voucher for one specific product that is not in the cart). They
 * are kept, and this says why and where to use them.
 */
export function PendingVouchers({ pending }: { pending: PendingVoucher[] }) {
  const userId = useAuthStore((state) => state.user?.id);
  const wallet = useQuery({
    queryKey: [...queryKey.vouchers.mine, userId ?? null],
    queryFn: async () => (await voucherService.list()).data ?? [],
    enabled: Boolean(userId) && pending.length > 0,
    staleTime: 30_000,
  });

  if (pending.length === 0) return null;

  return (
    <div className="mb-2 space-y-2" aria-live="polite">
      {pending.map((voucher) => {
        const targets = wallet.data?.find((v) => v.code === voucher.code)?.appliesTo;
        return (
          <div
            key={voucher.code}
            className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs"
          >
            <div className="flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="min-w-0 space-y-1">
                <p>
                  <span className="font-semibold uppercase text-foreground">{voucher.code}</span>
                  <span className="text-muted-foreground"> is saved but not applied yet.</span>
                </p>
                <p className="text-muted-foreground">{voucher.reason}</p>
                <VoucherAppliesTo targets={targets} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
