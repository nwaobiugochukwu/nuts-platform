ALTER TYPE "OrderStatus" ADD VALUE 'REFUND_PENDING';
ALTER TYPE "PaymentStatus" ADD VALUE 'REFUND_PENDING';
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_REFUNDED';

CREATE TYPE "PaymentRefundStatus" AS ENUM (
  'REQUESTED',
  'PENDING',
  'PROCESSING',
  'NEEDS_ATTENTION',
  'FAILED',
  'PROCESSED'
);

CREATE TABLE "payment_refunds" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "status" "PaymentRefundStatus" NOT NULL DEFAULT 'REQUESTED',
  "providerReference" VARCHAR(64) NOT NULL,
  "providerRefundId" TEXT,
  "providerStatus" TEXT,
  "requestedByAdminId" TEXT NOT NULL,
  "previousOrderStatus" "OrderStatus" NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" VARCHAR(1000),
  "lastCheckedAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_refunds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_refunds_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "payment_refunds_providerReference_key"
  ON "payment_refunds"("providerReference");
CREATE UNIQUE INDEX "payment_refunds_providerRefundId_key"
  ON "payment_refunds"("providerRefundId");
CREATE INDEX "payment_refunds_paymentId_createdAt_idx"
  ON "payment_refunds"("paymentId", "createdAt");
CREATE INDEX "payment_refunds_status_updatedAt_idx"
  ON "payment_refunds"("status", "updatedAt");
