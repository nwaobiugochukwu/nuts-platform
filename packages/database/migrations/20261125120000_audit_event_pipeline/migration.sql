-- Audit pipeline (ADR 0003): additive columns only; existing rows and readers are unaffected.
ALTER TABLE "audit_logs"
  ADD COLUMN "eventId" TEXT,
  ADD COLUMN "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "requestId" TEXT,
  ADD COLUMN "outcome" TEXT,
  ADD COLUMN "statusCode" INTEGER,
  ADD COLUMN "source" TEXT,
  ADD COLUMN "before" JSONB,
  ADD COLUMN "after" JSONB;

-- Existing rows happened when they were created.
UPDATE "audit_logs" SET "occurredAt" = "createdAt";

CREATE UNIQUE INDEX "audit_logs_eventId_key" ON "audit_logs"("eventId");
CREATE INDEX "audit_logs_requestId_idx" ON "audit_logs"("requestId");
