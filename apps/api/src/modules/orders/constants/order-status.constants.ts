import { BadRequestException } from '@nestjs/common';
import { OrderStatus, PaymentStatus } from '@prisma/client';

export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING]: [
    OrderStatus.CONFIRMED,
    OrderStatus.PROCESSING,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.CONFIRMED]: [OrderStatus.PROCESSING, OrderStatus.CANCELLED],
  [OrderStatus.PROCESSING]: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
  [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED],
  [OrderStatus.DELIVERED]: [OrderStatus.REFUNDED],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.REFUND_PENDING]: [OrderStatus.REFUNDED],
  [OrderStatus.REFUNDED]: [],
};

/** Statuses where stock was deducted at checkout and may be restored on cancel. */
export const STOCK_RESTORE_FROM_STATUSES: OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.PROCESSING,
];

export function assertValidOrderTransition(
  from: OrderStatus,
  to: OrderStatus,
): void {
  if (from === to) return;
  const allowed = ORDER_STATUS_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new BadRequestException(
      `Invalid order transition: ${from} → ${to}. Allowed transitions from ${from}: ${ORDER_STATUS_TRANSITIONS[from].length ? ORDER_STATUS_TRANSITIONS[from].join(', ') : 'none'}`,
    );
  }
}

export function shouldRestoreStock(
  from: OrderStatus,
  to: OrderStatus,
): boolean {
  return (
    to === OrderStatus.CANCELLED && STOCK_RESTORE_FROM_STATUSES.includes(from)
  );
}

export function resolvePaymentStatusAfterOrderChange(
  current: PaymentStatus,
  nextOrderStatus: OrderStatus,
): PaymentStatus | null {
  if (nextOrderStatus === OrderStatus.CANCELLED) {
    if (current === PaymentStatus.SUCCESS) return PaymentStatus.REFUNDED;
    if (current === PaymentStatus.PENDING) return PaymentStatus.FAILED;
    return null;
  }

  if (
    nextOrderStatus === OrderStatus.DELIVERED &&
    current === PaymentStatus.PENDING
  ) {
    return PaymentStatus.SUCCESS;
  }

  return null;
}

export function generateStatusNote(params: {
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
  changedByAdminId?: string;
  changedByVendorId?: string;
  changedByUserId?: string;
  manualNote?: string;
}): string {
  const {
    fromStatus,
    toStatus,
    changedByAdminId,
    changedByVendorId,
    changedByUserId,
    manualNote,
  } = params;

  let note: string;

  if (changedByAdminId) {
    note = `Status updated by admin`;
  } else if (changedByVendorId) {
    if (toStatus === OrderStatus.SHIPPED) {
      note = 'Order shipped';
    } else if (toStatus === OrderStatus.DELIVERED) {
      note = 'Order delivered';
    } else {
      note = 'Status updated by vendor';
    }
  } else if (changedByUserId) {
    if (toStatus === OrderStatus.CANCELLED) {
      note = 'Cancelled by customer';
    } else {
      note = 'Status updated';
    }
  } else {
    // System-triggered transition (e.g., payment confirmed or auto-expired)
    if (
      fromStatus === OrderStatus.PENDING &&
      toStatus === OrderStatus.PROCESSING
    ) {
      note = 'Payment confirmed';
    } else if (
      fromStatus === OrderStatus.PENDING &&
      toStatus === OrderStatus.CANCELLED
    ) {
      note = 'Cancelled automatically';
    } else if (toStatus === OrderStatus.REFUND_PENDING) {
      note = 'Refund requested';
    } else if (toStatus === OrderStatus.REFUNDED) {
      note = 'Refund processed';
    } else {
      note = 'Status updated';
    }
  }

  if (manualNote) {
    note += ` — ${manualNote}`;
  }

  return note;
}
