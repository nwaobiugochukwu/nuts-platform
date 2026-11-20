"use client";

import { useMemo, useState } from "react";
import { Check, Clock, Copy, Info, Sparkles, Tag, Ticket } from "lucide-react";
import { useFirstTimeShopper, useProductDeal } from "@/hooks/use-product-deals";
import { useDiscountStore } from "@/zustand/discount";
import { formatPrice } from "@/lib/util";
import type { ProductVoucherSummaryDto } from "@/api/dto/discount";

interface ProductVoucherDockProps {
  productId: string;
  currentPrice: number;
}

function calculateSavings(voucher: ProductVoucherSummaryDto, price: number): number {
  if (voucher.type === "PERCENTAGE") {
    const rawSavings = (price * voucher.value) / 100;
    if (voucher.maxDiscountAmount && voucher.maxDiscountAmount > 0) {
      return Math.min(rawSavings, voucher.maxDiscountAmount);
    }
    return rawSavings;
  }
  // FIXED
  return Math.min(price, voucher.value);
}

export function ProductVoucherDock({ productId, currentPrice }: ProductVoucherDockProps) {
  const { data: dealData, isLoading } = useProductDeal(productId);
  const { hasPurchased } = useFirstTimeShopper();
  const { claimCode, claimedCode, appliedDiscount } = useDiscountStore();
  const [justClaimedCode, setJustClaimedCode] = useState<string | null>(null);

  const vouchers = useMemo(() => {
    if (!dealData?.allVouchers) return [];
    return dealData.allVouchers.filter((v) => {
      // Exclude first-order exclusive discounts for customers who have already purchased
      if (hasPurchased && v.isFirstOrderOnly) {
        return false;
      }
      return true;
    });
  }, [dealData, hasPurchased]);

  const bestVoucherCode = dealData?.bestDiscount?.code;

  if (isLoading || vouchers.length === 0) {
    return null;
  }

  const handleClaim = (voucher: ProductVoucherSummaryDto, e: React.MouseEvent) => {
    e.stopPropagation();
    claimCode(voucher.code);
    setJustClaimedCode(voucher.code);
    setTimeout(() => {
      setJustClaimedCode(null);
    }, 3000);
  };

  return (
    <div className="mt-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.03] p-4 dark:border-emerald-500/20 dark:bg-emerald-950/10">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-dashed border-emerald-500/20">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <Ticket className="h-4 w-4" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-foreground flex items-center gap-1.5">
              Available Deals & Vouchers
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.2 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                {vouchers.length} {vouchers.length === 1 ? "offer" : "offers"}
              </span>
            </h4>
          </div>
        </div>
        <span className="text-[11px] text-muted-foreground hidden sm:inline">
          Auto-applies at checkout
        </span>
      </div>

      {/* Voucher Tickets List */}
      <div className="mt-3 space-y-2.5">
        {vouchers.map((voucher) => {
          const isClaimed =
            claimedCode === voucher.code ||
            appliedDiscount?.code === voucher.code ||
            justClaimedCode === voucher.code;

          const isBest = voucher.code === bestVoucherCode;
          const liveSavings = calculateSavings(voucher, currentPrice);
          const effectivePrice = Math.max(0, currentPrice - liveSavings);
          const meetsMinSpend = currentPrice >= voucher.minOrderAmount;
          const spendDeficit = voucher.minOrderAmount - currentPrice;

          return (
            <div
              key={voucher.id}
              className={`relative overflow-hidden rounded-xl border p-3 transition-all ${
                isClaimed
                  ? "border-emerald-500 bg-emerald-50/60 dark:border-emerald-500 dark:bg-emerald-950/25 shadow-xs"
                  : isBest
                    ? "border-emerald-500/40 bg-card hover:border-emerald-500/60 shadow-2xs"
                    : "border-border/80 bg-card hover:border-border"
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                {/* Left voucher details */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {/* Badge for scope */}
                    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-neutral-200/80 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
                      {voucher.scope === "VENDOR" ? "Store Deal" : "Platform Promo"}
                    </span>

                    {/* Best Deal badge */}
                    {isBest && (
                      <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                        <Sparkles className="h-3 w-3" />
                        Best Value
                      </span>
                    )}

                    {/* Code pill */}
                    <span className="inline-flex items-center gap-1 font-mono text-xs font-bold text-foreground bg-secondary/80 px-2 py-0.5 rounded border border-border/60">
                      <Tag className="h-3 w-3 text-muted-foreground" />
                      {voucher.code}
                    </span>
                  </div>

                  {/* Description & Savings */}
                  <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                      {voucher.type === "PERCENTAGE"
                        ? `${voucher.value}% OFF`
                        : `Save ${formatPrice(voucher.value)}`}
                    </span>
                    {liveSavings > 0 && (
                      <span className="text-xs text-muted-foreground">
                        (Pay {formatPrice(effectivePrice)} on this item)
                      </span>
                    )}
                  </div>

                  {/* Conditions & limits */}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    {voucher.minOrderAmount > 0 ? (
                      meetsMinSpend ? (
                        <span>✓ Min. order {formatPrice(voucher.minOrderAmount)} met</span>
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400 font-medium">
                          Min. spend {formatPrice(voucher.minOrderAmount)} (Add {formatPrice(spendDeficit)} more)
                        </span>
                      )
                    ) : (
                      <span>No minimum spend</span>
                    )}

                    {voucher.maxDiscountAmount && voucher.maxDiscountAmount > 0 && (
                      <span>• Max savings {formatPrice(voucher.maxDiscountAmount)}</span>
                    )}
                  </div>
                </div>

                {/* Right: Claim Action Button */}
                <div className="shrink-0 flex items-center sm:self-center">
                  <button
                    type="button"
                    onClick={(e) => handleClaim(voucher, e)}
                    className={`flex w-full sm:w-auto items-center justify-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
                      isClaimed
                        ? "bg-emerald-600 text-white shadow-xs"
                        : "bg-foreground text-background hover:bg-foreground/90 active:scale-95"
                    }`}
                  >
                    {isClaimed ? (
                      <>
                        <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                        <span>Claimed</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>Claim Voucher</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
