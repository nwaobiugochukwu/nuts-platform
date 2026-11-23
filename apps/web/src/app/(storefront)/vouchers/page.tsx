"use client";

import { voucherService, type VoucherClaimDto } from "@/api/services/vouchers";
import Link from "@/components/navigation/AppLink";
import { VoucherAppliesTo } from "@/components/domain/voucher/VoucherAppliesTo";
import { useClaimVoucher } from "@/hooks/use-claim-voucher";
import { queryKey } from "@/lib/query-key";
import { formatDate, formatPrice } from "@/lib/util";
import { useAuthStore } from "@/zustand/auth";
import { useDiscountStore } from "@/zustand/discount";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BackLink } from "@/components/navigation/BackLink";
import { Check, CheckCircle2, Clock, Copy, Store, Tag, Ticket, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

function describeValue(voucher: VoucherClaimDto) {
  return voucher.type === "PERCENTAGE"
    ? `${voucher.value}% off`
    : `${formatPrice(voucher.value)} off`;
}

/** A voucher the customer has used the maximum number of times: history only, no actions. */
function UsedVoucherCard({ voucher }: { voucher: VoucherClaimDto }) {
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-card/50 p-4 opacity-75 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg font-bold tracking-tight text-muted-foreground line-through decoration-1">
            {describeValue(voucher)}
          </p>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {voucher.description || "Saved voucher"}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
          <CheckCircle2 className="h-3 w-3" />
          Used
        </span>
      </div>
      <p className="font-mono text-sm font-bold text-muted-foreground">{voucher.code}</p>
      <p className="text-xs text-muted-foreground">
        {voucher.usedAt ? `Used on ${formatDate(voucher.usedAt)}. ` : ""}
        You have used this voucher the maximum number of times.
      </p>
    </article>
  );
}

function VoucherCard({
  voucher,
  inCart,
  onRemove,
  removing,
}: {
  voucher: VoucherClaimDto;
  inCart: boolean;
  onRemove: () => void;
  removing: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(voucher.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy the code.");
    }
  };

  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg font-bold tracking-tight text-foreground">{describeValue(voucher)}</p>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {voucher.description || "Saved voucher"}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold text-foreground">
          {voucher.scope === "VENDOR" ? <Store className="h-3 w-3" /> : <Ticket className="h-3 w-3" />}
          {voucher.scope === "VENDOR" ? "Store voucher" : "Platform voucher"}
        </span>
      </div>

      <button
        type="button"
        onClick={() => void copy()}
        className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-border bg-secondary/40 px-3 py-2 font-mono text-sm font-bold text-foreground transition-colors hover:bg-secondary"
        aria-label={`Copy code ${voucher.code}`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Tag className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{voucher.code}</span>
        </span>
        {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4 text-muted-foreground" />}
      </button>

      <VoucherAppliesTo targets={voucher.appliesTo} />

      <ul className="space-y-1 text-xs text-muted-foreground">
        {voucher.minOrderAmount > 0 && <li>Min. spend {formatPrice(voucher.minOrderAmount)}</li>}
        {voucher.maxDiscountAmount ? <li>Saves up to {formatPrice(voucher.maxDiscountAmount)}</li> : null}
        {voucher.firstOrderOnly && <li>First order only</li>}
        {voucher.stackable && <li>Can be combined with another voucher</li>}
        {voucher.startsAt && <li>Valid from {formatDate(voucher.startsAt)}</li>}
        <li className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          Held for you until {formatDate(voucher.expiresAt)}
        </li>
      </ul>

      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        {inCart ? (
          <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Ready to use at checkout</span>
        ) : (
          <span className="text-xs text-muted-foreground">Applied from your cart</span>
        )}
        <div className="flex items-center gap-2">
          <Link
            href="/cart"
            className="rounded-full bg-foreground px-3.5 py-2 text-xs font-semibold text-background transition-opacity hover:opacity-85"
          >
            Use in cart
          </Link>
          <button
            type="button"
            onClick={onRemove}
            disabled={removing}
            aria-label={`Remove voucher ${voucher.code}`}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </article>
  );
}

export default function VouchersPage() {
  const userId = useAuthStore((state) => state.user?.id);
  const qc = useQueryClient();
  const claimedCodes = useDiscountStore((state) => state.claimedCodes);
  const { release } = useClaimVoucher();
  const [removing, setRemoving] = useState<string | null>(null);
  const [tab, setTab] = useState<"available" | "used">("available");

  const vouchersQuery = useQuery({
    queryKey: [...queryKey.vouchers.mine, userId ?? null],
    queryFn: async () => (await voucherService.list()).data ?? [],
    enabled: Boolean(userId),
    staleTime: 30_000,
  });
  const all = vouchersQuery.data ?? [];
  const available = all.filter((voucher) => voucher.status !== "USED");
  const usedUp = all.filter((voucher) => voucher.status === "USED");
  const vouchers = tab === "used" ? usedUp : available;

  const handleRemove = async (code: string) => {
    setRemoving(code);
    try {
      await release(code);
      await qc.invalidateQueries({ queryKey: queryKey.vouchers.mine });
      toast.success(`Removed ${code}`);
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <BackLink fallbackHref="/" fallbackLabel="Back to home" />
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">My vouchers</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Vouchers you have claimed. You can use one store voucher and one platform voucher on the same order.
        </p>
      </div>

      <div role="tablist" aria-label="Voucher status" className="flex gap-1.5 border-b border-border pb-3">
        {(
          [
            ["available", "Available", available.length],
            ["used", "Used", usedUp.length],
          ] as const
        ).map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`flex h-9 items-center gap-1.5 rounded-full px-4 text-xs font-semibold transition-colors ${
              tab === value ? "bg-foreground text-background" : "bg-secondary text-secondary-foreground hover:bg-secondary/70"
            }`}
          >
            {label}
            <span className={`rounded-full px-1.5 text-[10px] font-bold ${tab === value ? "bg-background/20" : "bg-background"}`}>{count}</span>
          </button>
        ))}
      </div>

      {vouchersQuery.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((item) => <div key={item} className="h-52 animate-pulse rounded-2xl bg-secondary" />)}
        </div>
      ) : vouchersQuery.isError ? (
        <div className="rounded-2xl border border-border bg-card px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">We couldn’t load your vouchers.</p>
          <button type="button" onClick={() => void vouchersQuery.refetch()} className="mt-3 text-sm font-semibold text-foreground underline">Try again</button>
        </div>
      ) : vouchers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/60 px-6 py-14 text-center">
          <Ticket className="mx-auto h-9 w-9 text-muted-foreground" />
          <h2 className="mt-4 text-lg font-semibold text-foreground">
            {tab === "used" ? "No used vouchers" : "No vouchers yet"}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            {tab === "used"
              ? "Vouchers you have used up will be listed here."
              : "Claim a voucher from the promotion banner or a product page and it will be saved here."}
          </p>
          <Link href="/discover" className="mt-5 inline-flex rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background">Browse products</Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {vouchers.map((voucher) =>
            voucher.status === "USED" ? (
              <UsedVoucherCard key={voucher.code} voucher={voucher} />
            ) : (
              <VoucherCard
                key={voucher.code}
                voucher={voucher}
                inCart={claimedCodes.includes(voucher.code)}
                removing={removing === voucher.code}
                onRemove={() => void handleRemove(voucher.code)}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}
