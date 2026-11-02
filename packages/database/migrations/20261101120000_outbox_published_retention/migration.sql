CREATE INDEX "outbox_events_status_processedAt_idx" ON "outbox_events"("status", "processedAt");
