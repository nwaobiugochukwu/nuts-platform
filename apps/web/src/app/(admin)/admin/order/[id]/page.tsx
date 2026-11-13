"use client";

import { adminOrderService } from "@/api";
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
  CreditCard,
  Copy,
  Mail,
  MapPin,
  Package,
  ShoppingBag,
  Store,
  Truck,
  User,
} from "lucide-react";
import Link from "@/components/navigation/AppLink";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

const nextStatus = (status: OrderStatus): OrderStatus | null => {
  switch (status) {
    case "PENDING":
      return "PROCESSING";
    case "PROCESSING":
      return "SHIPPED";
    case "SHIPPED":
      return "DELIVERED";
    default:
      return null;
  }
};

export default function AdminOrderDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [advanceTarget, setAdvanceTarget] = useState<OrderStatus | null>(null);

  const { data: order, isLoading, isError } = useQuery({
    queryKey: [...queryKey.admin.order, "detail", id],
    queryFn: async () => {
      const res = await adminOrderService.getById(id);
      return res.data;
    },
    enabled: Boolean(id),
    staleTime: 1000 * 60 * 3,
  });

  const updateStatusMutation = useMutation({
    mutationFn: (status: OrderStatus) =>
      adminOrderService.updateStatus(id, { status }),
    onSuccess: (_, newStatus) => {
      toast.success(`Order advanced to ${newStatus}`);
      qc.invalidateQueries({ queryKey: queryKey.admin.order });
      setAdvanceTarget(null);
    },
    onError: (e: unknown) =>
      toast.error(
        getApiErrorMessage(e, "Unable to advance order fulfillment status"),
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
          The requested order could not be located in administrative records.
        </p>
        <Button asChild className="mt-6">
          <Link href="/admin/order">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Orders
          </Link>
        </Button>
      </div>
    );
  }

  const nextSt = nextStatus(order.status);
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

  const currency = order.payment?.currency || "NGN";

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
          <Link href="/admin/order">
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
              <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold">
                Payment: {order.paymentStatus}
              </span>
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
          {nextSt && (
            <Button
              onClick={() => setAdvanceTarget(nextSt)}
              className="gap-2 self-start sm:self-auto font-semibold"
            >
              <Truck className="h-4 w-4" />
              Advance to {nextSt}
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
                Order Line Items ({order.items?.length ?? 0})
              </CardTitle>
            </CardHeader>
            <CardContent className="divide-y divide-border/60 p-0">
              {order.items && order.items.length > 0 ? (
                order.items.map((item, idx) => (
                  <div
                    key={idx}
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
                        {item.productSnapshot?.name ?? "Order Product"}
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
                        Qty: {item.quantity} × {formatPrice(item.unitPrice, currency)}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="font-semibold text-sm text-foreground">
                        {formatPrice(item.totalPrice, currency)}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  No line items found.
                </div>
              )}
            </CardContent>
          </Card>

          {/* Financial Breakdown Card */}
          <Card className="rounded-3xl border-border">
            <CardHeader className="pb-3 border-b border-border/60">
              <CardTitle className="text-base font-semibold flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-primary" />
                  Financial Breakdown
                </span>
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  {order.finalAmount > 0 && order.platformFee > 0
                    ? Math.round((order.platformFee / order.finalAmount) * 100)
                    : 15}
                  % Platform Cut
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-5 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Gross Order Value</span>
                <span>{formatPrice(order.totalAmount, currency)}</span>
              </div>
              {order.discountAmount > 0 && (
                <div className="flex justify-between text-emerald-600">
                  <span>Discount Applied</span>
                  <span>-{formatPrice(order.discountAmount, currency)}</span>
                </div>
              )}
              {order.referralDiscountAmount > 0 && (
                <div className="flex justify-between text-emerald-600">
                  <span>Referral Discount</span>
                  <span>-{formatPrice(order.referralDiscountAmount, currency)}</span>
                </div>
              )}

              {/* Commission Distribution Box */}
              {(() => {
                const final = Number(order.finalAmount || order.totalAmount || 0);
                const fee =
                  order.platformFee && order.platformFee > 0
                    ? Number(order.platformFee)
                    : Math.round(final * 0.15 * 100) / 100;
                const vRev =
                  order.vendorRevenue && order.vendorRevenue > 0
                    ? Number(order.vendorRevenue)
                    : Math.round(final * 0.85 * 100) / 100;
                const feePct = final > 0 ? Math.round((fee / final) * 100) : 15;
                const vPct = final > 0 ? Math.round((vRev / final) * 100) : 85;

                return (
                  <div className="rounded-2xl border border-border/60 bg-muted/30 p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                        Platform Commission ({feePct}%)
                      </span>
                      <span className="font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                        +{formatPrice(fee, currency)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-muted-foreground">
                        Vendor Net Payout ({vPct}%)
                      </span>
                      <span className="font-semibold text-foreground font-mono">
                        {formatPrice(vRev, currency)}
                      </span>
                    </div>

                    {/* Split Progress Bar */}
                    <div className="h-2 w-full overflow-hidden rounded-full bg-secondary flex">
                      <div
                        style={{ width: `${feePct}%` }}
                        className="bg-emerald-500 transition-all duration-300"
                        title={`Platform Fee: ${feePct}%`}
                      />
                      <div
                        style={{ width: `${vPct}%` }}
                        className="bg-blue-500 transition-all duration-300"
                        title={`Vendor Share: ${vPct}%`}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>Platform Retained ({feePct}%)</span>
                      <span>Vendor Disbursed ({vPct}%)</span>
                    </div>
                  </div>
                );
              })()}

              <div className="border-t border-border/60 pt-2 flex justify-between font-bold text-base text-foreground">
                <span>Total Settled (Customer Paid)</span>
                <span>{formatPrice(order.finalAmount, currency)}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Customer, Vendor, and Shipping */}
        <div className="space-y-6">
          <Card className="rounded-3xl border-border">
            <CardHeader className="pb-3 border-b border-border/60">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <User className="h-4 w-4 text-primary" />
                Customer
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3.5 p-5">
              <div>
                <p className="text-xs text-muted-foreground">Name</p>
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

          {order.vendor && (
            <Card className="rounded-3xl border-border">
              <CardHeader className="pb-3 border-b border-border/60">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Store className="h-4 w-4 text-primary" />
                  Assigned Vendor
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 p-5 text-sm">
                <p className="font-semibold text-foreground">
                  {order.vendor.storeName}
                </p>
              </CardContent>
            </Card>
          )}

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

          {order.payment && (
            <Card className="rounded-3xl border-border">
              <CardHeader className="pb-3 border-b border-border/60">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-primary" />
                  Payment Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5 p-5 text-xs">
                {order.payment.transactionId && (
                  <div>
                    <span className="text-muted-foreground">Transaction ID: </span>
                    <span className="font-mono text-foreground">
                      {order.payment.transactionId}
                    </span>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">Amount: </span>
                  <span className="font-semibold text-foreground">
                    {formatPrice(order.payment.amount, order.payment.currency)}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Status: </span>
                  <span className="font-semibold text-foreground">
                    {order.payment.status}
                  </span>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Advance Status Modal */}
      <ConfirmDialog
        open={Boolean(advanceTarget)}
        onOpenChange={(v) => !v && setAdvanceTarget(null)}
        title="Update Order Fulfillment"
        description={
          <>
            Advance Order <strong>#{order.orderNumber}</strong> to{" "}
            <strong>{advanceTarget}</strong>?
          </>
        }
        confirmText={`Advance to ${advanceTarget}`}
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
