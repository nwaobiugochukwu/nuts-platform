# ADR 0007: The event backbone: envelope, naming, publishing and queues

- **Status:** Accepted; the foundation is implemented (phase 5.1). Moving each event onto it is phase 5.2 onward.
- **Date:** 2026-11-28
- **Owners:** Platform engineering
- **Related code:** [`event-envelope.util.ts`](../../../apps/api/src/infrastructure/messaging/events/event-envelope.util.ts), [`domain-events.constants.ts`](../../../apps/api/src/infrastructure/messaging/events/domain-events.constants.ts), [`rabbitmq.constants.ts`](../../../apps/api/src/infrastructure/messaging/rabbitmq/rabbitmq.constants.ts), [`transaction-runner.service.ts`](../../../apps/api/src/infrastructure/database/transaction-runner.service.ts)
- **Related:** audit findings R19 and R20 and the event catalog in [event-driven-and-resilience-audit.md](../event-driven-and-resilience-audit.md); [ADR 0006](0006-outbox-retry-ordering-and-relay-ownership.md) for delivery guarantees.

## Context

Order and payment events were in-process (`@nestjs/event-emitter`), emitted after the commit with a log-only catch: if the process stopped in between, the event was lost, and no consumer outside that process could use it. Four routing keys had no publisher. Each outbox event had its own ad-hoc payload shape. Two queues were bound to wildcards (`order.*`, `payment.*`), so the first real order event published would have been delivered to the email consumer, which cannot read it, and dead-lettered.

## Decisions

1. **One envelope.** Every domain event has `eventId`, `type`, `version`, `occurredAt`, `aggregate {type, id}`, `actor`, `requestId` and `payload`. Consumers ignore fields they do not know, so a payload can grow. A change that would break a consumer gets a new `version`, and consumers handle both while old events are in flight. `parseEnvelope` is a consumer's first line: anything that is not an envelope, or is a version it cannot read, is a permanent failure and goes straight to the dead-letter queue.
2. **One naming rule.** `<aggregate>.<fact>`: lower case, the aggregate first, the past-tense fact in snake_case (`order.shipped`, `user.login_from_new_device`). The full catalog (about 80 names) is `DomainEvents`; a test enforces the rule, that no name repeats, and that each constant is named after its event. `referral.reward.credited` became `referral.reward_credited`. Commands (do this: `email.dispatch`, `notification.dispatch`, `inventory.adjust`, `workflow.start`, `analytics.event`) are not facts and stay in `RABBITMQ_ROUTING_KEYS`.
3. **Publish inside the transaction.** `ctx.publish({ type, aggregate, payload })` on the transaction runner writes the envelope to the outbox in the same database transaction as the change, and wakes the relay only after commit. The event exists if and only if the change does. `ctx.emit` (the old flat payload) remains for the existing events until they are moved.
4. **Each consumer owns its queue, bound to exact keys.** `QUEUE_BINDINGS` lists, per queue, the exact keys it handles. No wildcards. A new consumer gets a new queue and its own bindings, with retries, a dead-letter path and idempotency by `eventId`, so one slow or failing consumer never blocks another. Because declaring a queue never removes a binding, `OBSOLETE_BINDINGS` are unbound at connect. The four never-published routing keys and the `inventory.*` wildcard were deleted.
5. **The actor is `system` unless given.** Producers that know the signed-in person pass it.

## Consequences

- A new event is: add its name to the catalog, publish it with `ctx.publish`, and give each consumer a queue and binding. No other consumer is affected.
- Existing flat-payload consumers (notifications, vendor follow, analytics, audit, email, inventory) keep working unchanged; they move to the envelope one at a time.
- The 8 in-process events (phase 5.2) are moved by publishing the envelope inside the transaction and adding one queue per consumer that reacts to it.
- The cron jobs still publish to a queue by its own name; each queue stays bound under that name until they publish commands.
