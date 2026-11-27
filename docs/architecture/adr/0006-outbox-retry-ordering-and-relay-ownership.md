# ADR 0006: Outbox retry, ordering, and who owns the relay

- **Status:** Accepted; retry and dead status implemented, ordering and ownership decided here.
- **Date:** 2026-11-27
- **Owners:** Platform engineering
- **Related code:** [`outbox.relay.ts`](../../../apps/api/src/infrastructure/messaging/outbox/outbox.relay.ts), [`outbox-backoff.util.ts`](../../../apps/api/src/infrastructure/messaging/outbox/outbox-backoff.util.ts), [`outbox.mjs`](../../../apps/api/scripts/outbox.mjs)
- **Related:** audit findings R3, R4, R18 in [event-driven-and-resilience-audit.md](../event-driven-and-resilience-audit.md); I10 in [isolation-and-scale-audit.md](../isolation-and-scale-audit.md).

## Context

The relay copies events from the `outbox_events` table to RabbitMQ. A refused publish was retried on the very next 10-second tick, so five attempts were spent in under a minute. A row with five attempts was then skipped forever, with no status and no alert. Nothing said whether events must arrive in order, or which process runs the relay.

## Decisions

1. **Retry with backoff.** A failed row records `next_attempt_at`: 5 s, 10 s, 20 s, doubling to a 15-minute cap, with jitter (half to all of the delay) so rows that failed together do not retry together. The relay claims a failed row only once that time has passed.
2. **A dead status.** After 8 attempts the row becomes `DEAD`. Dead rows are counted in `nuts_outbox_dead_events`, raise the `OutboxDeadEvents` alert, appear in the stalled-event report, and are listed or put back with `npm run outbox -- list|replay [--id] [--dry-run]`. Rows the old relay abandoned (FAILED with 5 attempts) were migrated to `DEAD`.
3. **No ordering guarantee; consumers must tolerate any order.** The relay publishes a batch concurrently and retries a failed row later, so two events about one order or product can arrive in either order. We choose to declare every consumer order-tolerant rather than serialise the relay per aggregate, because serialising would make one stuck row block everything behind it for that aggregate and would cap throughput. Each event carries its own timestamp and the facts it needs; a consumer that cares about order must compare timestamps or use an idempotent, commutative update (the inventory consumer moves to an atomic increment for this reason, step 4.10). A new consumer that cannot tolerate reordering must say so in its PR.
4. **Delivery is at least once.** A crash between publish and settle republishes the row. Consumers must be idempotent (step 4.6). Replay widens the same window, which is why replay is a manual, logged action.
5. **One owner for the relay: the `worker` role.** Any number of workers may run the relay together, because rows are claimed with `FOR UPDATE SKIP LOCKED` and a claim older than 5 minutes is reclaimed. The relay's cleanup and alert crons run in `jobs`. Waking the relay right after a commit is a latency optimisation only; the 10-second poll is the guarantee, and a wake that runs before the commit is harmless.

## Consequences

- A broker outage no longer burns the attempt budget in a minute: while the broker is unavailable the relay does not claim at all, and after it returns, rows retry on their own schedule.
- An operator now has one signal (dead events) and one tool for outbox failures, as the dead-letter queue already had for consumers.
- Consumers get a written rule (reorder and duplicate tolerance) that the later steps of phase 4 and phase 5 implement and test.
- Open: the time-based `PROCESSING` reclaim after 5 minutes can republish a row that a slow relay is still publishing; this is accepted under at-least-once and covered by consumer idempotency.
