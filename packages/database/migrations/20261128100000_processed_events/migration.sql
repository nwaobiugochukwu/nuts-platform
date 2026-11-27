-- Which queue messages each consumer has already handled, so a redelivered message (after a
-- crash, a deploy, a retry or an outbox replay) does not repeat its side effect.
CREATE TABLE "processed_events" (
    "id" TEXT NOT NULL,
    "consumer" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "processed_events_consumer_message_id_key" ON "processed_events"("consumer", "message_id");
CREATE INDEX "processed_events_status_completed_at_idx" ON "processed_events"("status", "completed_at");
