# Audit trail

Audit events are recorded **after** the work and never make a request wait. Design: [ADR 0003](../architecture/adr/0003-process-model-audit-pipeline-and-durable-workflows.md).

## How an event travels

1. **Standard events** (`AuditLogService.log(...)`, `record(...)` or the `@Audit` decorator): published to RabbitMQ (`q.nuts.audit`, routing key `audit.event`) with publisher confirms. The `worker` role writes them to `audit_logs` in batches of up to 50 (or every 250 ms) and acknowledges a message only after its row is stored. If the broker is unavailable, the event is held in a bounded in-memory buffer (5,000 events) and written straight to the database every second; if the buffer overflows, the oldest event is dropped and an error is logged.
2. **Critical events** (`ctx.audit(...)` inside `TransactionRunner.run`): written to the transactional outbox in the same database transaction as the change, so the audit event exists if and only if the change does. The outbox relay publishes it to the same queue.

Every event has a unique `eventId`, so redelivery never creates duplicates (verified: re-publishing an event leaves one row).

## Using it

Audit is declared, not hand-written. The **controller method** says what happened; the **service**, which knows the specifics (the id of the record it just created, the old and new values), attaches them with one line. A global interceptor merges both into one event after the response, so the request never waits.

```ts
// Controller: what happened. Recorded after a 2xx; the actor, IP, user agent and request id come from the request.
@Audit({ action: 'CATEGORY_UPDATED', entity: 'Category' })
@Patch(':id')
update(@Param('id') id: string, @Body() dto: UpdateCategoryDto) { return this.categories.update(id, dto); }

// Service: the details only it knows. No audit service, no await, nothing to inject.
auditDetails({
  entityId: updated.id,
  payload: { old: { name: existing.name }, new: { name: updated.name } },
});
```

| Need | Use |
|---|---|
| Record a successful action | `@Audit({ action, entity })` on the controller method |
| The id, old and new values, extra facts | `auditDetails({ entityId, payload, before, after })` in the service (several calls merge) |
| One action name that depends on data (activate or deactivate, which Google sign-in outcome) | `auditDetails({ action })` overrides the controller's default |
| Record a failure too (failed sign-in) | `onFailure: true`, plus `failureAction: 'USER_LOGIN_FAILED'`; `failureOnly: true` to record only failures |
| A second event in the same request (automatic unsuspend during sign-in) | `auditAlso({ action, entity, entityId })` |
| Money, permissions, anything that must never be lost | `ctx.audit(...)` inside the transaction (see below) |
| Code that runs outside any request (the announcement scheduler, the deletion purge job) | `AuditLogService.log` / `record` directly; these are the only allowed direct calls |

Outside a request `auditDetails` and `auditAlso` do nothing. A vendor performing an action is recorded in the event's payload as `actor: { role: 'VENDOR', id }`, because `audit_logs.userId` and `adminId` reference the user and admin tables.

**Guard rails:** `npm run check:architecture` rejects any new direct audit-log call in a service (the four legitimate ones, listed in `scripts/check-architecture.mjs`, can only shrink); `audited-endpoints.spec.ts` pins all 60 audited endpoints to their action so a removed decorator fails the build; `audit-wiring.spec.ts` runs the real chain (context middleware, controller, service, interceptor) over HTTP.

Critical events written inside a transaction:

```ts
await this.tx.run(async (ctx) => {
  await this.wallet.settleVendorEarning(vendorId, amount, orderId, ctx.tx);
  await ctx.audit({ action: 'VENDOR_SETTLED', entity: 'Order', entityId: orderId, adminId });
}, { name: 'order.settle', preset: 'critical' });
```

Use the transaction form for money movement, refunds, payouts, role or permission changes and sign-in/session events; those are moved over in the next release together with the transaction conversions.

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

- The critical-tier events (money, permissions) still use the standard path; moving them into their transactions with `ctx.audit` is the next release, together with converting the remaining files to the transaction helper.
- Retention, archiving and the read-access policy are described in the plan but not implemented.
