"use client";

import { RemoteImage } from "@/component/ui/RemoteImage";
import { orderService,paymentService } from "@/api";
import { getApiErrorMessage } from "@/api/core/error";
import { CustomerLayout } from "@/component/layout/CustomerLayout";
import { ConfirmDialog } from "@/component/modal/ConfirmDialog";
import { OrderStatusBadge } from "@/component/order/OrderItemSnapshot";
import { WriteReviewDialog } from "@/component/review/WriteReviewDialog";
import { Button } from "@/component/ui/button";
import { Card,CardContent,CardHeader,CardTitle } from "@/component/ui/card";
import { queryKey } from "@/lib/query-key";
import { safePaystackCheckoutUrl } from "@/lib/safe-paystack-url";
import { formatDate,formatPrice } from "@/lib/util";
import { useMutation,useQuery,useQueryClient } from "@tanstack/react-query";
import {
ArrowLeft,
Clock,
CreditCard,
Edit2,
Loader2,
MapPin,
Package,
Receipt,
Star
} from "lucide-react";
import Link from "@/components/navigation/AppLink";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export default function OrderDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const qc = useQueryClient();

  // Dialog States
  const [isCancelOpen, setIsCancelOpen] = useState(false);
  const [isEditShippingOpen, setIsEditShippingOpen] = useState(false);
  const [shippingAddressText, setShippingAddressText] = useState("");
  const [isInitializingPayment, setIsInitializingPayment] = useState(false);
  const [isVerifyingPayment, setIsVerifyingPayment] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const hasVerifiedRef = useRef(false);

  // 1. Fetch Order
  const { data: order, isLoading } = useQuery({
    queryKey: queryKey.order.detail(id),
    queryFn: async () => {
      const { data } = await orderService.getById(id);
      return data;
    },
    enabled: !!id,
    refetchInterval: (query) =>
      query.state.data?.status === "PENDING" ? 3000 : false,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
  });

  // Background self-healing check: automatically verify payment if order is PENDING
  useEffect(() => {
    if (!order || order.status !== "PENDING") {
      hasVerifiedRef.current = false;
      return;
    }

    if (hasVerifiedRef.current) return;
    hasVerifiedRef.current = true;

    let cancelled = false;
    const verifyPendingPayment = async () => {
      try {
        setIsVerifyingPayment(true);

        // Check if there is a callback reference in the URL query string
        const urlParams =
          typeof window !== "undefined"
            ? new URLSearchParams(window.location.search)
            : null;
        const callbackRef =
          urlParams?.get("reference")?.trim() ||
          urlParams?.get("trxref")?.trim() ||
          null;

        if (callbackRef) {
          const verifyRes = await paymentService.verify(callbackRef);
          if (!cancelled && verifyRes.data?.status === "SUCCESS") {
            qc.invalidateQueries({ queryKey: queryKey.order.detail(id) });
            return;
          }
        }

        const { data: payment } = await paymentService.getByOrderId(id);
        if (cancelled || !payment?.transactionReference) return;

        if (payment.status === "SUCCESS") {
          qc.invalidateQueries({ queryKey: queryKey.order.detail(id) });
          return;
        }

        const verifyRes = await paymentService.verify(payment.transactionReference);
        if (!cancelled && verifyRes.data?.status === "SUCCESS") {
          qc.invalidateQueries({ queryKey: queryKey.order.detail(id) });
        }
      } catch {
        // Silent recovery — background polling and webhook will settle state
      } finally {
        if (!cancelled) {
          setIsVerifyingPayment(false);
        }
      }
    };

    void verifyPendingPayment();
    return () => {
      cancelled = true;
    };
  }, [order, id, qc]);

  // Reservation countdown timer for PENDING orders
  const isOrderPending = order?.status === "PENDING";
  const expiresAtMs =
    isOrderPending && order
      ? order.paymentExpiresAt
        ? new Date(order.paymentExpiresAt).getTime()
        : new Date(order.createdAt).getTime() + 15 * 60 * 1000
      : null;

  useEffect(() => {
    if (!isOrderPending || expiresAtMs === null) return;

    const interval = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (expiresAtMs - current <= 0) {
        qc.invalidateQueries({ queryKey: queryKey.order.detail(id) });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isOrderPending, expiresAtMs, id, qc]);

  const timeLeftMs =
    expiresAtMs !== null ? Math.max(0, expiresAtMs - now) : null;

  const formatTimeLeft = (ms: number) => {
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Cancel Mutation
  const cancelMutation = useMutation({
    mutationFn: () => orderService.cancel(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKey.order.list() });
      qc.invalidateQueries({ queryKey: queryKey.order.detail(id) });
      setIsCancelOpen(false);
      toast.success("Order cancelled successfully");
    },
    onError: (err: unknown) =>
      toast.error(getApiErrorMessage(err, "Failed to cancel order")),
  });

  // Update Shipping Mutation
  const updateShippingMutation = useMutation({
    mutationFn: (newAddress: string) => orderService.updateShipping(id, newAddress),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKey.order.detail(id) });
      setIsEditShippingOpen(false);
      toast.success("Shipping address updated successfully");
    },
    onError: (err: unknown) =>
      toast.error(getApiErrorMessage(err, "Failed to update shipping address")),
  });

  // Direct Paystack Initialization Flow
  const handleInitiatePayment = async () => {
    try {
      setIsInitializingPayment(true);
      const res = await paymentService.initialize(id);
      const authUrl = res.data?.authorizationUrl;
      if (authUrl) {
        const checkoutUrl = safePaystackCheckoutUrl(authUrl);
        if (!checkoutUrl) throw new Error("Invalid Paystack checkout URL");
        toast.success("Redirecting to secure payment...");
        window.location.assign(checkoutUrl);
      } else {
        toast.success("Payment initiated successfully");
        qc.invalidateQueries({ queryKey: queryKey.order.detail(id) });
      }
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, "Payment initialization failed. Please retry."));
    } finally {
      setIsInitializingPayment(false);
    }
  };

  if (isLoading) {
    return (
      <CustomerLayout>
        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="h-64 animate-pulse rounded-3xl bg-neutral-100 dark:bg-neutral-900" />
        </div>
      </CustomerLayout>
    );
  }

  if (!order) {
    return (
      <CustomerLayout>
        <div className="mx-auto max-w-5xl px-4 py-16 text-center">
          <p className="text-muted-foreground">Order not found.</p>
          <Button asChild variant="outline" className="mt-4 rounded-full">
            <Link href="/order">Back to Orders</Link>
          </Button>
        </div>
      </CustomerLayout>
    );
  }

  const isPending = order.status === "PENDING";
  const isDelivered = order.status === "DELIVERED";
  const isCancelled = order.status === "CANCELLED";

  // Format shipping address display
  const renderShippingAddress = () => {
    if (!order.shippingAddress) {
      return <p className="text-muted-foreground">No shipping address recorded.</p>;
    }
    if (typeof order.shippingAddress === "string") {
      return <p className="text-sm font-medium leading-relaxed">{order.shippingAddress}</p>;
    }
    return (
      <address className="not-italic text-sm font-medium leading-relaxed space-y-1">
        <p className="font-bold text-foreground">{order.shippingAddress.fullName}</p>
        <p>{order.shippingAddress.street}</p>
        <p>
          {order.shippingAddress.city}, {order.shippingAddress.state}, {order.shippingAddress.country}
        </p>
        <p className="text-muted-foreground text-xs">{order.shippingAddress.phone}</p>
      </address>
    );
  };

  const getShippingStringForEdit = (): string => {
    if (typeof order.shippingAddress === "string") return order.shippingAddress;
    if (order.shippingAddress) {
      return `${order.shippingAddress.fullName}, ${order.shippingAddress.street}, ${order.shippingAddress.city}, ${order.shippingAddress.state}, ${order.shippingAddress.country}. Phone: ${order.shippingAddress.phone}`;
    }
    return "";
  };

  return (
    <CustomerLayout>
      <div className={`mx-auto max-w-5xl px-3 sm:px-6 lg:px-8 py-5 sm:py-10 space-y-5 sm:space-y-8 ${isPending ? "pb-24 sm:pb-10" : ""}`}>
        {/* Top Navigation & Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <Link
            href="/order"
            className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back to My Orders</span>
          </Link>

          {isPending && (
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={cancelMutation.isPending || isVerifyingPayment}
                onClick={() => setIsCancelOpen(true)}
                className="flex-1 sm:flex-none rounded-xl text-xs h-9 font-semibold text-rose-600 border-rose-200 hover:bg-rose-50 dark:border-rose-900/40 dark:hover:bg-rose-950/20 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Cancel Order
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={isInitializingPayment || isVerifyingPayment}
                onClick={handleInitiatePayment}
                className="flex-1 sm:flex-none rounded-xl text-xs h-9 font-bold bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isVerifyingPayment ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Confirming...</span>
                  </>
                ) : isInitializingPayment ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Connecting...</span>
                  </>
                ) : (
                  <>
                    <CreditCard className="h-3.5 w-3.5" />
                    <span>Proceed to Payment</span>
                  </>
                )}
              </Button>
            </div>
          )}
        </div>

        {/* Pending Order Verification / Stock Reservation Banner */}
        {isPending && isVerifyingPayment ? (
          <div className="flex items-center gap-3 rounded-2xl border border-sky-500/20 bg-sky-500/10 px-4 py-3 text-sky-900 dark:text-sky-200 shadow-xs">
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-sky-600 dark:text-sky-400" />
            <div className="text-xs sm:text-sm font-medium">
              <span>
                <strong>Confirming your payment...</strong> Please wait while we check your transaction status.
              </span>
            </div>
          </div>
        ) : isPending && timeLeftMs !== null ? (
          <div className="flex items-center gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-amber-900 dark:text-amber-200 shadow-xs">
            <Clock className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="text-xs sm:text-sm font-medium">
              {timeLeftMs > 0 ? (
                <span>
                  Items are reserved for you. Complete payment within{" "}
                  <strong className="font-extrabold text-amber-950 dark:text-amber-100 font-mono">
                    {formatTimeLeft(timeLeftMs)}
                  </strong>{" "}
                  to secure your order before stock is released back into inventory.
                </span>
              ) : (
                <span>
                  Your reservation window has elapsed. Unpaid orders are automatically cancelled and reserved stock is restored.
                </span>
              )}
            </div>
          </div>
        ) : null}

        {/* Order Header Card */}
        <div className="rounded-2xl sm:rounded-3xl border border-border bg-card p-4 sm:p-6 lg:p-8 shadow-xs">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-4 sm:pb-6">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <h1 className="text-lg sm:text-2xl font-bold tracking-tight text-foreground font-mono">
                  #{order.orderNumber}
                </h1>
                <OrderStatusBadge status={order.status} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Placed on {formatDate(new Date(order.createdAt).toISOString())}
              </p>
            </div>

            <div className="text-left sm:text-right pt-2 sm:pt-0 border-t border-border/50 sm:border-0">
              <p className="text-[11px] sm:text-xs text-muted-foreground">{isPending ? "Amount Due" : "Total Paid"}</p>
              <p className="text-xl sm:text-2xl font-bold text-foreground">{formatPrice(order.finalAmount)}</p>
            </div>
          </div>

          {/* Fulfillment Status Progress Bar */}
          <div className="pt-4 sm:pt-6">
            <p className="text-[11px] sm:text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2.5 sm:mb-3">
              Fulfillment Status
            </p>
            <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
              {[
                { label: "Placed", active: true },
                {
                  label: "Confirmed",
                  active: ["CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED"].includes(order.status),
                },
                {
                  label: "In Transit",
                  active: ["SHIPPED", "DELIVERED"].includes(order.status),
                },
                {
                  label: "Delivered",
                  active: order.status === "DELIVERED",
                },
              ].map((step, idx) => (
                <div key={idx} className="space-y-1 sm:space-y-1.5 min-w-0">
                  <div
                    className={`h-1.5 sm:h-2 rounded-full transition-all ${
                      isCancelled
                        ? "bg-rose-200 dark:bg-rose-950"
                        : step.active
                        ? "bg-primary"
                        : "bg-muted"
                    }`}
                  />
                  <p
                    className={`text-[10px] sm:text-xs font-medium sm:font-semibold truncate text-center sm:text-left ${
                      step.active ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {step.label}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Content Split: Items & Summary */}
        <div className="grid grid-cols-1 gap-5 sm:gap-8 lg:grid-cols-3">
          {/* Order Items (2 cols on lg) */}
          <div className="lg:col-span-2 space-y-4 sm:space-y-6">
            <Card className="rounded-2xl border-border bg-card shadow-2xs overflow-hidden">
              <CardHeader className="p-4 sm:p-5 border-b border-border">
                <CardTitle className="text-sm sm:text-base font-semibold flex items-center gap-2">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <span>Ordered Items ({order.items.length})</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="divide-y divide-border p-0">
                {order.items.map((item, idx) => (
                  <div key={idx} className="p-3.5 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
                    <div className="flex items-start gap-3 sm:gap-4 min-w-0 flex-1">
                      {item.productSnapshot?.images?.[0] ? (
                        <RemoteImage
                          src={item.productSnapshot.images[0]}
                          alt={item.productSnapshot.name}
                          className="h-14 w-14 sm:h-16 sm:w-16 rounded-xl object-cover border border-border shrink-0"
                        />
                      ) : (
                        <div className="flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center rounded-xl bg-secondary text-muted-foreground shrink-0 border border-border">
                          <Package className="h-6 w-6 stroke-[1.2]" />
                        </div>
                      )}

                      <div className="space-y-1 min-w-0 flex-1">
                        <p className="text-xs sm:text-sm font-medium text-foreground truncate">
                          {item.productSnapshot?.name ?? "Product Item"}
                        </p>
                        <p className="text-[11px] sm:text-xs text-muted-foreground">
                          Qty: <span className="font-semibold text-foreground">{item.quantity}</span> ·{" "}
                          {formatPrice(item.unitPrice)} each
                        </p>
                        {item.variantSnapshot?.options && item.variantSnapshot.options.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-0.5">
                            {item.variantSnapshot.options.map((opt, oIdx) => (
                              <span
                                key={oIdx}
                                className="inline-block rounded-md bg-secondary px-2 py-0.5 text-[10px] sm:text-xs font-medium text-muted-foreground"
                              >
                                {opt.name}: {opt.value}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 pt-2 sm:pt-0 border-t border-border/50 sm:border-0 shrink-0">
                      <span className="font-bold text-foreground text-xs sm:text-sm">
                        {formatPrice(item.totalPrice)}
                      </span>

                      {/* Review Button if order is DELIVERED */}
                      {isDelivered && (
                        <WriteReviewDialog
                          productId={item.productId}
                          productName={item.productSnapshot?.name ?? "Product"}
                        >
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="rounded-xl text-xs h-7 sm:h-8 px-2.5 sm:px-3 font-semibold flex items-center gap-1.5 cursor-pointer"
                          >
                            <Star className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-amber-500 fill-amber-500" />
                            <span>Review Item</span>
                          </Button>
                        </WriteReviewDialog>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Sidebar: Shipping & Payment Summary */}
          <div className="space-y-4 sm:space-y-6">
            {/* Shipping Address Card */}
            <Card className="rounded-2xl border-border bg-card shadow-2xs">
              <CardHeader className="p-4 sm:p-5 pb-2.5 sm:pb-3 flex flex-row items-center justify-between">
                <CardTitle className="text-xs sm:text-sm font-bold flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span>Shipping Address</span>
                </CardTitle>
                {isPending && (
                  <button
                    type="button"
                    onClick={() => {
                      setShippingAddressText(getShippingStringForEdit());
                      setIsEditShippingOpen(true);
                    }}
                    className="text-xs font-semibold text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <Edit2 className="h-3 w-3" />
                    <span>Edit</span>
                  </button>
                )}
              </CardHeader>
              <CardContent className="p-4 sm:p-5 pt-0 text-xs">
                {renderShippingAddress()}
              </CardContent>
            </Card>

            {/* Price Breakdown */}
            <Card className="rounded-2xl border-border bg-card shadow-2xs">
              <CardHeader className="p-4 sm:p-5 pb-2.5 sm:pb-3">
                <CardTitle className="text-xs sm:text-base font-semibold flex items-center gap-2">
                  <Receipt className="h-4 w-4 text-muted-foreground" />
                  <span>Payment Breakdown</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 sm:p-5 pt-0 space-y-2.5 text-xs">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span className="font-semibold text-foreground">{formatPrice(order.totalAmount)}</span>
                </div>

                {order.discountAmount > 0 && (
                  <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-medium">
                    <span>Discount Code</span>
                    <span>-{formatPrice(order.discountAmount)}</span>
                  </div>
                )}

                {order.referralDiscountAmount > 0 && (
                  <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-medium">
                    <span>Referral Discount</span>
                    <span>-{formatPrice(order.referralDiscountAmount)}</span>
                  </div>
                )}

                <div className="border-t border-border pt-3 flex justify-between text-xs sm:text-sm font-bold">
                  <span>{isPending ? "Total Due" : "Total Paid"}</span>
                  <span className="text-foreground">{formatPrice(order.finalAmount)}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Mobile Sticky Pay Bar for Pending Orders */}
        {isPending && (
          <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background/95 backdrop-blur-md px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-lg sm:hidden">
            <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="text-[11px] font-medium text-muted-foreground block leading-tight">
                  Amount Due
                </span>
                <p className="truncate text-base font-extrabold text-foreground">
                  {formatPrice(order.finalAmount)}
                </p>
              </div>
              <Button
                type="button"
                disabled={isInitializingPayment || isVerifyingPayment}
                onClick={handleInitiatePayment}
                className="h-10 rounded-xl px-5 text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs flex items-center gap-1.5 cursor-pointer shrink-0 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isVerifyingPayment ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Confirming...</span>
                  </>
                ) : isInitializingPayment ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Connecting...</span>
                  </>
                ) : (
                  <>
                    <CreditCard className="h-3.5 w-3.5" />
                    <span>Proceed to Payment</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Dialog 1: Cancel Order */}
        <ConfirmDialog
          open={isCancelOpen}
          onOpenChange={setIsCancelOpen}
          title="Cancel this order?"
          description={`Are you sure you want to cancel order #${order.orderNumber}? Any reserved items will be released back into inventory.`}
          confirmText="Yes, Cancel Order"
          variant="destructive"
          isLoading={cancelMutation.isPending}
          onConfirm={() => cancelMutation.mutate()}
        />

        {/* Dialog 2: Edit Shipping Address */}
        {isEditShippingOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
            <div className="w-full max-w-md rounded-2xl bg-card p-5 sm:p-6 shadow-2xl border border-border space-y-4">
              <h3 className="text-base font-semibold text-foreground">Update Shipping Address</h3>
              <p className="text-xs text-muted-foreground">
                You can change the delivery destination before the order begins processing.
              </p>

              <textarea
                value={shippingAddressText}
                onChange={(e) => setShippingAddressText(e.target.value)}
                rows={3}
                placeholder="Full address, city, state, country, and contact phone..."
                className="w-full rounded-xl border border-input bg-background p-3 text-xs sm:text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={updateShippingMutation.isPending}
                  onClick={() => setIsEditShippingOpen(false)}
                  className="rounded-xl text-xs h-9 cursor-pointer"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={!shippingAddressText.trim() || updateShippingMutation.isPending}
                  onClick={() => updateShippingMutation.mutate(shippingAddressText.trim())}
                  className="rounded-xl text-xs h-9 font-bold bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs cursor-pointer"
                >
                  {updateShippingMutation.isPending ? "Saving..." : "Save Address"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </CustomerLayout>
  );
}
