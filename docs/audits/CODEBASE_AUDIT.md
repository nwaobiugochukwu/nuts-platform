# Codebase Audit

## Scope and method

The repository inventory found 806 non-ignored files at the start of this review: roughly 441 API source files, 277 web source files, plus database migrations, packages, deployment configuration, and documentation. All API domain folders and the major web, shared-package, database, and deployment areas are listed below.

The review combined a repository-wide pattern scan for TODO/FIXME markers, console logging, loose any typing, ignored errors, Math.random use, and lint suppressions with manual review of the product discovery, recommendation, authentication, checkout/payment, OpenAPI, Docker, Compose, and documentation paths. This is a source review, not a production load, penetration, or migration-against-live-database assessment. No tests were run during this review.

## Fixes made in this review

| Area | Change | Why |
| --- | --- | --- |
| Personalized home shelf | Picked for you now renders only when the API returns products. | Empty, loading, and error placeholder content falsely implied recommendations existed before the ranker had usable activity. |
| Home discovery | **A good place to start** now samples up to 12 purchasable products from distinct vendors, blending activity based ranking with a stable daily rotating mix. **Shop by interest** routes root categories into the existing `/category/[slug]` hierarchy; the full cursor-paginated product feed stays on Discover. **Vendors to explore** remains vendor focused. | Gives product sampling, category navigation, and vendor browsing separate jobs while preserving the shared cart and wishlist actions. |
| Discover route | Added /discover as the server-rendered catalog with continuous cursor pagination, a vendor filter, personalized shelf, and navigation links. The old /product catalog URL redirects while preserving filters. | Gives every portal a direct path to the marketplace and one canonical catalog URL. |
| Discover API | GET /api/v1/discover is the sole product-discovery feed route. Removed the browser and server fallback to /products/discovery and removed that compatibility route from the API and Swagger. | Keeps the UI, API, and OpenAPI contract on the requested endpoint and makes a missing deployment visible instead of silently changing URLs. |
| Redis outage protection | Added a bounded per-instance throttle fallback and made account-lock reads fail closed. | Redis outages no longer turn every throttle check into an automatic allow; emergency limits still become per-instance and volatile until Redis recovers. |
| Cursor pagination | Product cursors now match the selected sort key, use product ID as a deterministic tie-break, reject malformed/mismatched cursors, and group lexicographic alternatives under OR. | The former predicate could combine cursor alternatives as AND and skip valid rows; cursors also used the wrong sort value for price order. |
| Product filters/cache | Public listing now applies vendorId, includes categoryPath and vendorId in cache keys, and rejects minPrice greater than maxPrice. | Prevents ignored filters, cache collisions between different result sets, and confusing invalid price ranges. |
| Public catalog eligibility | Public list/detail queries now exclude inactive or unapproved vendors, invalid category slugs return 404, and stock filters ignore inactive/deleted variants. Product cards use the vendor's real verification state. | Prevents unpublished inventory from appearing, avoids broad results for a mistyped category, and aligns stock/verification badges with stored state. |
| Catalog sorting | Removed the unsupported popular option and added oldest to match the API's supported sort values. | The former UI option silently returned newest products. |
| Discover state | Underlined category and store search fields, suggested selectable options, price, availability, and sort controls are grouped in the filter drawer; selected filters are reflected in the URL and restored on reload. Product text search remains on /search. | Makes store and category selection faster on small screens while keeping feeds shareable and continuous after hydration. |
| Analytics correctness and lifecycle | Vendor/admin revenue and order-derived metrics now require a paid payment state; analytics use Africa/Lagos day buckets, bounded 730-day ranges, raw-event retention, explicit cohort definitions, follower counts, and filled daily trend gaps. | Prevents unpaid orders from inflating paid metrics, aligns reporting dates across devices, and bounds raw event growth. Seven-day attribution still excludes anonymous-to-account identity stitching. |
| Analytics panel behavior | Admin/vendor summary cards refresh every 30 seconds and detail sections every 60 seconds while the tab is visible; duplicate body-level refresh/status copy was removed and the default calendar view is day. | Keeps dashboards current without a manual reload while limiting background requests. This is polling, not push delivery. |
| Category and portal UI | Category pages show up to 12 products in each direct-subcategory preview, use anchor-linked horizontal tabs with scroll-aware active state, and omit product totals from shopper-facing sections. Shared admin/vendor navigation uses a desktop sidebar and small-screen drawer. | Keeps category browsing focused on products and makes administrative workspaces usable on narrow viewports. |
| Identity and vendor relationships | Added Google ID-token sign-in for customers and vendors, anonymous recent-history claiming, vendor following, public follower totals, and follower-change analytics. | Adds sign-in and retention continuity while keeping recommendation history, analytics identity, current relationships, and historical follow events distinct. |
| Admin governance | Added platform settings, staff lifecycle/audit routes, and audience-specific customer/vendor announcement campaigns with resumable batched delivery. | Brings platform operations into the role-protected admin portal while preserving audit and per-recipient delivery idempotency. |
| Product-view tracking | Raw view events use stable IDs, Redis buffering, periodic batched RabbitMQ delivery, and duplicate-safe database fallback; recent recommendation history is still synchronously upserted. | Separates raw analytics throughput from recent-history reads and makes the remaining product-detail database write explicit. |
| Swagger | Public analytics and payment operations now declare bearer authentication per protected method. Swagger is blocked in production and only explicit staging configuration can override a production-like NODE_ENV. | OpenAPI auth metadata matches endpoint behavior; a staging hostname alone cannot enable the contract. |
| Outbox diagnostics | Broker-unavailable relay pauses now log once until recovery; reliability alerts include RabbitMQ availability and clarify that PENDING rows with zero attempts were never claimed. Vendor follow and unfollow routing keys are both bound to a consumer. Production requires RabbitMQ configuration. | Makes the common cause of old, never-attempted rows visible, avoids acknowledging unrouted unfollow events, and allows retry after broker recovery. It does not clear or force-publish live events. |
| Web and analytics duplication | Removed unused plural product/order API clients, API/auth-hook barrels, and unregistered analytics report/snapshot providers and DTO; hook imports use `@/hooks/*`. | Removes dead entry points and prevents stale endpoint shapes and path aliases from drifting apart. |
| Payment and refund settlement | Vendor credits require the PENDING-to-PROCESSING order transition. Full refund attempts now have stable Paystack references and durable lifecycle records; webhooks and a scheduled reconciler update them, and local reversal runs only after `refund.processed`. | Prevents duplicate provider refunds and prevents queued refunds from being reported as complete. Late captures are audited and withheld from vendor balances. |
| Notification reliability | Payment confirmation, refund completion, and order status notifications are persisted in the outbox with the business change. Notification consumers deduplicate by business key or event ID; outbox health logs delayed/stuck/exhausted rows. | A broker or process interruption no longer loses these in-app notifications after the business transaction commits. Delivery remains at least once. |
| Compose health | Web liveness checks now use the actual /health route in both Compose profiles. | The previous /api/health URL did not exist and would keep web containers unhealthy. |
| Compose environment | Production/staging profiles select app environment files by APP_ENV, and API receives APP_ENV explicitly. The example config now explains the staging selection. | A staging deployment previously loaded production credentials and configuration by default. |
| Documentation | Updated the root README while preserving its engineering manual, refreshed API and web implementation guides, and maintained architecture and audit references. | Keeps implementation behavior and operations current without dropping the engineering concepts, trade-offs, and edge-case rationale in the root guide. |

## Findings that still need work

### P1 — payment and event reliability

1. **Late payment captures still need an operator queue.** A verified capture may arrive after an order is cancelled or otherwise leaves PENDING. The code records the provider reference and order state and does not credit vendor balances; admins can now request a safe full refund through the lifecycle above. There is still no dedicated admin exception list, escalation owner, or alert tied to these audit rows. Do not silently convert a provider capture into FAILED.

2. **Outbox delivery is at least once.** [outbox.relay.ts](../../apps/api/src/infrastructure/outbox/outbox.relay.ts) can publish successfully and crash before marking the row delivered. Notifications now carry stable IDs/business dedupe keys and the notification table prevents duplicate inbox rows. Alerts include broker availability and distinguish never-claimed pending rows from publish attempts, but production must route these logs to alerting and monitor RabbitMQ queue/DLQ depth. A live pending backlog still requires verifying broker reachability and relay health; do not edit event status by hand.

3. **Paystack `needs-attention` refunds require an operator path.** The lifecycle records this state and exposes it in payment responses. Paystack may require customer bank details to resume the refund; no admin UI/API currently accepts those details and calls Paystack's retry endpoint. Keep this action in Paystack's dashboard/support process until a secure, audited bank-detail workflow is built.

4. **Email remains outside the transactional notification guarantee.** In-app notifications for payment confirmation, refund completion, and order status now enter the outbox in the same transaction. Confirmation and status emails still run through post-commit handlers and can be delayed/lost if the process stops before dispatch; RabbitMQ redelivery can also duplicate email. Add a durable email job with a business idempotency key and provider delivery tracking.

### P1 — abuse control during infrastructure failure

**Emergency throttle state is per-process when Redis is unavailable.** [redis-throttler.storage.ts](../../apps/api/src/infrastructure/cache/redis-throttler.storage.ts) now falls back to a bounded in-memory window and rate-limits its warning logs; [account-lock.service.ts](../../apps/api/src/modules/security/services/account-lock.service.ts) fails closed when it cannot read lock status. The local counters are capped and protect each API process, but they are volatile and an attacker spread across multiple replicas can receive a multiplied limit. Keep Redis highly available, alert on fallback activation, and consider a shared emergency limiter if the threat model requires a strict cross-replica bound.

### P2 — correctness, performance, and product quality

5. **Recommendation request cost needs a measured budget.** [recommendations.service.ts](../../apps/api/src/modules/recommendations/recommendations.service.ts) combines several behavior and catalog reads. Add query-count and latency telemetry by surface, inspect EXPLAIN plans for active-catalog and recent-activity queries, and batch or pre-aggregate only after measuring. Cache anonymous cold-start results briefly; keep personal ranking cache keys scoped by user/session and relevant activity version.

6. **Discover's store selector is bounded.** The page exposes a vendor/store filter and active-filter chip, but it loads at most the first 100 stores for options. If the marketplace grows beyond that, add server-side store search or a paginated vendor picker. Consider facets and counts only after query cost is measured.

7. **Search and general discovery use two pagination contracts.** /search still uses page-based catalog results while /discover uses cursor pagination. Document the distinction and preserve search ranking/store/category behavior. Consolidate only after comparing cursor stability, search result totals, and back/forward navigation.

8. **Offset pagination remains for some large administrative/search lists.** Offset cost grows with page depth and concurrent inserts can shift page boundaries. Keep it where numbered pages and totals matter; move long feeds to keyset cursors with a unique tie-breaker and matching indexes.

9. **Catalog list queries need index validation against actual traffic.** Validate PostgreSQL indexes for active/deleted product filters, category/vendor filters, createdAt and price sorts, and the exact cursor orderings. The Prisma schema and migration history must be checked together with migrate status in each deployment environment before release.

10. **A high-volume activity buffer needs backpressure visibility.** Raw product-view and marketplace-action rows now have bounded 730-day retention, and recommendation events have 180-day retention except follow history. Track Redis buffer length, flush failures, database fallback rate, oldest unflushed event age, query latency/rows scanned, and retention deletion counts. Alert before fallback writes overload the primary database. The recent-view upsert still writes to PostgreSQL synchronously per product view.

11. **Vendor discovery has no user-controlled diversity controls.** The featured store and Vendors to explore shelf do not let shoppers hide a store or tune category interests. Add explicit hide/not-interested controls only when the preference is stored, honored by ranking, and visible to the shopper.

### P2 — security and operations

12. **Keep staging secrets and data isolated.** Compose now selects .env.staging when APP_ENV=staging. Create and populate separate staging API/web files with separate database, JWT, OAuth, Paystack, Redis, and mail credentials before using the staging profile. Never copy production credentials into staging.

13. **The web/API JWT secret is a deployment contract.** The web server uses JWT_SECRET for server-side verification and the API uses it to sign tokens. Validate both values at startup or add a deployment check that confirms they match without logging either secret. Rotation needs a coordinated rollout plan.

14. **Reverse-proxy trust must match the deployed topology.** Security middleware uses forwarded headers for origin/client-IP decisions. Configure trusted proxy hops explicitly and reject client-supplied forwarding headers at the edge; do not use forwarded values from arbitrary direct clients.

**Refresh-token grace depends on a Redis write after the database rotation commits.** [refresh-session.service.ts](../../apps/api/src/modules/auth/sessions/refresh-session.service.ts) conditionally rotates the database record, then writes the old-ID-to-new-session grace result to Redis. If another request presents the old token in that gap, or Redis is unavailable, the cache miss enters token-reuse revocation. Web Locks reduce overlap in supported browsers but cannot close the database-to-cache gap or coordinate every client. Preserve strict reuse detection while evaluating a durable, replay-safe rotation result (for example, an encrypted short-lived result associated with the previous token ID); add concurrency and Redis-outage coverage before changing this security trade-off.

15. **TLS files are a hard Compose prerequisite.** Production Nginx mounts nginx/certs/origin.pem and origin-key.pem with create_host_path disabled. Add a documented certificate provisioning/renewal process and a preflight check so Compose fails with a clear message before rollout.

16. **Pin container images reproducibly.** Dockerfiles and Compose use mutable image tags. Pin approved patch versions or digests and automate security update review. Continue running production as non-root and keep build tools out of runtime images.

### P2 — maintainability and data lifecycle

17. **The web client still has repeated UI components and API/domain boundaries.** The `@/hook/*` alias and duplicate product/order API clients have been removed; imports now use `@/hooks/*`. Consolidate remaining repeated components only after behavior and styling differences are compared, then check with a web build.

18. **Prevent loose typing from returning.** The explicit `any` findings in the reviewed auth error handlers, cart response DTO, vendor store response, and user deactivation alias have been replaced with `unknown` or concrete types. The shared ESLint preset now reports `@typescript-eslint/no-explicit-any` as a warning; review remaining warnings and promote it to an error only after they are resolved. Prefer Prisma payloads and DTOs over broad casts at API boundaries.

19. **Best-effort failures are sometimes silent or console-only.** Admin login/logout audit and lockout failures now emit server logs, and duplicate empty-cart cleanup logs at debug level. Browser cart-state cleanup still has empty catches, while notification and server fetch paths write directly to console. Keep offline cleanup best effort, but use structured, redacted telemetry for failed critical work and remove user/session/payment data from logs.

20. **Account deletion and full data retention need a written policy.** Raw analytics and recommendation event windows are now documented, but users, orders, security audit logs, payment records, and backups have different legal and operational retention needs. Document which records are anonymized versus deleted, how account erasure affects recommendations, and how backup retention behaves.

21. **Domain boundaries are modular but share one database and process.** This is an appropriate current trade-off for the repository, but module imports can become circular and shared Prisma access can blur ownership. Keep module exports narrow, add dependency direction rules, and avoid extracting services until independent scale or team ownership justifies the operational cost.

### P2 — delivery pipeline

**The workflow named deploy publishes images but does not deploy them.** [deploy.yml](../../.github/workflows/deploy.yml) builds and pushes API and web images to GitHub Container Registry after CI succeeds. Manual production publishing is limited to `main`, but the workflow does not update a host, wait for readiness, verify live health, or roll back. Rename it to image-publish when external workflow callers are migrated, or add a protected deployment job for the chosen host with digest-based promotion, health checks, and a tested rollback path.

## Domain and folder inventory

This table covers API domain modules plus shared API areas. “Review focus” describes the code paths inspected or the control that should remain part of routine release review; it does not claim a domain-specific test or external security assessment was run.

| Folder | Review focus and follow-up |
| --- | --- |
| [admin](../../apps/api/src/modules/admin) | Admin-only routes, destructive actions, audit records, and scoping. Verify every sensitive endpoint has both role enforcement and a durable audit entry. |
| [analytics](../../apps/api/src/modules/analytics) | Event ingestion, recommendation attribution, buffering, and retention. Monitor ingestion lag and avoid keeping direct identifiers in aggregate metrics longer than required. |
| [auth](../../apps/api/src/modules/auth) | OTP, refresh rotation, role sessions, Google login, cookies, and server-side token use. Keep cookie flags, CSRF, revocation, and all portal login flows aligned. |
| [cart](../../apps/api/src/modules/cart) | Cart mutation and cache invalidation. Checkout remains the authoritative stock/price validation boundary; do not trust client totals. |
| [categories](../../apps/api/src/modules/categories) | Recursive taxonomy and product filtering. Bound traversal depth and define behavior for archived or missing category paths. |
| [discounts](../../apps/api/src/modules/discounts) | Coupon scope and totals. Recalculate eligibility, limits, and discount value inside the checkout transaction. |
| [health](../../apps/api/src/modules/health) | Liveness/readiness routes and Compose dependencies. Keep liveness independent from transient provider calls and readiness tied to required infrastructure only. |
| [notifications](../../apps/api/src/modules/notifications) | SSE, push, delivery preferences, replay, and idempotent outbox consumption. Treat email, push, SSE, and in-app inbox persistence as separate delivery outcomes. |
| [orders](../../apps/api/src/modules/orders) | Idempotent checkout, state transitions, stock restoration, and vendor/customer scope. Keep cancellation and payment/refund transitions transactional. |
| [payments](../../apps/api/src/modules/payments) | Paystack verification, webhook signatures, settlement, durable refund lifecycle, and wallet credit. Late-capture operator workflow and needs-attention refund handling remain open. |
| [products](../../apps/api/src/modules/products) | Public/vendor/admin catalog and variant inventory. Cursor logic and public vendor/category/stock filters were updated; monitor sort indexes and ensure UI price semantics match the product-level price field. |
| [recommendations](../../apps/api/src/modules/recommendations) | Behavior signals, cold start, diversity, attribution, and session handling. Measure business lift and query latency before increasing ranker complexity. |
| [referrals](../../apps/api/src/modules/referrals) | Referral eligibility, reward issuance, and abuse limits. Verify reward issuance has a database uniqueness/idempotency key across webhook and retry paths. |
| [reviews](../../apps/api/src/modules/reviews) | Review ownership, purchase eligibility, moderation, and aggregation. Ensure rating totals exclude removed or moderated records consistently. |
| [search](../../apps/api/src/modules/search) | Search ranking, cache keys, and PostgreSQL full-text/trigram behavior. Keep admin search authorization separate from public search. |
| [security](../../apps/api/src/modules/security) | CSRF, CORS, IP controls, CSP/security headers, and throttling. Validate trusted-proxy configuration and webhook raw-body coverage in each host environment. |
| [upload](../../apps/api/src/modules/upload) | Media provider validation and upload authorization. Add orphaned-asset cleanup and quota/size telemetry if abandoned uploads accumulate. |
| [users](../../apps/api/src/modules/users) | Profile changes, account state, and personal-data access. Keep self-service updates distinct from admin impersonation or moderation paths. |
| [vendors](../../apps/api/src/modules/vendors) | Onboarding, store profiles, products, and vendor authorization. Google registration checks a generated slug then creates it separately; a concurrent collision returns a conflict instead of retrying. Use a bounded retry for storeSlug uniqueness failures. Slugs are public identifiers, not secrets. |
| [wallets](../../apps/api/src/modules/wallets) | Decimal balances and conditional debits/credits. Reconcile wallet transactions against payment/order aggregates and enforce idempotency at the ledger row. |
| [wishlists](../../apps/api/src/modules/wishlists) | Customer ownership and product availability. Confirm removed/inactive products do not leak through stale cached lists. |
| [common](../../apps/api/src/common) | Shared validation, serialization, errors, pagination, and decorators. Keep changes backward-compatible because these utilities affect many routes. |
| [infrastructure](../../apps/api/src/infrastructure) | Database, Redis, RabbitMQ, outbox, logging, and configuration. Add operational dashboards for queue age, cache failures, and database pool pressure. |
| [web app](../../apps/web/src) | Customer, vendor, and admin routes; SSR/client data boundaries; session state; and responsive discovery. The catalog/filter state and empty recommendation behavior were updated. |
| [database package](../../packages/database) | Prisma model relationships, constraints, and migrations. Review schema and migration diffs together and run migration status against a disposable or staging database before release. |
| [config/types packages](../../packages/config) | Shared compiler/linter settings and cross-workspace types. Keep aliases and compiler versions intentional; avoid workspace-only imports from runtime packages. |
| [nginx and Compose](../../nginx) | TLS, proxy headers, service health, environment separation, and rollout. Staging file selection and web health URLs were corrected; certificate provisioning remains operational work. |
| [GitHub Actions](../../.github/workflows) | CI runs lockfile, lint, typecheck, API/web tests, and builds. The workflow called deploy publishes images only; host rollout and post-deploy verification remain outside the repository workflows. |

### Web route and component inventory

The web app route groups and component domains were inventoried separately because they do not map one-to-one to API modules.

| Area | Current folders and review focus |
| --- | --- |
| [Storefront routes](<../../apps/web/src/app/(storefront)>) | Account, cart, category, checkout, order, product, search, review, vendor, wallet, and wishlist flows; verify guest/auth transitions, URL state, and mobile behavior. The home route is `apps/web/src/app/page.tsx`. |
| [Authentication routes](<../../apps/web/src/app/(auth)>) | Customer, admin, and vendor login/registration plus password recovery and reactivation; keep callback URLs, cookie state, and role-specific redirects aligned. |
| [Admin routes](<../../apps/web/src/app/(admin)>) | Analytics, announcements, category, discount, order, product, staff, user, vendor, and platform settings; review authorization and destructive-action confirmation. |
| [Vendor routes](<../../apps/web/src/app/(vendor)>) | Analytics, discounts, notifications, orders, products, settings, and wallet; keep vendor ownership checks enforced by the API. |
| [Domain components](../../apps/web/src/components/domain) | Auth, cart, category, checkout, notification, order, product, review, vendor, and wishlist views. Shared UI lives under components/ui, form, feedback, layout, home, navbar, navigation, modal, search, theme, and health. |
| [Web support folders](../../apps/web/src) | Typed API clients and server adapters, hooks, libraries, providers, Zustand stores, and route middleware. Redundant API and authentication hook barrels were removed; the remaining `hooks` folder contains shared query and session hooks. |
| [Workspace packages](../../packages) | `database` owns Prisma schema/migrations, `config` shares tooling configuration, and `types` carries cross-workspace contracts. Review migration state and generated client compatibility together. |

## Product recommendations

Keep **Discover** as the navigation label and use **Good Finds Across the Market** with **Find your next favourite from vendors across NUTS.** as the catalog page heading and subtitle. **A good place to start** is the rotating cross-vendor product sampler; **Shop by interest** routes shoppers into the category hierarchy; **Vendors to explore** remains the separate vendor shelf. Use the eyebrow/title pairs **Recently viewed / Continue where you left off**, **Based on your activity / Picked for you**, and **Your followed stores / New from vendors you follow** consistently across home surfaces.

Recommended Discover behavior:

- Keep keyset pagination and a stable sort-plus-ID cursor. Do not use page numbers for an endless feed.
- Make filters addressable in the URL so links, reloads, and browser history preserve the shopper's view.
- Offer underlined store and category search with clickable suggestions in the Discover filter drawer, alongside price, availability, and sort filters. Keep product text search on /search. Add attribute facets when product data is normalized enough to filter consistently.
- Keep vendor identity visible on each product card. Consider an optional “one product per store” diversity mode, while leaving a standard relevance-ranked feed available.
- Add a “not interested” action only when it changes a stored preference and is reflected in future feeds.
- Measure impressions, product clicks, add-to-cart, checkout conversion, vendor diversity, and repeat exposure. Optimize purchases without hiding sponsored or paid placements; label paid placements clearly if introduced.
- Provide an explicit end-of-feed state and a recovery path for API errors. Infinite scrolling should not replace accessible navigation or keyboard-operable controls.
