# Audit trail

Audit events are recorded **after** the work and never make a request wait. Design: [ADR 0003](../architecture/adr/0003-process-model-audit-pipeline-and-durable-workflows.md).

## How an event travels

1. **Standard events** (`AuditLogService.log(...)`, `record(...)` or the `@Audit` decorator): published to RabbitMQ (`q.nuts.audit`, routing key `audit.event`) with publisher confirms. The `worker` role writes them to `audit_logs` in batches of up to 50 (or every 250 ms) and acknowledges a message only after its row is stored. If the broker is unavailable, the event is held in a bounded in-memory buffer (5,000 events) and written straight to the database every second; if the buffer overflows, the oldest event is dropped and an error is logged.
2. **Critical events** (`ctx.audit(...)` inside `TransactionRunner.run`): written to the transactional outbox in the same database transaction as the change, so the audit event exists if and only if the change does. The outbox relay publishes it to the same queue.

Every event has a unique `eventId`, so redelivery never creates duplicates (verified: re-publishing an event leaves one row).

## Using it

```ts
// Decorator: records after a 2xx response; the request never waits.
@Audit({ action: 'PRODUCT_UPDATED', entity: 'Product', entityId: 'id' })
@Patch(':id')
update(...) { ... }

// Security-relevant endpoints can also record 4xx failures.
@Audit({ action: 'ADMIN_LOGIN', entity: 'Session', onFailure: true })

// Critical: inside the transaction that changes the data.
await this.tx.run(async (ctx) => {
  await this.wallet.settleVendorEarning(vendorId, amount, orderId, ctx.tx);
  await ctx.audit({ action: 'VENDOR_SETTLED', entity: 'Order', entityId: orderId, adminId });
}, { name: 'order.settle', preset: 'critical' });
```

Use the transaction form for money movement, refunds, payouts, role or permission changes and sign-in/session events. Everything else can use the decorator or `log()`.

## What is stored

`audit_logs` (additive columns): `eventId`, `occurredAt` (when it happened; `createdAt` is when it was written), `requestId`, `outcome`, `statusCode`, `source` (the process role), `before`, `after`, plus the existing action, entity, actor, IP, user agent and `payload`. Secrets (passwords, tokens, OTPs, card and account numbers, cookies, signatures) are replaced with `[REDACTED]` before an event leaves the process; long strings, large arrays and deep objects are truncated.

## Keeping it append-only

The application never updates or deletes audit rows. Enforce that in the database by giving the application role only INSERT and SELECT on `audit_logs`, and run retention under a separate maintenance role, for example:

```sql
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_logs" FROM nuts_app;
GRANT INSERT, SELECT ON "audit_logs" TO nuts_app;
```

(Role names depend on your host.) This is not applied by a migration because it depends on how the database roles are set up.

## Monitoring

Watch `nuts_rabbitmq_queue_messages{queue="q.nuts.audit"}` and the consumer count; the alert rules in `ops/prometheus/alerts.yml` cover backlog and missing consumers. Messages that fail to store after retries land in the dead-letter queue.

## Not done yet

The 64 existing `AuditLogService.log` call sites are unchanged but are now non-blocking and redacted automatically. Moving the critical ones (payments, wallets, admin and permission changes) to `ctx.audit`, and adding `@Audit` to controllers that do not audit yet, is incremental work. Retention, archiving and the read-access policy are described in the plan but not implemented.
