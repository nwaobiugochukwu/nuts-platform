import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import { UNPAID_ORDER_EXPIRATION } from '@api/common/constants';
import { VENDOR_COMMISSION_RATE } from '@api/common/constants/commission.constants';
import { vendorMayChangeOrderStatus } from '../constants/order-status.constants';
import { AdminOrderResponseDto } from '../dto/admin-order-response.dto';
import { CheckoutResponseDto } from '../dto/checkout-response.dto';
import {
  OrderAppliedVoucherDto,
  OrderResponseDto,
} from '../dto/order-response.dto';
import { VendorOrderResponseDto } from '../dto/vendor-order-response.dto';
import {
  isRecord,
  jsonValueLabel,
  type AdminOrderWithRelations,
  type OrderWithItems,
  type OrderWithItemsList,
  type VendorOrderWithRelations,
  type VendorOrderWithRelationsList,
} from './order-includes.util';

// Turns loaded orders into the response shapes of the customer, vendor and admin endpoints,
// and reads the variant a line was bought with.

/** "Size: M, Colour: Red" from a variant's options, however they were stored. */
export function variantLabel(options: Prisma.JsonValue): string | null {
  if (Array.isArray(options)) {
    return options
      .map((option) => {
        if (
          isRecord(option) &&
          typeof option.name === 'string' &&
          typeof option.value === 'string'
        ) {
          return `${option.name}: ${option.value}`;
        }

        return jsonValueLabel(option);
      })
      .join(', ');
  }

  if (typeof options === 'object' && options !== null) {
    return Object.entries(options as Record<string, unknown>)
      .map(([name, value]) => `${name}: ${jsonValueLabel(value)}`)
      .join(', ');
  }

  return null;
}

export function normalizeVariantSnapshot(snapshot: unknown): {
  options: {
    name: string;
    value: string;
  }[];
} | null {
  if (!snapshot) {
    return null;
  }

  if (Array.isArray(snapshot)) {
    return {
      options: snapshot.filter(
        (
          option,
        ): option is {
          name: string;
          value: string;
        } =>
          isRecord(option) &&
          typeof option.name === 'string' &&
          typeof option.value === 'string',
      ),
    };
  }

  if (typeof snapshot === 'object' && snapshot !== null) {
    return {
      options: Object.entries(snapshot as Record<string, unknown>).map(
        ([name, value]) => ({
          name,
          value: String(value),
        }),
      ),
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// RESPONSE MAPPERS
// ---------------------------------------------------------------------------

export function toAppliedVouchers(
  order: OrderWithItems | OrderWithItemsList,
): OrderAppliedVoucherDto[] {
  const usages = 'discountCodeUsages' in order ? order.discountCodeUsages : [];
  if (usages.length > 0) {
    return usages.map((usage) => ({
      code: usage.discountCode.code,
      description: usage.discountCode.description ?? null,
      scope: usage.discountCode.scope,
      type: usage.discountCode.type,
      value: Number(usage.discountCode.value),
      amount: Number(usage.discountAmount),
      automatic: usage.discountCode.autoApply,
    }));
  }
  // Legacy orders: only the joined code string was kept ("STORE20, PLAT10").
  return (order.discountCode ?? '')
    .split(',')
    .map((code) => code.trim())
    .filter(Boolean)
    .map((code) => ({
      code,
      description: null,
      scope: 'PLATFORM' as const,
      type: 'FIXED' as const,
      value: 0,
      amount: null,
      automatic: false,
    }));
}

export function toResponse(
  order: OrderWithItems | OrderWithItemsList,
): OrderResponseDto {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,

    totalAmount: Number(order.totalAmount),
    discountAmount: Number(order.discountAmount),
    referralDiscountAmount: Number(order.referralDiscountAmount),
    finalAmount: Number(order.finalAmount),

    // Detail responses carry the payment; list responses do not.
    ...('payment' in order
      ? { paymentStatus: order.payment?.status ?? PaymentStatus.PENDING }
      : {}),

    discountCode: order.discountCode ?? null,

    appliedVouchers: toAppliedVouchers(order),

    referralCode: order.referralCode ?? null,

    shippingAddress: order.shippingAddress,

    shippingAddressId: order.shippingAddressId ?? null,

    createdAt: order.createdAt,

    paymentExpiresAt:
      order.status === OrderStatus.PENDING
        ? new Date(
            new Date(order.createdAt).getTime() +
              UNPAID_ORDER_EXPIRATION.PENDING_TTL_MINUTES * 60 * 1000,
          )
        : null,

    items: order.orderItems.map((item) => ({
      productId: item.productId,
      variantId: item.variantId ?? null,

      quantity: item.quantity,

      unitPrice: Number(item.unitPrice),

      totalPrice: Number(item.totalPrice),

      productSnapshot: item.productSnapshot as {
        name: string;
        sku: string;
        images: string[];
      },

      variantSnapshot: normalizeVariantSnapshot(item.variantSnapshot),
    })),
  };
}

export function toCheckoutResponse(order: OrderWithItems): CheckoutResponseDto {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,

    totalAmount: Number(order.totalAmount),
    discountAmount: Number(order.discountAmount),
    referralDiscountAmount: Number(order.referralDiscountAmount),
    finalAmount: Number(order.finalAmount),

    discountCode: order.discountCode ?? null,

    referralCode: order.referralCode ?? null,

    items: order.orderItems.map((item) => {
      const productSnapshot = item.productSnapshot as {
        name?: string;
        sku?: string;
        images?: string[];
      } | null;

      const variantSnapshot = normalizeVariantSnapshot(item.variantSnapshot);

      return {
        productName: productSnapshot?.name ?? item.product.name,

        variantName: variantSnapshot
          ? variantSnapshot.options.map((option) => option.value).join(', ')
          : undefined,

        quantity: item.quantity,

        unitPrice: Number(item.unitPrice),
      };
    }),

    shippingAddress: order.shippingAddress ?? null,

    createdAt: order.createdAt,

    paymentExpiresAt:
      order.status === OrderStatus.PENDING
        ? new Date(
            new Date(order.createdAt).getTime() +
              UNPAID_ORDER_EXPIRATION.PENDING_TTL_MINUTES * 60 * 1000,
          )
        : null,
  };
}

export function toVendorResponse(
  order: VendorOrderWithRelations | VendorOrderWithRelationsList,
): VendorOrderResponseDto {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,

    totalAmount: Number(order.totalAmount),
    discountAmount: Number(order.discountAmount),
    referralDiscountAmount: Number(order.referralDiscountAmount),
    finalAmount: Number(order.finalAmount),

    discountCode: order.discountCode ?? null,

    referralCode: order.referralCode ?? null,

    shippingAddress: order.shippingAddress,

    stockRestored: order.stockRestored,

    isMultiVendor: !vendorMayChangeOrderStatus(
      order.orderItems.map((item) => item.vendorId),
    ),

    createdAt: order.createdAt,
    updatedAt: order.updatedAt,

    customer: {
      id: order.user.id,
      email: order.user.email,
      firstName: order.user.firstName,
      lastName: order.user.lastName,
    },

    items: order.orderItems.map((item) => ({
      productId: item.productId,
      variantId: item.variantId ?? null,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      totalPrice: Number(item.totalPrice),

      productSnapshot: item.productSnapshot as {
        name: string;
        sku: string;
        images: string[];
      },

      variantSnapshot: normalizeVariantSnapshot(item.variantSnapshot),
    })),

    statusHistory:
      'statusHistory' in order
        ? order.statusHistory.map((history) => {
            const actor =
              history.changedByUser ??
              history.changedByVendor ??
              history.changedByAdmin;

            return {
              id: history.id,
              fromStatus: history.fromStatus ?? null,
              toStatus: history.toStatus,
              note: history.note ?? null,
              createdAt: history.createdAt,
              changedBy: actor
                ? {
                    id: actor.id,
                    email: actor.email,
                    firstName: actor.firstName,
                    lastName: actor.lastName,
                  }
                : null,
            };
          })
        : [],
  };
}

export function toAdminResponse(
  order: AdminOrderWithRelations,
): AdminOrderResponseDto {
  const itemsTotal =
    order.orderItems?.reduce((sum, item) => sum + Number(item.totalPrice), 0) ??
    0;
  const effectiveBase =
    itemsTotal > 0
      ? itemsTotal
      : Number(order.finalAmount || order.totalAmount || 0);
  const vendorRevenue =
    Math.round(effectiveBase * VENDOR_COMMISSION_RATE * 100) / 100;
  const platformFee = Math.round((effectiveBase - vendorRevenue) * 100) / 100;

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,

    paymentStatus: order.payment?.status ?? PaymentStatus.PENDING,

    totalAmount: Number(order.totalAmount),

    discountAmount: Number(order.discountAmount),

    referralDiscountAmount: Number(order.referralDiscountAmount),

    finalAmount: Number(order.finalAmount),

    discountCode: order.discountCode ?? null,

    referralCode: order.referralCode ?? null,

    platformFee,
    vendorRevenue,

    shippingAddress: order.shippingAddress,

    stockRestored: order.stockRestored,

    createdAt: order.createdAt,
    updatedAt: order.updatedAt,

    customer: {
      id: order.user.id,
      email: order.user.email,
      firstName: order.user.firstName,
      lastName: order.user.lastName,
    },

    payment: order.payment
      ? {
          id: order.payment.id,
          status: order.payment.status,
          amount: Number(order.payment.amount),
          currency: order.payment.currency,
          transactionId: order.payment.transactionId,
        }
      : null,

    items: order.orderItems.map((item) => ({
      productId: item.productId,

      productSku:
        (
          item.productSnapshot as {
            sku?: string;
          } | null
        )?.sku ?? item.product.sku,

      quantity: item.quantity,

      unitPrice: Number(item.unitPrice),

      totalPrice: Number(item.totalPrice),

      productSnapshot: item.productSnapshot as {
        name: string;
        sku: string;
        images: string[];
      },

      variantSnapshot: normalizeVariantSnapshot(item.variantSnapshot),
    })),

    statusHistory: order.statusHistory.map((history) => {
      const actor =
        history.changedByUser ??
        history.changedByVendor ??
        history.changedByAdmin;

      return {
        id: history.id,
        fromStatus: history.fromStatus,
        toStatus: history.toStatus,
        note: history.note,
        createdAt: history.createdAt,
        changedBy: actor
          ? {
              id: actor.id,
              email: actor.email,
              firstName: actor.firstName,
              lastName: actor.lastName,
            }
          : null,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// DOMAIN EVENTS
// ---------------------------------------------------------------------------

/**
 * Writes the order.shipped, order.delivered or order.cancelled event to the outbox in the same
 * transaction as the status change, so it is never lost and never sent for a rolled-back change.
 */
