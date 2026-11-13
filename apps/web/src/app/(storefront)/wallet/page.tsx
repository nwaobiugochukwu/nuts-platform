"use client";

import { walletService } from "@/api";
import { PageHeader } from "@/component/common/PageHeader";
import { CustomerLayout } from "@/component/layout/CustomerLayout";
import { Button } from "@/component/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/component/ui/card";
import { formatDate,formatPrice } from "@/lib/util";
import { useQuery } from "@tanstack/react-query";
import {
ArrowDownLeft,
ArrowUpRight,
ChevronLeft,
ChevronRight,
Receipt,
ShieldCheck,
Wallet
} from "lucide-react";
import { useState } from "react";

export default function WalletPage() {
  const [page, setPage] = useState(1);
  const [filterType, setFilterType] = useState<"ALL" | "CREDIT" | "DEBIT">("ALL");

  // 1. Fetch wallet overview (balance)
  const { data: walletData, isLoading: walletLoading } = useQuery({
    queryKey: ["wallet"],
    queryFn: async () => (await walletService.getUserWallet()).data,
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 15,
  });

  // 2. Fetch paginated transactions
  const { data: txData, isLoading: txLoading } = useQuery({
    queryKey: ["wallet", "transactions", page],
    queryFn: async () => (await walletService.getUserTransactions({ page, limit: 15 })).data,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
  });

  const transactions = txData?.data ?? [];
  const meta = txData?.meta;

  const filteredTransactions = transactions.filter((tx) => {
    if (filterType === "ALL") return true;
    return tx.type === filterType;
  });

  const balance = walletData?.balance ?? 0;

  // Compute total credits and debits from visible or overview
  const totalCredits = transactions
    .filter((tx) => tx.type === "CREDIT")
    .reduce((acc, tx) => acc + Number(tx.amount), 0);

  const totalDebits = transactions
    .filter((tx) => tx.type === "DEBIT")
    .reduce((acc, tx) => acc + Number(tx.amount), 0);

  return (
    <CustomerLayout>
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 space-y-10">
        <PageHeader
          title="NUTS Wallet"
          description="Manage your store credits, refunds, and real-time transaction ledger"
        />

        {/* Hero Balance & Card Banner */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-800 p-8 sm:p-10 text-white shadow-2xl">
          <div className="relative z-10 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold backdrop-blur-xs">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                  Verified NUTS Account
                </span>
                <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
                  Active
                </span>
              </div>
              <p className="text-xs font-medium uppercase tracking-wider text-neutral-400">
                Available Wallet Balance
              </p>
              <h2 className="text-4xl sm:text-5xl font-bold tracking-tight font-sans">
                {walletLoading ? "..." : formatPrice(balance)}
              </h2>
              <p className="text-xs text-neutral-400">
                Usable seamlessly across checkout for instant 1-click orders and partial offsets.
              </p>
            </div>

            <div className="flex flex-col sm:items-end gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-white backdrop-blur-md border border-white/10">
                <Wallet className="h-7 w-7" />
              </div>
              <div className="text-left sm:text-right">
                <p className="text-xs font-semibold text-neutral-400">Wallet Currency</p>
                <p className="text-sm font-semibold text-white tracking-wider">NGN (Nigerian Naira)</p>
              </div>
            </div>
          </div>

          <div className="absolute -left-20 -bottom-20 h-64 w-64 rounded-full bg-white/5 blur-3xl" />
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <Card className="rounded-2xl border-neutral-200/80 dark:border-neutral-800">
            <CardContent className="p-6 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Recent Inflow (Credits)
                </p>
                <p className="mt-2 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                  +{formatPrice(totalCredits)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Refunds & adjustments</p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <ArrowDownLeft className="h-6 w-6" />
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-neutral-200/80 dark:border-neutral-800">
            <CardContent className="p-6 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Recent Outflow (Debits)
                </p>
                <p className="mt-2 text-2xl font-bold text-rose-600 dark:text-rose-400">
                  -{formatPrice(totalDebits)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Purchases & charges</p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400">
                <ArrowUpRight className="h-6 w-6" />
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-neutral-200/80 dark:border-neutral-800">
            <CardContent className="p-6 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Recorded Transactions
                </p>
                <p className="mt-2 text-2xl font-bold text-foreground">
                  {meta?.total ?? transactions.length}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Ledger entries on file</p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-100 dark:bg-neutral-800 text-foreground">
                <Receipt className="h-6 w-6 stroke-[1.5]" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Transactions Ledger */}
        <Card className="rounded-2xl border-neutral-200/80 dark:border-neutral-800">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-neutral-100 dark:border-neutral-800 pb-4">
            <div>
              <CardTitle className="text-lg font-bold">Transaction History</CardTitle>
              <CardDescription className="text-xs">
                Audited real-time ledger of all credit deposits and debit purchases
              </CardDescription>
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1.5 rounded-xl bg-neutral-100 dark:bg-neutral-900 p-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setFilterType("ALL")}
                className={`rounded-lg px-3 py-1.5 transition-all ${
                  filterType === "ALL"
                    ? "bg-white text-neutral-950 dark:bg-neutral-800 dark:text-white shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setFilterType("CREDIT")}
                className={`rounded-lg px-3 py-1.5 transition-all ${
                  filterType === "CREDIT"
                    ? "bg-white text-emerald-600 dark:bg-neutral-800 dark:text-emerald-400 shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Credits (+)
              </button>
              <button
                type="button"
                onClick={() => setFilterType("DEBIT")}
                className={`rounded-lg px-3 py-1.5 transition-all ${
                  filterType === "DEBIT"
                    ? "bg-white text-rose-600 dark:bg-neutral-800 dark:text-rose-400 shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Debits (-)
              </button>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {txLoading ? (
              <div className="p-8 space-y-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-12 w-full animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800"
                  />
                ))}
              </div>
            ) : filteredTransactions.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <Receipt className="mx-auto h-12 w-12 text-neutral-300 dark:text-neutral-700 stroke-[1]" />
                <p className="mt-4 text-sm font-semibold text-foreground">No transactions recorded</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Your wallet activity will show up here as transactions occur.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-neutral-100 dark:border-neutral-800 text-left text-neutral-400 font-semibold uppercase tracking-wider">
                      <th className="py-3.5 px-6">Transaction</th>
                      <th className="py-3.5 px-4">Reason / Details</th>
                      <th className="py-3.5 px-4">Reference</th>
                      <th className="py-3.5 px-4">Date</th>
                      <th className="py-3.5 px-6 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/80">
                    {filteredTransactions.map((tx) => {
                      const isCredit = tx.type === "CREDIT";
                      return (
                        <tr
                          key={tx.id}
                          className="hover:bg-neutral-50/50 dark:hover:bg-neutral-900/30 transition-colors"
                        >
                          <td className="py-4 px-6">
                            <div className="flex items-center gap-3">
                              <div
                                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                                  isCredit
                                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                    : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                                }`}
                              >
                                {isCredit ? (
                                  <ArrowDownLeft className="h-4 w-4" />
                                ) : (
                                  <ArrowUpRight className="h-4 w-4" />
                                )}
                              </div>
                              <div>
                                <p className="text-sm font-semibold text-foreground">
                                  {isCredit ? "Wallet Credit" : "Wallet Debit"}
                                </p>
                                <span
                                  className={`inline-block rounded-md px-1.5 py-0.5 text-xs font-semibold ${
                                    isCredit
                                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                                      : "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
                                  }`}
                                >
                                  {tx.type}
                                </span>
                              </div>
                            </div>
                          </td>

                          <td className="py-4 px-4 text-sm font-medium text-foreground">
                            {tx.reason || "General Transaction"}
                          </td>

                          <td className="py-4 px-4 text-muted-foreground font-mono text-xs">
                            {tx.referenceId ? (
                              <span className="truncate max-w-[120px] inline-block">
                                #{tx.referenceId.slice(0, 8)}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>

                          <td className="py-4 px-4 text-sm text-muted-foreground whitespace-nowrap">
                            {formatDate(new Date(tx.createdAt).toISOString())}
                          </td>

                          <td className="py-4 px-6 text-right font-bold text-sm whitespace-nowrap">
                            <span
                              className={
                                isCredit
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-neutral-900 dark:text-white"
                              }
                            >
                              {isCredit ? "+" : "-"}
                              {formatPrice(Math.abs(tx.amount))}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination Controls */}
            {meta && meta.totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-neutral-100 dark:border-neutral-800 px-6 py-4">
                <p className="text-xs text-muted-foreground">
                  Showing page <span className="font-semibold text-foreground">{meta.page}</span> of{" "}
                  <span className="font-semibold text-foreground">{meta.totalPages}</span>
                </p>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={meta.page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="rounded-xl text-xs h-8 px-3"
                  >
                    <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                    <span>Previous</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={meta.page >= meta.totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    className="rounded-xl text-xs h-8 px-3"
                  >
                    <span>Next</span>
                    <ChevronRight className="h-3.5 w-3.5 ml-1" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </CustomerLayout>
  );
}