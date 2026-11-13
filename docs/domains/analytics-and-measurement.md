# Analytics and Measurement

> **Scope:** Event ingestion, identity and attribution definitions, retention, and admin/vendor reporting. The [domain index](README.md) maps this guide to its owning API modules; the [backend module map](../reference/backend-module-map.md) provides source and frontend navigation. Current behavior and proposed scale work are labeled separately.

## Domain boundary and outcomes

Event ingestion, identity and attribution definitions, retention, and admin/vendor reporting.

## End-to-end flow

This guide documents the capability across the web experience, API, persisted data, providers, and asynchronous work. Capability implementation details follow below.

## Cross-application behavior and integration contracts

### Reporting and attribution flow

Product-view events are buffered in Redis and flushed every 10 seconds in batches of up to 100 records, with at most 10 batches per flush. The API publishes each batch event through RabbitMQ when available; if the broker publish fails, it persists those views directly to PostgreSQL. If Redis is unavailable at request time, it writes the raw view directly using a stable event ID and duplicate-safe insertion. The recent-history table is separately upserted synchronously so recommendation shelves can use fresh activity. Product-detail reads therefore still cause a database write even when raw analytics event writes are buffered. The current analytics system is a cached query service rather than a pre-aggregated warehouse. Admin/vendor summary results are cached for 20 seconds; open dashboard pages poll summary data every 30 seconds and detail data every 60 seconds while visible. This is polling, not a push stream.

Analytics date filters and daily trend buckets use Africa/Lagos calendar days. API date ranges are capped at 730 days. Raw `product_views` and `marketplace_events` rows older than 730 days are removed in bounded batches by a Redis-coordinated daily job. Recommendation events use a separate 180-day retention policy, except FOLLOW/UNFOLLOW history, which is retained for follower-change reporting. These windows are product defaults, not a complete legal retention policy for orders, audit logs, or backups.

Metric definitions:

- **Views** count recorded visits/events. **Unique viewers/visitors** count distinct account IDs or anonymous browser/session IDs for the selected period; those identities are not merged across devices or across login state.
- **View to cart** and **view to paid purchase** use distinct identified account/product pairs that viewed in the selected period, then look for the later action within seven days. Anonymous viewers are excluded because they cannot be reliably joined to an order account. Recent cohorts can still convert after the selected period ends, while the denominator remains the view cohort.
- **Cart to paid purchase** uses cart/product/variant lines added in the selected period and counts a matching non-cancelled paid order within seven days of the latest add for that line. It is a line-level cohort, not a user-level checkout rate.
- **Current followers** are active follow relationships for active, approved stores at query time. **New follows**, **unfollows**, and **net growth** are event counts during the selected period. Historical follow events are not a snapshot of who follows today.
- Paid revenue is gross order/product-line value for successful, refund-pending, or refunded payments, before subtracting refunds. Order-status counts remain status-based and can include unpaid orders.
- Analytics panels default to a day view and include vendor follower totals and follower changes. The dashboard refresh intervals are separate from the server cache TTL, so a poll can receive a cached result.

The current service executes several raw-table aggregations per dashboard request and relies on short cache windows. Before traffic grows materially, record query latency, rows scanned, cache hit rate, product-view queue depth/age, and DB write load. Use those measurements to decide when to add daily rollups or a dedicated analytical store; replacing transactional reads with an unmeasured warehouse would add consistency and operational costs without a known benefit.

## Implementation details by capability

The sections below describe each capability’s problem, current API mechanism, failure cases, and trade-offs. The [backend module map](../reference/backend-module-map.md) provides folder and source navigation.

### Analytics ingestion and reporting

Admins and vendors need consistent sales, product, traffic, and funnel reporting with explicit date and identity definitions.

#### Current backend mechanism

Controllers accept tracking and report requests; admin/vendor services query PostgreSQL and use short-lived caches. Product views have a Redis buffer and RabbitMQ delivery path; other event types include direct PostgreSQL writes. Retention jobs bound some event tables.

##### Event paths

- **Product views:** `trackView` first upserts recent-product history in PostgreSQL, then appends the raw event to a Redis list. A timer flushes up to ten batches of 100 records per invocation and publishes records individually to RabbitMQ. If Redis is unavailable, the request writes the event directly to PostgreSQL. If broker publishing fails, the flusher falls back to PostgreSQL. The RabbitMQ consumer writes each delivered product-view event as an individual row operation with duplicate protection. The Redis buffer has no explicit application-level length cap in this service.
- **Marketplace events:** store views first check that the vendor is active and approved; accepted marketplace events are written directly through Prisma to PostgreSQL. Analytics write failures do not fail the related commerce write.
- **Recommendation interactions:** the batch DTO accepts at most 100 events, but accepted events are still written directly to PostgreSQL. This endpoint is not a queue-backed ingestion path.
- **Reporting:** admin and vendor reports share PostgreSQL with commerce; browser dashboards poll cached report endpoints.

Key code paths: [ProductViewsService](../../apps/api/src/modules/analytics/tracking/product-views/product-views.service.ts), [AnalyticsConsumer](../../apps/api/src/infrastructure/rabbitmq/analytics.consumer.ts), [MarketplaceEventsService](../../apps/api/src/modules/analytics/tracking/marketplace-events.service.ts), [RecommendationEventsService](../../apps/api/src/modules/analytics/tracking/recommendation-events.service.ts), and [RecommendationEventsDto](../../apps/api/src/modules/analytics/tracking/recommendation-events.dto.ts).

#### Failure scenarios and trade-offs

Redis failure sends product views to PostgreSQL; buffered views still synchronously upsert recent history. Reports share the commerce database. Definitions and configured limits are in this guide; data-plane alternatives are in [Analytics at Scale](../scaling/analytics-at-scale.md).

## Scaling and traffic direction

The [Scaling Strategy](../scaling/README.md#analytics-ingestion-and-reporting) contains the staged concurrency, traffic, and growth recommendations for this domain. Scale analytics ingestion and reporting only after measuring event age, buffer/queue depth, shared-database load, and dashboard freshness. Compare options in [Analytics at Scale](../scaling/analytics-at-scale.md); benchmark methodology is in [Performance and Capacity](../performance/README.md).
