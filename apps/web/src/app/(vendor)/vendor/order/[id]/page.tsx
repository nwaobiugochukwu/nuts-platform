"use client";

import { dashboardOrderService } from "@/api";
import { getApiErrorMessage } from "@/api/core/error";
import type { OrderStatus } from "@/api/core/types";
import { ConfirmDialog } from "@/component/modal/ConfirmDialog";
import { OrderStatusBadge } from "@/component/order/OrderItemSnapshot";
import { Button } from "@/component/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/component/ui/card";
import { RemoteImage } from "@/component/ui/RemoteImage";
import { queryKey } from "@/lib/query-key";
import { formatDate, formatPrice } from "@/lib/util";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Calendar,
  Check,
  Copy,
  Mail,
  MapPin,
  Package,
  ShoppingBag,
  Truck,
  User,
} from "lucide-react";
import Link from "@/components/navigation/AppLink";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

const getVendorNextStatus = (status: OrderStatus): OrderStatus | null => {
  if (status === "PROCESSING") return "SHIPPED";
  if (status === "SHIPPED") return "DELIVERED";
  return null;
};

export default function VendorOrderDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [advanceTarget, setAdvanceTarget] = useState<OrderStatus | null>(null);

  const { data: order, isLoading, isError } = useQuery({
    queryKey: [...queryKey.vendor.order, "detail", id],
    queryFn: async () => {
      const res = await dashboardOrderService.getById(id);
      return res.data;
    },
    enabled: Boolean(id),
    staleTime: 1000 * 60 * 3,
  });

  const updateStatusMutation = useMutation({
    mutationFn: (status: OrderStatus) =>
      dashboardOrderService.updateStatus(id, { status }),
    onSuccess: (_, newStatus) => {
      toast.success(
        `Order #${order?.orderNumber || ""} marked as ${newStatus}`,
      );
      qc.invalidateQueries({ queryKey: queryKey.vendor.order });
      setAdvanceTarget(null);
    },
    onError: (e: unknown) =>
      toast.error(
        getApiErrorMessage(e, "Unable to update order fulfillment status"),
      ),
  });

  const handleCopyId = () => {
    if (!order) return;
    navigator.clipboard.writeText(order.orderNumber || order.id);
    setCopied(true);
    toast.success("Order reference copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 space-y-6">
        <div className="h-6 w-32 animate-pulse rounded bg-muted" />
        <div className="h-28 animate-pulse rounded-3xl bg-muted" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 h-64 animate-pulse rounded-3xl bg-muted" />
          <div className="h-64 animate-pulse rounded-3xl bg-muted" />
        </div>
      </div>
    );
  }

  if (isError || !order) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-destructive/10 text-destructive mb-4">
          <ShoppingBag className="h-8 w-8" />
        </div>
        <h1 className="text-xl font-bold text-foreground">Order Not Found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The requested vendor order could not be loaded. It may not belong to your store or may have been archived.
        </p>
        <Button asChild className="mt-6">
          <Link href="/vendor/order">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Orders
          </Link>
        </Button>
      </div>
    );
  }

  const nextStatus = getVendorNextStatus(order.status);
  const parsedAddress =
    typeof order.shippingAddress === "string"
      ? (() => {
          try {
            return JSON.parse(order.shippingAddress);
          } catch {
            return order.shippingAddress;
          }
        })()
      : order.shippingAddress;

  const addressString =
    typeof parsedAddress === "object" && parsedAddress !== null
      ? [
          parsedAddress.address,
          parsedAddress.city,
          parsedAddress.state,
          parsedAddress.country,
        ]
          .filter(Boolean)
          .join(", ")
      : String(order.shippingAddress || "Standard delivery address on file");

  const customerName = order.customer
    ? `${order.customer.firstName ?? ""} ${order.customer.lastName ?? ""}`.trim() ||
      order.customer.email
    : "Customer";

  return (
    <div className="mx-auto max-w-5xl px-3 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
      {/* Back button */}
      <div>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground"
        >
          <Link href="/vendor/order">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Orders
          </Link>
        </Button>
      </div>

      {/* Header Banner */}
      <div className="rounded-3xl border border-border bg-card p-6 shadow-xs sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-mono text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                #{order.orderNumber}
              </h1>
              <OrderStatusBadge status={order.status} />
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" />
                {formatDate(order.createdAt)}
              </span>
              <button
                type="button"
                onClick={handleCopyId}
                className="flex items-center gap-1 font-mono hover:text-foreground transition-colors"
                title="Copy reference"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {order.id}
              </button>
            </div>
          </div>

          {/* Action button if actionable */}
          {nextStatus && (
            <Button
              onClick={() => setAdvanceTarget(nextStatus)}
              className="gap-2 self-start sm:self-auto font-semibold"
            >
              <Truck className="h-4 w-4" />
              Mark as {nextStatus}
            </Button>
          )}
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left: Items Breakdown */}
        <div className="md:col-span-2 space-y-6">
          <Card className="rounded-3xl border-border">
            <CardHeader className="pb-3 border-b border-border/60">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Package className="h-4 w-4 text-primary" />
                Order Items ({order.items?.length ?? 0})
              </CardTitle>
            </CardHeader>
            <CardContent className="divide-y divide-border/60 p-0">
              {order.items && order.items.length > 0 ? (
                order.items.map((item, idx) => (
                  <div
                    key={`${item.productId}-${idx}`}
                    className="flex items-center gap-4 p-4 sm:p-5"
                  >
                    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-border/80 bg-muted/40">
                      {item.productSnapshot?.images?.[0] ? (
                        <RemoteImage
                          src={item.productSnapshot.images[0]}
                          alt={item.productSnapshot.name ?? "Item"}
                          fill
                          sizes="64px"
                          priority={idx < 4}
                          className="object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                          <ShoppingBag className="h-6 w-6" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="font-semibold text-sm text-foreground line-clamp-1">
                        {item.productSnapshot?.name ?? "Product Item"}
                      </p>
                      {item.variantSnapshot?.options && (
                        <div className="flex flex-wrap gap-1.5">
                          {item.variantSnapshot.options.map((opt, i) => (
                            <span
                              key={i}
                              className="rounded-md bg-secondary/80 px-2 py-0.5 text-[10px] font-medium text-secondary-foreground"
                            >
                              {opt.name}: {opt.value}
                            </span>
                          ))}
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Qty: {item.quantity} × {formatPrice(Number(item.unitPrice), "NGN")}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="font-semibold text-sm text-foreground">
                        {formatPrice(Number(item.totalPrice), "NGN")}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  No line items details available for this order.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: Customer & Delivery Info */}
        <div className="space-y-6">
          <Card className="rounded-3xl border-border">
            <CardHeader className="pb-3 border-b border-border/60">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <User className="h-4 w-4 text-primary" />
                Buyer Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3.5 p-5">
              <div>
                <p className="text-xs text-muted-foreground">Customer Name</p>
                <p className="text-sm font-semibold text-foreground">
                  {customerName}
                </p>
              </div>
              {order.customer?.email && (
                <div>
                  <p className="text-xs text-muted-foreground">Email</p>
                  <a
                    href={`mailto:${order.customer.email}`}
                    className="text-sm font-medium text-primary hover:underline flex items-center gap-1.5"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    {order.customer.email}
                  </a>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-3xl border-border">
            <CardHeader className="pb-3 border-b border-border/60">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <MapPin className="h-4 w-4 text-primary" />
                Shipping Destination
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5">
              <p className="text-sm text-foreground/90 leading-relaxed">
                {addressString}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Advance Status Modal */}
      <ConfirmDialog
        open={Boolean(advanceTarget)}
        onOpenChange={(v) => !v && setAdvanceTarget(null)}
        title="Update Order Fulfillment"
        description={
          <>
            Mark Order <strong>#{order.orderNumber}</strong> as{" "}
            <strong>{advanceTarget}</strong>? The buyer will receive a tracking status
            update.
          </>
        }
        confirmText={`Mark as ${advanceTarget}`}
        isLoading={updateStatusMutation.isPending}
        onConfirm={() => {
          if (advanceTarget) {
            updateStatusMutation.mutate(advanceTarget);
          }
        }}
      />
    </div>
  );
}
