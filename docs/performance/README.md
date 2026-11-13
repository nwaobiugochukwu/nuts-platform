# Performance and Capacity

This is the source of truth for capacity methodology and measured results. Configuration values are not throughput guarantees. No production-like load-test report is currently recorded, so NUTS has no defensible numeric claim for concurrent users, requests per second, or analytics events per second.

## Configuration reference (not a capacity result)

- The checked-in [production Compose API service](../../docker-compose.yml) is configured for one CPU and 768 MB of memory and has a fixed `container_name`. This describes the repository's Compose reference, not necessarily the live host.
- The API PostgreSQL pool [defaults to 15 connections per process](../../apps/api/src/infrastructure/prisma/prisma.service.ts); the [API example](../../apps/api/.env.example) uses 10. The total potential connection count grows with API replicas and other clients, so budget workers, migrations, and administrative sessions against the database limit.
- The default HTTP throttle in [API configuration](../../apps/api/src/app.module.ts) permits 100 requests per 60-second window per throttle key. It is not a global throughput limit. Redis-outage fallback is per API process, so it does not establish a shared cross-replica ceiling.
- Product-view ingestion flushes at most ten batches of 100 records per timer invocation. This is a per-flush implementation limit, not a sustained event rate; the service still publishes individual events and has no explicit application-level Redis buffer cap.
- Analytics summaries are cached for 20 seconds while visible dashboards poll summaries every 30 seconds and details every 60 seconds. This bounds the current refresh cadence; it does not measure query concurrency or database load.

### What can be compared today

| Current configuration | What it tells us | What it does not tell us |
|---|---|---|
| One CPU and 768 MB in the repository's production Compose API service | The resource shape to include as a reference benchmark profile. | Maximum concurrent users, requests per second, or tail latency on the live host. |
| 10 example / 15 code-default DB connections per API process | A connection-budget input. A rough upper bound is `API replicas × configured pool`, plus workers and operational clients. | Queries per second or whether a workload stays within its latency target. |
| 100 throttled requests per 60 seconds per throttle key | An application-level abuse-control setting. | A global traffic cap or sustainable server capacity. |
| Up to 1,000 product-view records attempted per flush invocation | A bounded flush-loop setting that can be compared with measured queue age and drain rate. | A sustainable events-per-second result or bounded end-to-end delivery delay. |

**Current measured capacity is unknown.** Do not convert these values into a concurrency or traffic estimate. Compare the current reference profile with candidate API replica counts, database tiers, and isolated analytics storage only by running the same workload and acceptance targets on each profile.

See [Analytics and Measurement](../domains/analytics-and-measurement.md) for current event paths and failure behavior, and [Analytics at Scale](../scaling/analytics-at-scale.md) for data-plane alternatives.

## Benchmark method

Before assigning capacity numbers, benchmark a production-like build and database tier with representative catalog, order, event, and user data. Record the tested commit, container limits, database tier and settings, Redis and RabbitMQ configuration, API replica count, and test duration.

Run distinct workload profiles rather than one blended number. Start with the repository's current Compose resource profile, then repeat the same tests with candidate replica/database configurations so the comparison has controlled inputs:

1. Public browsing: home, category, product detail, search, and discover pagination.
2. Personalized browsing: home recommendations, recently viewed, vendor follows, and impression/click tracking.
3. Commerce: cart mutation, checkout, concurrent stock contention, payment initialization, and webhook handling using provider test tooling.
4. Analytics ingestion: product views, store views, marketplace actions, and recommendation batches at increasing event rates.
5. Analytics reads: concurrent admin/vendor dashboards across short and long date ranges.
6. Soak and recovery: sustained load, bursts, API restart, Redis outage, RabbitMQ outage, database slowdown, and backlog drain.

For each profile, step concurrency upward until the predeclared latency/error target fails or resource/queue pressure stops recovering. Test multiple API replicas because per-process pools, throttling fallback, timers, and consumer concurrency can change behavior as replicas are added. Record the highest load that meets the target with headroom as the tested sustainable point; do not extrapolate it linearly to a different host or data shape.

For each run report concurrent clients and throughput separately, then capture p50/p95/p99 latency, error rate, CPU/memory, PostgreSQL active and waiting connections, query latency, Redis memory and buffer length, RabbitMQ ready/unacked depth, oldest event age, analytics data loss/duplicates, and dashboard freshness. Define the target latency and error budget before the run. The sustainable capacity is the load that meets those targets with headroom; it is not the highest number a short stress run can produce.

## Result record

No benchmark results have been recorded in this repository. Add a result only with all fields below; compare results only when workload and infrastructure are materially equivalent.

| Date | Commit SHA | Infrastructure | Workload profile | Concurrent clients | Sustainable throughput | p95 / p99 latency | Error rate | Queue/database pressure | Notes |
|---|---|---|---|---:|---:|---|---:|---|---|
| — | — | — | — | — | — | — | — | — | No measured result yet |

A result should include raw output or a reproducible artifact, the test tool and version, test-data assumptions, and any known differences from production. Never infer capacity from configuration limits alone.
