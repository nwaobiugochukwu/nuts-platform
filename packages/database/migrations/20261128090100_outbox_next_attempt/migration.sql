-- Retry with backoff: the relay claims a failed row only once next_attempt_at has passed.
ALTER TABLE "outbox_events" ADD COLUMN "next_attempt_at" TIMESTAMP(3);

-- Rows the old relay abandoned (FAILED with 5 attempts) become DEAD so they show up in the
-- alert and can be replayed with `npm run outbox -- replay`.
UPDATE "outbox_events" SET "status" = 'DEAD' WHERE "status" = 'FAILED' AND "attempts" >= 5;

CREATE INDEX "outbox_events_status_next_attempt_at_idx" ON "outbox_events"("status", "next_attempt_at");
