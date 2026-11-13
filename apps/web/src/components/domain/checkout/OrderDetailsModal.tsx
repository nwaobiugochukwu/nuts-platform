"use client";

import { RemoteImage } from "@/component/ui/RemoteImage";
import { OrderStatusBadge } from "@/component/order/OrderItemSnapshot";
import type { CheckoutShippingAddressDto } from "@/api/dto/order";
import type { OrderStatus } from "@/api/core/types";
import { Button } from "@/component/ui/button";
import {
Dialog,
DialogContent,
DialogHeader
} from "@/component/ui/dialog";
import { formatPrice } from "@/lib/util";
import {
Calendar,
Clock,
MapPin,
Package,
ShoppingBag,
Truck,
User
} from "lucide-react";

interface OrderItem {
  productId: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  productSnapshot?: {
    name: string;
    sku?: string;
    images?: string[];
  };
  variantSnapshot?: {
    options?: { name: string; value: string }[];
  } | null;
}

interface OrderCustomer {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
}

interface OrderHistoryItem {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  createdAt: Date | string;
}

export interface DetailedOrder {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus?: string;
  totalAmount: number;
  finalAmount: number;
  discountAmount?: number;
  platformFee?: number;
  vendorRevenue?: number;
  customer?: OrderCustomer;
  shippingAddress?: string | CheckoutShippingAddressDto | null;
  items: OrderItem[];
  statusHistory?: OrderHistoryItem[];
  createdAt: Date | string;
}

interface OrderDetailsModalProps {
  order: DetailedOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdateStatus?: (status: OrderStatus) => void;
  isUpdatingStatus?: boolean;
  allowedNextStatuses?: OrderStatus[];
}

export function OrderDetailsModal({
  order,
  open,
  onOpenChange,
  onUpdateStatus,
  isUpdatingStatus = false,
  allowedNextStatuses = [],
}: OrderDetailsModalProps) {
  if (!order) return null;

  const parsedAddress = typeof order.shippingAddress === "string"
    ? (() => {
        try {
          return JSON.parse(order.shippingAddress);
        } catch {
          return order.shippingAddress;
        }
      })()
    : order.shippingAddress;

  const customerName = order.customer
    ? `${order.customer.firstName ?? ""} ${order.customer.lastName ?? ""}`.trim() || order.customer.email
    : "Customer";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl p-6 sm:p-8 [scrollbar-width:thin]">
        <DialogHeader className="border-b border-neutral-100 dark:border-neutral-800 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2.5">
                <span className="font-mono text-xl font-bold text-neutral-900 dark:text-white">
                  #{order.orderNumber}
                </span>
                <OrderStatusBadge status={order.status} />
              </div>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-neutral-400">
                <Calendar className="h-3.5 w-3.5" />
                Placed on {new Date(order.createdAt).toLocaleString()}
              </p>
            </div>

            {/* Quick Fulfilment Action */}
            {onUpdateStatus && allowedNextStatuses.length > 0 && (
              <div className="flex items-center gap-2">
                {allowedNextStatuses.map((st) => (
                  <Button
                    key={st}
                    size="sm"
                    disabled={isUpdatingStatus}
                    onClick={() => onUpdateStatus(st)}
                    className="gap-1.5 rounded-xl text-xs font-medium bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
                  >
                    <Truck className="h-3.5 w-3.5" />
                    <span>Advance to {st}</span>
                  </Button>
                ))}
              </div>
            )}
          </div>
        </DialogHeader>

        <div className="space-y-6 pt-4">
          {/* Customer & Delivery Information */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-neutral-100 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-900/50 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2">
                <User className="h-3.5 w-3.5" />
                Customer Info
              </div>
              <p className="text-sm font-semibold text-neutral-900 dark:text-white">{customerName}</p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{order.customer?.email}</p>
            </div>

            <div className="rounded-2xl border border-neutral-100 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-900/50 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2">
                <MapPin className="h-3.5 w-3.5" />
                Shipping Destination
              </div>
              {parsedAddress ? (
                typeof parsedAddress === "object" ? (
                  <div className="text-xs text-neutral-700 dark:text-neutral-300 space-y-0.5">
                    <p className="font-semibold">{parsedAddress.fullName}</p>
                    <p>{parsedAddress.street}</p>
                    <p>
                      {parsedAddress.city}, {parsedAddress.state}, {parsedAddress.country}
                    </p>
                    {parsedAddress.phone && (
                      <p className="text-xs text-neutral-400 mt-1">Tel: {parsedAddress.phone}</p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-neutral-700 dark:text-neutral-300 whitespace-pre-line">
                    {parsedAddress}
                  </p>
                )
              ) : (
                <p className="text-xs text-neutral-400">No physical address specified</p>
              )}
            </div>
          </div>

          {/* Purchased Items Table */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-2">
              <ShoppingBag className="h-3.5 w-3.5" />
              Order Items ({order.items.length})
            </h3>
            <div className="rounded-2xl border border-neutral-100 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-800 overflow-hidden">
              {order.items.map((item, idx) => {
                const img = item.productSnapshot?.images?.[0];
                return (
                  <div key={idx} className="flex items-center justify-between p-3.5 sm:p-4 bg-white dark:bg-[#121214]">
                    <div className="flex items-center gap-3.5">
                      <div className="relative h-12 w-12 rounded-xl bg-neutral-100 dark:bg-neutral-800 overflow-hidden shrink-0 flex items-center justify-center">
                        {img ? (
                          <RemoteImage
                            src={img}
                            alt={item.productSnapshot?.name ?? "Product"}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <Package className="h-5 w-5 text-neutral-400" />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-neutral-900 dark:text-white">
                          {item.productSnapshot?.name ?? "Purchased Item"}
                        </p>
                        {item.variantSnapshot?.options && item.variantSnapshot.options.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {item.variantSnapshot.options.map((opt, i) => (
                              <span
                                key={i}
                                className="inline-block text-xs bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-neutral-500 font-medium"
                              >
                                {opt.name}: {opt.value}
                              </span>
                            ))}
                          </div>
                        )}
                        <p className="text-xs text-neutral-400 mt-0.5">
                          {formatPrice(item.unitPrice)} × {item.quantity}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-semibold text-neutral-900 dark:text-white">
                        {formatPrice(item.totalPrice ?? item.unitPrice * item.quantity)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Pricing Totals Breakdown */}
          <div className="rounded-2xl border border-neutral-100 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-900/60 p-4 space-y-2 text-xs">
            <div className="flex justify-between text-neutral-600 dark:text-neutral-400">
              <span>Gross Order Value</span>
              <span>{formatPrice(order.totalAmount)}</span>
            </div>
            {Boolean(order.discountAmount) && (
              <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-medium">
                <span>Discount Applied</span>
                <span>-{formatPrice(order.discountAmount!)}</span>
              </div>
            )}
            {order.platformFee !== undefined && (
              <div className="flex justify-between text-neutral-500 dark:text-neutral-400 text-xs">
                <span>Platform Commission (15%)</span>
                <span className="font-medium text-emerald-600 dark:text-emerald-400 font-mono">
                  {formatPrice(
                    order.platformFee > 0
                      ? order.platformFee
                      : Math.round(order.finalAmount * 0.15 * 100) / 100,
                  )}
                </span>
              </div>
            )}
            {order.vendorRevenue !== undefined && (
              <div className="flex justify-between text-neutral-500 dark:text-neutral-400 text-xs">
                <span>Vendor Net Payout (85%)</span>
                <span className="font-medium font-mono text-neutral-900 dark:text-white">
                  {formatPrice(
                    order.vendorRevenue > 0
                      ? order.vendorRevenue
                      : Math.round(order.finalAmount * 0.85 * 100) / 100,
                  )}
                </span>
              </div>
            )}
            <div className="border-t border-neutral-200 dark:border-neutral-800 pt-2 flex justify-between font-semibold text-sm text-neutral-900 dark:text-white">
              <span>Settled Total</span>
              <span>{formatPrice(order.finalAmount)}</span>
            </div>
          </div>

          {/* Audit Timeline / Status History */}
          {order.statusHistory && order.statusHistory.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-2">
                <Clock className="h-3.5 w-3.5" />
                Fulfillment Timeline
              </h3>
              <div className="relative pl-6 space-y-4 before:absolute before:bottom-2 before:top-2 before:left-2.5 before:w-0.5 before:bg-neutral-200 dark:before:bg-neutral-800">
                {order.statusHistory.map((h, i) => (
                  <div key={h.id || i} className="relative flex items-start gap-3 text-xs">
                    <div className="absolute -left-6 top-1 h-2.5 w-2.5 rounded-full border-2 border-white dark:border-[#0c0c0e] bg-indigo-500" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-neutral-900 dark:text-white">
                          {h.toStatus}
                        </span>
                        {h.fromStatus && (
                          <span className="text-xs text-neutral-400">
                            (from {h.fromStatus})
                          </span>
                        )}
                      </div>
                      {h.note && (
                        <p className="text-xs text-neutral-500 mt-0.5">{h.note}</p>
                      )}
                      <p className="text-xs text-neutral-400 mt-0.5">
                        {new Date(h.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
