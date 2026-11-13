-- CreateIndex for high-performance outbox polling
CREATE INDEX IF NOT EXISTS "outbox_events_pending_process_idx" ON "outbox_events" ("createdAt" ASC) WHERE "status" IN ('PENDING', 'FAILED') AND "attempts" < 5;
