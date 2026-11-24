/**
 * What an order's payment summary should say.
 *
 * The page used to label every non-pending order "Total Paid" with the order amount, so an
 * order cancelled BEFORE payment claimed the customer had paid in full. The amount paid is
 * what was actually charged; the order total is what the cart came to.
 */
export type OrderPaymentState =
  | "PAID" // charged and settled
  | "AWAITING" // payment still expected
  | "NOT_CHARGED" // closed (cancelled/failed) without ever being paid
  | "REFUND_PENDING"
  | "REFUNDED";

export interface OrderPaymentInput {
  status: string;
  paymentStatus?: string | null;
  finalAmount: number;
}

export interface OrderPaymentSummary {
  state: OrderPaymentState;
  /** Money actually taken from the customer (0 when never charged). */
  amountPaid: number;
  /** What the order came to. */
  orderTotal: number;
}

export function describeOrderPayment(order: OrderPaymentInput): OrderPaymentSummary {
  const orderTotal = order.finalAmount;
  const payment = order.paymentStatus ?? null;

  if (payment === "REFUNDED" || order.status === "REFUNDED") {
    return { state: "REFUNDED", amountPaid: orderTotal, orderTotal };
  }
  if (payment === "REFUND_PENDING" || order.status === "REFUND_PENDING") {
    return { state: "REFUND_PENDING", amountPaid: orderTotal, orderTotal };
  }
  if (payment === "SUCCESS") {
    return { state: "PAID", amountPaid: orderTotal, orderTotal };
  }
  if (order.status === "CANCELLED") {
    // A paid order that is cancelled moves to a refund state, so a plain CANCELLED
    // order was never charged.
    return { state: "NOT_CHARGED", amountPaid: 0, orderTotal };
  }
  if (order.status === "PENDING" || payment === "PENDING" || payment === "FAILED") {
    return payment === "FAILED" && order.status !== "PENDING"
      ? { state: "NOT_CHARGED", amountPaid: 0, orderTotal }
      : { state: "AWAITING", amountPaid: 0, orderTotal };
  }
  // Confirmed / processing / shipped / delivered without an explicit payment status
  // (older API responses): the order only advances after payment.
  return { state: "PAID", amountPaid: orderTotal, orderTotal };
}
