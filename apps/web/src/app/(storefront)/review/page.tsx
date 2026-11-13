"use client";

import { orderService } from "@/api";
import type { OrderResponseDto } from "@/api/dto/order";
import { PageHeader } from "@/component/common/PageHeader";
import { CustomerLayout } from "@/component/layout/CustomerLayout";
import { WriteReviewDialog } from "@/component/review/WriteReviewDialog";
import { Button } from "@/component/ui/button";
import { Card,CardContent,CardHeader,CardTitle } from "@/component/ui/card";
import { queryKey } from "@/lib/query-key";
import { formatPrice } from "@/lib/util";
import { useQuery } from "@tanstack/react-query";
import { ShoppingCart } from "lucide-react";

type EligibleOrder = {
  order: OrderResponseDto;
  items: OrderResponseDto["items"];
};

export default function ReviewPage() {
  const { data: orders, isLoading } = useQuery({
    queryKey: queryKey.order.list(),
    queryFn: async () => (await orderService.list()).data,
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 15,
  });

  const { data: delivered = [] } = useQuery({
    queryKey: [...queryKey.order.all, "review-delivered"],
    enabled: Boolean(orders?.length),
    queryFn: async () => {
      const summaries = orders ?? [];
      const deliveredOrders = summaries.filter((o) => o.status === "DELIVERED");
      const results: EligibleOrder[] = await Promise.all(
        deliveredOrders.map(async (summary) => {
          const { data: order } = await orderService.getById(summary.id);
          return { order, items: order.items };
        })
      );
      return results;
    },
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 15,
  });

  // Collect unique products eligible for review from delivered orders
  const seen = new Set<string>();
  const eligible = delivered
    .flatMap((entry) => entry.items)
    .filter((item) => {
      const key = item.productId;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return (
    <CustomerLayout>
      <div className="mx-auto max-w-7xl px-4 py-10">
        <PageHeader title="Write Reviews" description="Share feedback on purchases you've received" />

        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : eligible.length === 0 ? (
          <div className="py-16 text-center">
            <ShoppingCart className="mx-auto h-16 w-16 text-muted-foreground/30" />
            <h2 className="mt-4 text-xl font-semibold">No eligible products</h2>
            <p className="mt-2 text-muted-foreground">
              Reviews are available for delivered orders.
            </p>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {eligible.map((item) => (
              <Card key={item.productId}>
                <CardHeader>
                  <CardTitle>{item.productSnapshot?.name ?? item.productId}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Qty: {item.quantity} · Price: {formatPrice(item.unitPrice)}
                  </p>
                  <WriteReviewDialog
                    productId={item.productId}
                    productName={item.productSnapshot?.name ?? item.productId}
                  >
                    <Button variant="outline" size="sm">
                      Write a review
                    </Button>
                  </WriteReviewDialog>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </CustomerLayout>
  );
}

