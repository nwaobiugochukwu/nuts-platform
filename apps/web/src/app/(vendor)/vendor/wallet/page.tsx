"use client";

import { vendorWalletService } from "@/api/modules/vendor";
import type { PaginationMeta } from "@/api/core/types";
import { PageHeader } from "@/component/common/PageHeader";
import { Badge } from "@/component/ui/badge";
import { Button } from "@/component/ui/button";
import { formatPrice } from "@/lib/util";
import { useQuery } from "@tanstack/react-query";
import {
ArrowDownLeft,
ArrowUpRight,
Clock,
CreditCard,
ShieldCheck,
TrendingUp,
Wallet
} from "lucide-react";
import { useState } from "react";

export default function DashboardWalletPage() {
  const [page, setPage] = useState(1);

  const { data: wallet } = useQuery({
    queryKey: ["vendor", "wallet"],
    staleTime: 1000 * 60,
    gcTime: 1000 * 60 * 5,
    queryFn: async () => {
      const res = await vendorWalletService.get();
      return res.data;
    },
  });

  const { data: paginatedTx } = useQuery({
    queryKey: ["vendor", "wallet", "transactions", page],
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
    queryFn: async () => {
      return (await vendorWalletService.getTransactions({ page, limit: 15 })).data;
    },
  });

  const transactions = paginatedTx?.data ?? wallet?.transactions ?? [];
  const meta: PaginationMeta | undefined = paginatedTx?.meta;

  const availableBalance = Number(wallet?.balance ?? 0);
  const pendingBalance = Number(wallet?.pendingBalance ?? 0);
  const lifetime = Number(wallet?.lifetimeEarnings ?? (availableBalance + pendingBalance));

  return (
    <div className="space-y-8">
      <PageHeader
        title="Store Wallet & Payouts"
        description="Monitor real-time merchant balances, escrow settlements, and historical earnings."
      />

      {/* Luxury Fintech Balance Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        {/* Available Balance Card */}
        <div className="relative overflow-hidden rounded-3xl border border-neutral-800 bg-gradient-to-br from-[#121216] via-[#16161c] to-[#1c1c24] p-6 text-white shadow-xl">
          <div className="absolute right-0 top-0 -mr-6 -mt-6 h-32 w-32 rounded-full bg-indigo-500/10 blur-2xl pointer-events-none" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
              Available For Payout
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
              <Wallet className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-4 text-3xl font-bold tracking-tight text-white">
            {formatPrice(availableBalance)}
          </p>
          <div className="mt-4 flex items-center gap-1.5 text-xs text-emerald-400 font-semibold">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Eligible for automatic settlement</span>
          </div>
        </div>

        {/* Pending Escrow Card */}
        <div className="rounded-3xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#121214] p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
              Pending Clearances
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20">
              <Clock className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-4 text-3xl font-bold tracking-tight text-neutral-900 dark:text-white">
            {formatPrice(pendingBalance)}
          </p>
          <p className="mt-4 text-xs text-neutral-400">
            Funds clearing customer delivery & return window
          </p>
        </div>

        {/* Lifetime Volume Card */}
        <div className="rounded-3xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#121214] p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
              Lifetime Store Earnings
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-4 text-3xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            {formatPrice(lifetime)}
          </p>
          <p className="mt-4 text-xs text-neutral-400">
            Cumulative net revenue generated on NUTS
          </p>
        </div>
      </div>

      {/* Transaction Ledger Table */}
      <div className="rounded-3xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#121214] p-4 shadow-sm sm:p-6">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-indigo-500" />
              Wallet Transaction Ledger
            </h3>
            <p className="text-xs text-neutral-400 mt-0.5">
              Auditable record of credits, commission deductions, and settlements
            </p>
          </div>
          <Badge variant="outline" className="text-xs font-mono">
            Immutable Ledger
          </Badge>
        </div>

        <div className="space-y-3 md:hidden">
          {transactions.map((tx) => {
            const isCredit = tx.type === "CREDIT";
            return (
              <article key={tx.id} className="min-w-0 rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-neutral-900 dark:text-white">
                      {tx.reason?.replace(/_/g, " ") || "Sale Settlement"}
                    </p>
                    <p className="mt-1 font-mono text-xs text-neutral-500">{tx.id.slice(0, 8)}...</p>
                  </div>
                  <Badge
                    variant={isCredit ? "success" : "destructive"}
                    className="shrink-0 text-xs font-semibold"
                  >
                    {tx.type}
                  </Badge>
                </div>
                <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
                  <time className="text-xs text-neutral-500 dark:text-neutral-400">
                    {new Date(tx.createdAt).toLocaleString()}
                  </time>
                  <span className={`text-sm font-bold ${isCredit ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500"}`}>
                    {isCredit ? "+" : "-"}{formatPrice(tx.amount)}
                  </span>
                </div>
              </article>
            );
          })}
          {transactions.length === 0 && (
            <p className="py-10 text-center text-sm text-neutral-500">
              No transactions recorded in your wallet yet.
            </p>
          )}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-neutral-200 dark:border-neutral-800 text-xs uppercase font-semibold text-neutral-400">
                <th className="py-3 px-3">Transaction</th>
                <th className="py-3 px-3">Date & Time</th>
                <th className="py-3 px-3">Type</th>
                <th className="py-3 px-3">Reason / Reference</th>
                <th className="py-3 px-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/80">
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-neutral-400">
                    No transactions recorded in your wallet yet.
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => {
                  const isCredit = tx.type === "CREDIT";
                  return (
                    <tr
                      key={tx.id}
                      className="hover:bg-neutral-50 dark:hover:bg-neutral-900/50 transition-colors"
                    >
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`flex h-7 w-7 items-center justify-center rounded-lg ${
                              isCredit
                                ? "bg-emerald-500/10 text-emerald-500"
                                : "bg-rose-500/10 text-rose-500"
                            }`}
                          >
                            {isCredit ? (
                              <ArrowDownLeft className="h-3.5 w-3.5" />
                            ) : (
                              <ArrowUpRight className="h-3.5 w-3.5" />
                            )}
                          </div>
                          <span className="font-mono text-xs text-neutral-400">
                            {tx.id.slice(0, 8)}...
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-neutral-600 dark:text-neutral-400">
                        {new Date(tx.createdAt).toLocaleString()}
                      </td>
                      <td className="py-3 px-3">
                        <Badge
                          variant={isCredit ? "success" : "destructive"}
                          className="text-xs font-semibold"
                        >
                          {tx.type}
                        </Badge>
                      </td>
                      <td className="py-3 px-3 font-medium text-neutral-800 dark:text-neutral-200">
                        {tx.reason?.replace(/_/g, " ") || "Sale Settlement"}
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-sm">
                        <span className={isCredit ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500"}>
                          {isCredit ? "+" : "-"}
                          {formatPrice(tx.amount)}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination controls if meta exists */}
        {meta && meta.totalPages > 1 && (
          <div className="mt-4 flex flex-col gap-3 border-t border-neutral-200 pt-4 dark:border-neutral-800 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xs text-neutral-400">
              Page {meta.page} of {meta.totalPages} ({meta.total} records)
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="h-8 rounded-xl text-xs"
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= meta.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="h-8 rounded-xl text-xs"
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
