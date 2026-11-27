-- Provider webhooks are stored once, as received, before anything is processed: the endpoint
-- answers the provider at once and the work happens from a queue, with retries. The unique key
-- (provider, event_key) makes a provider's own redelivery of the same event harmless.
CREATE TABLE "webhook_inbox" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "event_key" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "webhook_inbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "webhook_inbox_provider_event_key_key" ON "webhook_inbox"("provider", "event_key");
CREATE INDEX "webhook_inbox_status_received_at_idx" ON "webhook_inbox"("status", "received_at");
