import assert from "node:assert/strict";
import test from "node:test";

import { describeOrderPayment } from "./order-payment.ts";

const order = (status, paymentStatus) => ({ status, paymentStatus, finalAmount: 52000 });

test("an order cancelled before payment shows nothing paid and keeps the order total", () => {
  const r = describeOrderPayment(order("CANCELLED", "PENDING"));
  assert.deepEqual(r, { state: "NOT_CHARGED", amountPaid: 0, orderTotal: 52000 });
  // Also correct for older responses that carry no payment status.
  assert.equal(describeOrderPayment(order("CANCELLED")).amountPaid, 0);
  assert.equal(describeOrderPayment(order("CANCELLED", "FAILED")).amountPaid, 0);
});

test("a pending order is awaiting payment, not paid", () => {
  const r = describeOrderPayment(order("PENDING", "PENDING"));
  assert.equal(r.state, "AWAITING");
  assert.equal(r.amountPaid, 0);
});

test("a settled order is paid in full", () => {
  assert.deepEqual(describeOrderPayment(order("DELIVERED", "SUCCESS")), {
    state: "PAID",
    amountPaid: 52000,
    orderTotal: 52000,
  });
  assert.equal(describeOrderPayment(order("SHIPPED")).state, "PAID");
});

test("refunds were paid and are being or have been returned", () => {
  assert.equal(describeOrderPayment(order("REFUND_PENDING", "REFUND_PENDING")).state, "REFUND_PENDING");
  const refunded = describeOrderPayment(order("REFUNDED", "REFUNDED"));
  assert.equal(refunded.state, "REFUNDED");
  assert.equal(refunded.amountPaid, 52000);
});
