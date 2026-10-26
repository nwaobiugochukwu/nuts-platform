"use client";

import { orderService } from "@/api";
import type { PaginationMeta } from "@/api/core/types";
import type { OrderSummaryDto } from "@/api/dto/order";
import { PageHeader } from "@/component/common/PageHeader";
import { CustomerLayout } from "@/component/layout/CustomerLayout";
import { OrderStatusBadge } from "@/component/order/OrderItemSnapshot";
import { Button } from "@/component/ui/button";
import { Card,CardContent } from "@/component/ui/card";
import { queryKey } from "@/lib/query-key";
import { formatDate,formatPrice } from "@/lib/util";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight,Package } from "lucide-react";
import Link from "@/components/navigation/AppLink";
import { useState } from "react";

export default function OrderPage() {
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: queryKey.order.list({ page, limit: 10 }),
    queryFn: async () => await orderService.list({ page, limit: 10 }),
    refetchInterval: (query) => {
      const orderList = query.state.data?.data;
      return orderList?.some((o) => o.status === "PENDING") ? 4000 : false;
    },
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
  });

  const orders: OrderSummaryDto[] = data?.data ?? [];
  const meta: PaginationMeta | undefined = data?.meta && "page" in data.meta ? data.meta : undefined;

  return (
    <CustomerLayout>
      <div className="mx-auto max-w-7xl px-4 py-10">
        <PageHeader title="My Orders" description="Track your order history" />

        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <p className="text-muted-foreground">You haven&apos;t placed any orders yet.</p>
        ) : (
          <>
            <div className="mt-6 space-y-4">
              {orders.map((order) => (
                <Link key={order.id} href={`/order/${order.id}`} className="group block focus:outline-hidden">
                  <Card className="rounded-2xl border border-border bg-card transition-all duration-200 hover:border-primary/40 hover:shadow-md cursor-pointer">
                    <CardContent className="p-5 sm:p-6">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        {/* Left: Icon & Order Info */}
                        <div className="flex items-start sm:items-center gap-3.5">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground group-hover:bg-primary group-hover:text-primary-foreground transition-colors duration-200 shadow-2xs">
                            <Package className="h-5 w-5" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-mono text-base font-bold text-foreground">
                                #{order.orderNumber}
                              </p>
                              <div className="sm:hidden">
                                <OrderStatusBadge status={order.status} />
                              </div>
                            </div>
                            <p className="text-sm text-muted-foreground mt-0.5">
                              Placed on {formatDate(order.createdAt)}
                            </p>
                          </div>
                        </div>

                        {/* Right: Status, Price & "View Order" Affordance */}
                        <div className="flex items-center justify-between sm:justify-end gap-5 border-t border-border/50 pt-3 sm:border-0 sm:pt-0">
                          <div className="text-left sm:text-right">
                            <div className="hidden sm:block">
                              <OrderStatusBadge status={order.status} />
                            </div>
                            <p className="mt-1 text-base font-bold text-foreground">
                              {formatPrice(order.finalAmount || order.totalAmount)}
                            </p>
                          </div>

                          <div className="flex items-center gap-1.5 rounded-full bg-secondary/80 px-3.5 py-1.5 text-xs font-semibold text-foreground group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-200 shadow-2xs">
                            <span>View Order</span>
                            <ChevronRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
            {meta && meta.totalPages > 1 && (
              <div className="mt-8 flex justify-center gap-2">
                <Button variant="outline" disabled={!meta.hasPreviousPage} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <span className="flex items-center px-4">
                  Page {meta.page} of {meta.totalPages}
                </span>
                <Button variant="outline" disabled={!meta.hasNextPage} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </CustomerLayout>
  );
}
