# Dead letters and failed events runbook

How failed background work is handled, and what to do when it needs a person. Two places hold failures; both have an alert and a tool.

## How a failed message moves

1. The outbox relay copies each event from the database to RabbitMQ. A refused publish waits 5 s, 10 s, 20 s ... (up to 15 minutes, with jitter). After 8 attempts the row is **DEAD** ([ADR 0006](../../architecture/adr/0006-outbox-retry-ordering-and-relay-ownership.md)).
2. A consumer (email, inventory, notifications, analytics, audit, vendor events) handles each message. If it fails:
   - **Permanent** failure (unreadable or malformed message): straight to the dead-letter queue (DLQ).
   - **Transient** failure (database, network, timeout): retried after 10 s, then 1 min, then 10 min. After the last retry it goes to the DLQ.
   - **Open circuit breaker** (Paystack, email provider, Cloudinary down): the message waits a minute and tries again without using a retry, for up to about an hour.
3. Consumers ignore a message they already handled, using the outbox row id as the message id (`processed_events`). A replay is therefore safe for email and inventory.

## Alerts

| Alert | Meaning | First look |
|---|---|---|
| `OutboxDeadEvents` | The relay gave up on events | `npm run outbox -- list` |
| `OutboxStuck` | Oldest pending event is over 2 minutes old | Is the broker up (`BrokerDown`)? Is the worker role running? |
| `DeadLetterQueueNotEmpty` | Something is in the DLQ | `npm run dlq -- list` |
| `ConsumerDeadLettering` | A consumer dead-lettered messages in the last 15 minutes; the `queue` label says which | Worker logs for that queue |
| `DeadLetterQueueOldMessage` | The oldest dead letter is over an hour old | Nobody has handled it; follow below |
| `ConsumerRetriesHigh` | Many retries on a queue | A dependency is failing; nothing is lost yet |

## Dead outbox events

```
npm run outbox -- list                       # what is dead and why (lastError)
npm run outbox -- replay --dry-run           # what a replay would do
npm run outbox -- replay                     # put them all back in the queue
npm run outbox -- replay --id <uuid>         # one event
```

Fix the cause first (broker down, a bad payload). Replay resets the row to pending with zero attempts; the relay publishes it within seconds.

## Dead-letter queue

```
npm run dlq -- list                          # nothing is removed
npm run dlq -- replay --dry-run
npm run dlq -- replay --queue q.nuts.emails --limit 50
npm run dlq -- purge --queue q.nuts.emails --yes
```

- A **permanent** failure will fail again if replayed: read it first, and fix or purge it.
- A message replayed more than 3 times is skipped unless `--force` is given.
- Replaying emails or inventory is safe against duplicates when the message has an id (the consumer skips what it already handled). Old messages without an id are not protected.
- `purge` deletes the messages; it needs `--yes` and a queue name.

## Checks after replay

`nuts_outbox_dead_events` and the DLQ depth return to 0, and `nuts_consumer_messages_total{outcome="dead-lettered"}` stops rising.
