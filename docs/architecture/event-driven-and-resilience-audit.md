# Audit: event-driven work, messaging reliability, code layout and development health

Audited 2026-11-27 against the code on `development`; section 4 comes from running the checks and the dev stack, not from reading code. Every row cites the file it comes from, so each can be checked. Nothing here has been changed yet; the work is scheduled in the [master roadmap](master-roadmap.md).

Related: [platform reliability plan](platform-reliability-plan.md), [how it works](how-it-works.md), [notifications and async delivery](../domains/notifications-and-async-delivery.md).

## 1. Work that should be event-driven

Already event-driven and fine: product views (Redis buffer, then the analytics queue), order status emails and notifications, the audit pipeline, inventory updates, vendor follow events.

| # | Today (evidence) | Problem | Fix | Value |
|---|---|---|---|---|
| E1 | The OTP email is sent inside the request (`auth/otp/otp.service.ts:194`, awaited; the email breaker allows 10 s) | Login and verification latency is tied to the email provider, and a provider failure fails the request | Store the OTP, publish `email.dispatch`, return at once; the queue retries | High |
| E2 | Welcome and password-reset-success emails are fire-and-forget in process (`auth/auth.service.ts:163, 475, 666`) | Lost if the process stops; no retry; no dead-letter | Outbox event (`user.registered` already exists), sent by the email consumer | High |
| E3 | The order confirmation email, including PDF invoice generation, is awaited in payment confirmation (`payments/payments.service.ts:2317`) | Slows the payment webhook and verify path; PDF work on the hot path | Consume `payment.success` (routing key exists): build the PDF and send the email in the worker | High |
| E4 | Referral rewards on delivery run in process with a log-only catch (`orders/orders.service.ts:1412`) | A failure or a crash loses a money reward silently | `order.delivered` event, a referral consumer with an idempotency key | High (money) |
| E5 | Recommendation events (impression, click, dismiss) are written to Postgres inside the request, then the recommendation cache is invalidated each time (`analytics/tracking/recommendation-events.service.ts:55, 110, 30`) | One DB write per interaction, and every click forces the expensive feed to be recomputed (the `for-you` p95 was about 3 s in Grafana) | Buffer, then the analytics queue, then batched inserts; invalidate with a debounce | High (latency) (done: step 5.7) |
| E6 | The feeds (`for-you`, `good-place-to-start`, `related`) are computed on read | p95 of 2 to 3 s measured in Grafana | Precompute candidate lists per user in the worker when views, clicks and purchases arrive; serve from Redis | High (largest latency win; bigger project) |
| E7 | Marketplace events and search tracking write to the database directly per request (`tracking.service.ts`, `search-tracking.service.ts`), while product views already use the buffered queue | Inconsistent, and avoidable writes on the request path | Move to the same buffer and queue path | Medium (done: step 5.7) |
| E8 | Vendor and admin analytics aggregate raw events when read (`vendors/analytics` took about 1.2 s on first load, cached 20 s) | Heavy reads on first view | Hourly or daily rollup tables kept up to date by a consumer or cron | Medium |
| E9 | Review lists are read and the rating breakdown is summed on each cache miss (`reviews/reviews.service.ts:132`) | Work grows with the number of reviews | Store rating count and average on the product, updated by a `review.changed` event | Medium (done: step 5.8) |
| E10 | Cache invalidation is done inline after writes in 8 services (wishlists, follows, discounts, categories, variants, admin vendors, token, product views) | Small cost per request, scattered logic | Tag-based invalidation, or a `cache.invalidate` consumer | Low |
| E11 | Image upload calls Cloudinary inside the request | Request time follows Cloudinary; the Cloudinary breaker is not applied (see R9) | Signed direct-to-Cloudinary upload and a webhook event | Low |
| E13 | The Paystack webhook is processed inside the request (`payments.controller.ts` awaits `handleWebhook`: settlement, stock, wallet and notifications all run before the 200 is returned) | Paystack waits for the whole job and retries on slow responses; a failure part-way is hard to replay | Webhook inbox: verify the signature, store the raw event once (unique event id), return 200, process through the queue | High (money) |
| E12 | Announcement audience fan-out (`admin/admin-announcements.service.ts`) | Not verified: I did not confirm whether delivery is chunked through the notifications queue | Verified: chunked, resumable, exclusive and idempotent; no change needed (step 5.9) | To verify |

## 2. Messaging and resilience patterns, checked against production practice

| # | Concept | Status | Evidence | What production practice expects |
|---|---|---|---|---|
| R1 | Outbox: written in the same transaction | Good | `outbox/outbox.service.ts` (`appendEvent` takes the transaction client) | Same |
| R2 | Outbox: safe with several relays | Good | `FOR UPDATE SKIP LOCKED`, batch of 50, stale claims recovered after 5 minutes (`outbox.relay.ts:65-92`) | Same |
| R3 | Outbox: retry with backoff | **Gap** | A failed row is retried at the next 10 s tick; five attempts are used up in about a minute; rows with five attempts are never retried again, only reported (`outbox.relay.ts:76, 138-146`) | `next_attempt_at` with exponential backoff and jitter, a terminal `DEAD` status, and a replay tool |
| R4 | Outbox: ordering | **Gap** | Events publish concurrently (`Promise.all`, `outbox.relay.ts:105`), so `order.created` and `order.status_changed` can arrive in the wrong order | Publish per aggregate in order, or make every consumer order-tolerant |
| R5 | Outbox: publisher confirms | Good | Confirm channel, callback resolves on broker confirm (`rabbitmq.service.ts:110, 349-370`) | Same |
| R6 | Consumers: retry with backoff | **Gap (most important)** | Any handler error sends the message to the dead-letter queue on its **first** failure (`nack(msg, false, false)`, `rabbitmq.service.ts:499`). The email consumer's comment says "after retries" but no retry exists. This is why your 3 emails went straight to the dead-letter queue after one failure | Retry queues with delays (for example 10 s, 1 min, 10 min) that dead-letter back to the work queue, an attempt counter in a header, and a dead-letter queue only after the last attempt or a permanent error |
| R7 | Consumers: transient versus permanent errors | **Gap** | One path for everything. A provider timeout and an invalid message are treated the same | Classify: retry transient errors; dead-letter permanent ones at once |
| R8 | Consumers: idempotency | Partial | Events carry an `eventId`; notifications deduplicate by business key; the email consumer does not (a redelivery after a crash sends the email twice) | Record processed event ids per consumer, or use a Redis `SET NX` per event id |
| R9 | Circuit breaker: coverage | **Gap** | Breakers exist for Paystack, email and Cloudinary, but `executeCloudinary` has no callers, so uploads are unprotected (`resiliency/circuit-breaker.service.ts:80`) | Wrap every outbound dependency |
| R10 | Circuit breaker: what counts as a failure | **Gap** | `handleAll` counts every error, including a 401 (a configuration fault) and other client errors (`circuit-breaker.service.ts`) | Count timeouts, network errors, 5xx and 429; not 4xx |
| R11 | Circuit breaker with retry | **Gap** | No retry policy sits in front of the breaker for safe, repeatable calls (for example Paystack verification reads) | Timeout, then retry with backoff and jitter, then breaker, for idempotent calls |
| R12 | Circuit breaker visibility | **Gap** | State is logged and available through `getStatus()`, but is not a metric or an alert | Gauge per breaker, alert when open |
| R13 | Open circuit and the queue | **Gap** | An open breaker throws, the consumer throws, and the message goes to the dead-letter queue. While the provider is down, every email in that window is dead-lettered | Delay and retry while the circuit is open |
| R14 | Dead-letter queue tooling | Good | List, replay (limit of 3 replays per message), purge, with the original request id (`dlq.util.ts`, `scripts/dlq.mjs`); alert on a non-empty queue | Same |
| R15 | Consumer limits | Partial | One prefetch of 10 for the channel; no handler timeout (`rabbitmq.service.ts:245`) | Per-queue prefetch and a handler timeout, so a hung handler cannot hold a slot forever |
| R16 | Database transaction retries | Good | Jittered exponential backoff, retry only on retryable errors (`transaction/transaction-runner.ts:157, 247`) | Same |
| R17 | Broker reconnect | Good | Exponential backoff up to two minutes (`rabbitmq.service.ts:71`) | Same |
| R19 | Order and payment domain events (`order.processing`, `order.shipped`, `order.delivered`, `order.cancelled`, `payment.confirmed`, `payment.failed`, `referral.reward.credited`) are **in-process events** (`@nestjs/event-emitter`), emitted after the commit with a log-only catch (`orders.service.ts:1422`) and handled by one listener inside the api process | **Gap (largest design finding)** | If the process stops between the commit and the emit, the event is lost. The events never reach RabbitMQ, so no other consumer can use them (inventory, analytics, referral, recommendations, email). Only the notification listener reacts | Publish domain events through the outbox **inside the same transaction**, fan them out on the topic exchange, one queue per consumer |
| R20 | Routing keys declared but never published | **Gap** | `order.created`, `order.confirmed`, `order.status_changed`, `payment.success` have zero publishers. `inventory.*` is bound to a queue with a consumer, but nothing publishes it. The cron jobs publish with a queue name as the routing key, which only works because the queue is also bound under its own name | Remove dead constants and bindings; one naming rule: `<aggregate>.<fact>` |
| R21 | Inventory consumer | **Bug** | It reads the stock, adds the adjustment in code and writes the result (`inventory.consumer.ts`): two concurrent adjustments overwrite each other | Use an atomic `increment`/`decrement` (or a version check) inside one transaction |
| R22 | Consumers registered while the broker connection is still being made are bound twice: `connect()` binds every registered consumer when it finishes (`rabbitmq.service.ts:254`), and `consume()` waits for the connection and binds again (`:455`). Seen live: analytics, emails and inventory each have 2 listeners from one process while audit, notifications and vendor-events have 1 | **Bug** | Results are not wrong (each message goes to one listener), but handler concurrency doubles and every reconnect adds more | Bind each handler exactly once; test the broker service's registration (phase 4, item 4.9) |
| R18 | Who runs the outbox relay | Unclear | The relay is registered in every process (`OutboxModule` in `AppModule`) and polls every 10 s in each; the docs say only the worker runs it. It is safe because of `SKIP LOCKED` | Decide one owner and document it, or keep the wake-on-commit design and say so |

## 3. File layout and naming

| # | Finding (evidence) | Standard practice | Size of change |
|---|---|---|---|
| L1 | Queue consumers live in four places: `infrastructure/messaging/rabbitmq` (analytics, inventory, email), `infrastructure/workflows`, `common/audit-log`, `modules/notifications/consumers` | Infrastructure holds the broker plumbing; each domain keeps its consumers in `modules/<domain>/consumers/` | Medium, mechanical |
| L2 | `common/audit-log` is a whole feature (service, consumer, interceptor, decorator), and an alias also maps it to `modules/security/audit/*` | One audit module with one home | Small to medium |
| L3 | Five path-alias families; only `@api/*` is used (243 files). `@common`, `@infra`, `@infrastructure` and `@modules` are used by no file. Legacy aliases hide old names: `creators` to vendors, `category` to categories, `checkout/*` to cart and orders, `product-variants` to products, `shared` to common, `referral` to referrals | One alias scheme; delete the rest | Small |
| L4 | Module layouts differ. Some use `controllers/`, `dto/`, `jobs/`, `consumers/`; `vendors` and `auth` keep services at the module root. `admin-*` files are spread across modules (`auth/admin-auth.service.ts`, `vendors/admin-vendors.service.ts`, `modules/admin`) | One rule: a domain module with a folder per kind of file, and controllers grouped by audience | Medium |
| L5 | Plural and singular folder names mix: `cart`, `upload`, `search`, `health` against `wishlists`, `reviews`, `referrals`, `wallets` | One convention | Small |
| L6 | Type folders overlap: `src/types`, `common/types`, `common/interfaces` | One place for shared types | Small |
| L7 | Very large files: `products.service.ts` 3,721 lines, `orders.service.ts` 2,978, `discount-code.service.ts` 2,377, `payments.service.ts` 2,350, `search.service.ts` 1,883 | Split by use case so each file has one reason to change | Large; best done together with the money-code work |
| L8 | Entry points (`main.ts`, `worker.ts`, `workflow-worker.ts`, `instrument.ts`, `load-env.ts`) sat beside `app.module.ts` (done: only `main.ts` and the app module are at the root now; the others are in `bootstrap/`) | A `bootstrap/` folder, or a documented convention | Small |
| L9 | `modules/admin` is three unrelated domains grouped by audience (announcements, platform configuration, staff accounts), while other modules group by domain; `modules/security` holds token and account-lock services that belong to authentication | Group by domain, then by audience inside the domain | Medium |
| L10 | Duplicate modules: `auth/auth-cookies.module.ts` and `auth/cookies/auth-cookie.module.ts`; `google-auth.service.ts`, `auth.selects.ts` and `admin-auth.service.ts` sit at the module root while other auth code is in folders | One module per concern, one folder per kind of file | Small |
| L11 | File-kind suffixes are inconsistent: `type` (5) and `types` (2); `response` (5) next to `dto` (133); 32 files carry no kind suffix at all; `selects`, `util`, `config`, `storage` appear once or twice each | A fixed set of kinds (see the naming rules below) | Small |
| L12 | Database naming is mixed: 281 camelCase columns against 46 snake_case ones, and 3 tables use both (`product_views`, `shipping_addresses`, `wallet_transactions`); table names `checkout_idempotency`, `discount_code_user_usage`, `order_status_history`, `stock_history` break the plural rule | One rule for new tables and columns; existing ones changed only in a separate, reviewed migration | Decision needed |
| L13 | 29 source files were never imported by name. After checking that no exported name of each was used anywhere, 26 were deleted (unused DTOs for orders, products, users and vendors, an unused body-size middleware, a Redis health service, and three decorators and helpers). Three were kept because they are imported through an alias or barrel | search of every import and every exported name | Done |

Risk note: these moves touch import paths in about 240 files. They are done mechanically, in small pull requests, with the architecture check and the full test suites as the safety net, and with no behaviour change in the same pull request.

## 4. Development health sweep (what running everything showed)

What passed: type-checks (api and web), lint (one warning, below), 80 API test suites with 571 tests, the web tests, the architecture check, the doc-link check, the launcher tests, `scripts/verify-deploy.sh` against the local stack, no server errors (5xx) on any of the 88 parameter-free GET endpoints (63 correctly answer 401), the dev containers all healthy, no errors in the web container, no stray `console.log` in the API, only 2 TODOs and no `@ts-ignore`.

| # | Finding | Evidence | Severity |
|---|---|---|---|
| H1 | Known vulnerabilities in production dependencies: 33 (2 critical, 15 high, 16 moderate). Critical: `next` 16.3.5 is inside the affected range (remote code execution in `next/og`, a draft-mode cache leak; fixed in a later 16.4 release), and `proxy-addr` (IP spoofing through the trusted-proxy check). High includes `multer` (denial of service on uploads), `body-parser`, `compression`, `nanoid`, `sharp`, `postcss`, `prisma` (through its config and dev tools) | `npm audit --omit=dev`; every one reports a fix available | High |
| H2 | The database and `schema.prisma` disagree in 55 places. The `ROLE` enum in the database still contains the old `CREATOR` value; two indexes the schema declares do not exist (`outbox_events_status_attempts_createdAt_idx`, `product_images_productId_position_idx`); old `creators_*` index names and a foreign key were never renamed; 21 search indexes created in migrations (trigram) are not declared in the schema, including duplicates under the old `creators_*` names. A `prisma migrate dev` would propose dropping the search indexes | `prisma migrate diff` against the dev database | High |
| H3 | The alert `QueueWithoutConsumers` (critical) fires permanently in development, because `q.nuts.workflows` has no consumer while Temporal is off. A critical alert that is always on is ignored when it matters | Prometheus `/api/v1/alerts` | Medium |
| H4 | First requests after a restart are slow (1.2 s to 1.6 s for `campaigns`, `discover` and `category-previews`, then 25 to 50 ms): caches start empty | web container log and timed calls | Medium |
| H5 | Several money and queue paths have no test at all: the referral service, the email and inventory consumers (6 of 7 consumers), 11 of 12 cron jobs | file search for sibling spec files | Medium |
| H6 | The Paystack webhook IP allowlist reads the first value of the client-supplied `x-forwarded-for` header, which an attacker controls (`security/middleware/paystack-ip.middleware.ts:38`). The signature check (HMAC, timing-safe) is the real protection, so this is defence in depth that does not defend. It also allows every IP when the key starts with `sk_test_` | code | Medium |
| H7 | No `unhandledRejection` or `uncaughtException` handler in the api, worker or jobs; the 35 fire-and-forget calls rely on each call's own catch | search of `src` | Medium |
| H8 | Unused direct dependencies (no import anywhere): `zod`, `@sentry/node`, `@temporalio/activity`, `@temporalio/common`; `multer` is only used implicitly. `BULLMQ_PREFIX` is configured and validated but BullMQ is not used | import search, `env.validation.ts:156` | Low |
| H9 | The root README quickstart is wrong: it says the storefront is on port 3000 (it is 5173) and describes the old `npm run dev`. The root `package.json` has about 60 scripts, many overlapping (`dev:single`, `dev:turbo`, `dev:backend`, `dev:docker`, `dev:parallel`, `dev:plain`, `dev:local*`) | README lines 1200-1204, `package.json` | Low |
| H10 | The database round trip from a container to Postgres on the host takes 3.5 to 10 ms (the Docker to WSL path), so queries that need several round trips are slower than on a native setup. The 500 to 1,150 ms slow-query warnings in the worker and jobs logs cluster at moments when other work was running on the machine (container starts, test runs); the plans themselves are fast | `SELECT 1` x30 from the api container; `EXPLAIN ANALYZE` of the relay query, 0.14 ms | Info |
| H11 | One lint warning: an unsafe `any` assignment (`common/request-context/request-context.ts:56`) | `npm run lint:api` | Low |
| H12 | Not resolved, needs you: the font mismatch (needs a screenshot or the page name); the Brevo IP block on your laptop (3 emails had to be replayed) | your reports | To do |
| H13 | `packages/types` is imported by no app and is stale (`AuthRole` is `'USER' \| 'CREATOR' \| 'ADMIN'`; the web app defines its own lowercase `AuthRole`) | search of `apps` for `@nuts/types`, `packages/types/src/auth/index.ts` | Low; resolved: the unused `packages/types` and `packages/config` were deleted |
| H14 | `GET /discover` is database-bound: 305 ms, of which 270 ms was 6 queries (measured with the new `Server-Timing` header). `auth/refresh` does not use bcrypt for current sessions (HMAC), so the earlier thread-pool suspicion is wrong | live request, `refresh-session.service.ts:957` | Info; the feed work in phase 5 targets it |
| H15 | The scheduled jobs use three different locking styles: `runWithCronLock` (keys `cron:lock:*`), hand-written Redis locks with renewal (keys `lock:cron:*`), and none at all (abandoned carts, vendor weekly summary, low stock rely only on a check-then-set deduplication key, which two overlapping runs can both pass) | reading the 12 cron files while writing their tests | Medium; unify on one helper that supports renewal |
| H16 | The abandoned-cart job ignores a failed publish: it flags the cart as reminded and remembers it for 72 hours, so the reminder is lost for good | `abandoned-cart.cron.ts`, pinned by a test marked failing | Medium |
| H17 | The weekly vendor summary reports revenue as unit price times quantity for every order that is not cancelled (pending and refunded included) and uses floating-point numbers for money | `vendor-summary.cron.ts` | Medium; confirm the intended definition against the analytics docs |
| H18 | Wishlist price and restock alerts scan every saved item every 15 minutes (batches of 300), work that grows with the wishlist table instead of with price changes | `wishlist-alerts.cron.ts` | Medium; becomes `product.price_changed` and `product.restocked` consumers (catalog, section 5) |
| H19 | The end-to-end suite that boots the whole application was never run in CI and had drifted (missing models in its simulated database, a renamed route, an assertion for an event the code does not publish). Regenerating the lockfile also moved `class-validator` where Nest cannot load it, so the API would not have started; only this suite catches that | the end-to-end suite (now `apps/api/src/app.e2e-spec.ts`), a crash-looping dev container | Fixed: suite repaired, class-validator placement fixed, a Backend End-to-End Tests job added to CI |
| H20 | Platform switches (maintenance mode, whether registrations are open) are stored only in the cache, with a 24-hour expiry (`platform.service.ts`). After 24 hours or a Redis flush they silently reset to the defaults (maintenance off, registrations on), and the value is also lost on a Redis outage | `PlatformService.getPlatformConfig` and `updatePlatformConfig` write only `cache.set(..., 86400)` | High; persist in the database (a settings row), keep the cache as a read-through copy |

### Test coverage baseline (2026-11-27, after phase 2)

766 tests in 102 suites. Overall: 45.6% of statements, 33.6% of branches, 34.5% of functions. CI enforces floors just below this (global 42/30/30/42) and higher floors on the areas phase 2 covered. The weakest areas are the money code, which is what phase 6 must bring up:

| Area | Statements | Branches | Note |
|---|---|---|---|
| `modules/products` | 25.9% | 11.7% | 1,072 statements; includes the 3,700-line service |
| `modules/users` | 21.6% | 1.3% | account deletion, profile |
| `modules/payments` | 30.3% | 22.1% | webhook, refunds, settlement |
| `modules/wallets` | 31.2% | 17.5% | vendor earnings, payouts |
| `modules/orders` | 40.4% | 22.9% | status changes, cancellation, stock |
| `modules/analytics` | 33.3% | 15.2% | |
| `modules/auth` | 52.4% | 39.1% | |
| `modules/discounts` | 54.4% | 40.7% | |
| `infrastructure/messaging/rabbitmq` | 62.9% | 67.0% | consumers covered; the broker service itself is not |
| `infrastructure/messaging/outbox`, `modules/referrals`, `common/audit-log`, `common/request-context` | 96% to 98% | 87% to 98% | covered in phase 2 and held by CI floors |

## 5. The complete event catalog (the production target)

**Rules the catalog follows**

1. A state change other parts of the system care about is a **domain event**, named in the past tense as `<aggregate>.<fact>` (`order.shipped`).
2. It is written to the **outbox in the same transaction** as the change, so it is never lost and never sent for a change that rolled back.
3. Every event has one envelope: `eventId`, `type`, `version`, `occurredAt`, `aggregate` (type and id), `actor`, `requestId`, `payload`. Consumers ignore fields they do not know, so events can grow without breaking them.
4. Events fan out on the `nuts.events` topic exchange. **Each consumer owns its own queue** (a consumer group), with retries, a dead-letter queue and idempotency by `eventId`.
5. Services never call email, push or notification code directly. They publish a fact; the notification and email consumers decide what to send (`email.dispatch` and `notification.dispatch` become internal commands issued by those consumers).
6. Time-based work (unpaid-order expiry, abandoned carts, alerts, retention) is a delayed event or a Temporal timer, with cron only for plain housekeeping.

**Status key:** *live* = already on RabbitMQ; *in-process* = emitted inside one process only (R19); *dead* = declared but never published; *new* = does not exist yet.

| Area | Event | Producer | Consumers | Status |
|---|---|---|---|---|
| Identity | `user.registered` | auth | email (welcome), referral (attach code), recommendations (start profile), analytics, audit | **live** (welcome email, queue `q.nuts.user-emails`; the other consumers come with step 5.6) |
| Identity | `user.otp_requested` | otp | email | **by decision stays synchronous**: the code must not be stored in the outbox, broker or dead-letter queue |
| Identity | `user.password_reset_requested` | auth | email (reset link) | new |
| Identity | `user.password_changed` | auth | email, security (revoke sessions), audit | **live** (confirmation email, queue `q.nuts.user-emails`; session revoke stays in the reset flow) |
| Identity | `user.login_from_new_device` | auth | email and push (security alert), audit | **live** (email and in-app alert, queue `q.nuts.user-emails`; push later) |
| Identity | `user.suspended`, `user.reactivated` | admin | sessions (revoke), notifications, audit | new |
| Identity | `user.deletion_requested`, `user.deleted` | users | cleanup (later a Temporal workflow), analytics (anonymise), email | new |
| Vendors | `vendor.registered`, `vendor.approved`, `vendor.rejected`, `vendor.verified`, `vendor.deactivated`, `vendor.reactivated` | vendors, admin | email, notifications, cache, audit | new |
| Vendors | `vendor.followed`, `vendor.unfollowed` | vendor follows | notifications, analytics, recommendations | live |
| Vendors | `vendor.weekly_summary_ready` | analytics | notifications, email | in a cron, direct publish |
| Catalog | `product.created`, `product.updated`, `product.published`, `product.unpublished`, `product.deleted` | products | cache invalidation, search, recommendations (candidates), wishlist alerts, analytics | new |
| Catalog | `product.price_changed` | products | wishlist price-drop alerts, cart repricing, analytics | new |
| Catalog | `product.low_stock_detected`, `product.out_of_stock`, `product.restocked` | inventory | vendor notification, wishlist back-in-stock alerts, search availability | dead (`inventory.*`) |
| Catalog | `category.changed` | categories | cache invalidation, search | new |
| Catalog | `review.created`, `review.updated`, `review.deleted` | reviews | rating aggregate, vendor notification, recommendations, moderation | `review.created`, `review.deleted` **live** (5.8: rating aggregate, queue `q.nuts.review-aggregates`); `review.updated` is bound but there is no edit endpoint yet; the other consumers are not built |
| Catalog | `image.uploaded`, `image.processed` | upload (Cloudinary webhook) | product, cache | new |
| Cart | `cart.abandoned` | scheduler or timer | notifications, email | cron with direct publish |
| Cart | `cart.checked_out` | cart | analytics, recommendations | dead |
| Orders | `order.placed` | orders | inventory (reserve), notifications (customer and vendor), analytics, recommendations, audit, expiry timer | dead (`order.created`) |
| Orders | `order.paid` | orders (from payment) | email (confirmation with PDF), notifications, wallet (pending earnings), analytics | dead (`order.confirmed`) |
| Orders | `order.processing`, `order.shipped`, `order.delivered`, `order.cancelled` | orders | email, notifications, inventory (release on cancel), referral (on delivered), wallet (release earnings on delivered), analytics, recommendations | **live** (5.2: published in the transaction, queue `q.nuts.order-events`) |
| Orders | `order.expired` | timer | inventory (release), notifications | cron |
| Payments | `payment.initiated` | payments | analytics, audit | new |
| Payments | `payment.confirmed`, `payment.failed` | payments | orders, email, notifications, wallet, audit | **live** (5.2: published in the transaction, queue `q.nuts.order-events`) |
| Payments | `payment.refund_requested`, `payment.refunded`, `payment.refund_failed` | payments | orders, inventory, wallet, email, notifications, audit | partly outbox, no domain event |
| Payments | `payment.reconciliation_needed` | payments | ops alert queue, audit | recorded in the database only |
| Payments | `payment.webhook_received` | webhook endpoint (inbox) | payments (process once, idempotent) | **live** (5.3: webhook inbox, queue `q.nuts.payment-webhooks`) |
| Wallets | `wallet.credited`, `wallet.debited`, `vendor.earnings_available` | wallets | notifications, email, audit | new |
| Wallets | `payout.requested`, `payout.processed`, `payout.failed` | wallets | notifications, email, audit | new (when payouts exist) |
| Promotions | `discount.created`, `discount.activated`, `discount.expired`, `discount.used`, `voucher.claimed` | discounts | cache (campaigns), notifications, analytics | new |
| Referrals | `referral.code_applied`, `referral.reward_credited` | referrals | wallet, notifications, audit | `referral.reward_credited` **live** (5.5: published in the credit transaction, consumed by `q.nuts.order-events`); `referral.code_applied` not published: no consumer needs it yet |
| Notifications | `notification.requested` | notification consumer (internal command) | in-app, push, email channels | live (as `notification.dispatch`) |
| Notifications | `push.delivery_failed` | push channel | cleanup (drop dead subscriptions) | new |
| Shopper activity | `shopper.product_viewed`, `shopper.searched`, `shopper.store_viewed` | web through api | analytics, recommendations | **live** (queue `q.nuts.analytics`) |
| Shopper activity | `shopper.cart_item_added`, `shopper.cart_item_removed`, `shopper.wishlist_item_added`, `shopper.wishlist_item_removed` | cart, wishlists | analytics, recommendations | **live** (step 5.7) |
| Shopper activity | `shopper.shelf_item_seen`, `shopper.shelf_item_clicked`, `shopper.shelf_item_dismissed`, `shopper.category_viewed` | api | analytics, feed rebuild | **live** (step 5.7) |
| Platform | `announcement.published`, `announcement.scheduled` | admin | fan-out consumer (chunked), notifications, email | to verify |
| Platform | `platform.config_changed` | admin | cache invalidation in every process | new |
| Platform | `audit.recorded` | any | audit writer | live |
| Security | `security.bot_blocked`, `security.rate_limited`, `security.suspicious_activity` | middleware | security alerts, audit | new |
| Operations | `dlq.message_dead_lettered`, `outbox.event_dead` | broker and relay | alerting, ops dashboard | new |

**Totals:** about 70 events across 13 areas. 4 are live on RabbitMQ in a usable form (`vendor.followed`, `vendor.unfollowed`, `shopper.product_viewed`, `audit.recorded`) plus the internal commands `notification.dispatch`, `email.dispatch` (order-status path only) and `workflow.start`. 8 exist only in process, 9 are declared and never published, and the rest are new.

**Build order inside the work:** (1) the backbone: envelope, naming rule, publishing through the transaction runner, queue-per-consumer wiring, removal of dead constants; (2) move the 8 in-process events onto it (R19) with their existing consumers; (3) the money and security events (payments, webhook inbox, referral, wallet, user security); (4) vendor, catalog, cart and review events; (5) tracking buffers and the feeds; (6) platform, promotions, operations events.

## 6. The code layout standard (what batch 7 delivers)

This is the target. It follows the common NestJS and domain-module convention: **group by business domain first, by kind of file second, and keep technical plumbing separate from business code.**

### 6.1 Naming rules

| Thing | Rule | Example |
|---|---|---|
| Files and folders | `kebab-case`; file name is `<name>.<kind>.ts` | `order-status-history.service.ts` |
| Allowed kinds | `module`, `controller`, `service`, `consumer`, `job`, `listener`, `guard`, `interceptor`, `pipe`, `filter`, `middleware`, `decorator`, `dto`, `enum`, `constants`, `types`, `mapper`, `util`, plus the technical roles already in use: `config`, `strategy`, `provider`, `validator`, `validation`, `exception`, `storage`, `throttler`, `relay`, `health`, `workflow`, `activities`, `templates`, `extractor`, `setup`. Entry points (`main.ts`, `worker.ts`, `workflow-worker.ts`, `instrument.ts`, `load-env.ts`) and `index.ts` barrels have no kind. Test helpers end in `-spec.ts` (built out, not run). | |
| One class per file | The file name is the class name in kebab-case | `CreateOrderDto` in `create-order.dto.ts` |
| Classes | `PascalCase` with a suffix that matches the kind | `OrdersService`, `OrderShippedConsumer` |
| Response shapes | Always `dto` (no `response` kind) | `order-response.dto.ts` |
| Type files | `types` only (never `type`) | `jwt-payload.types.ts` |
| Scheduled work | `job` (replaces `cron`; the schedule is inside); class name ends in `Job` | `unpaid-orders.job.ts`, `UnpaidOrdersJob` |
| Tests | Next to the file: `<name>.spec.ts`; end-to-end tests in `test/` | |
| Module folders | Plural for a business entity (`orders`, `products`, `users`, `vendors`, `wallets`, `reviews`, `wishlists`, `categories`, `discounts`, `referrals`); singular for a capability (`auth`, `cart`, `search`, `upload`, `health`, `security`, `analytics`, `notifications`, `payments`, `audit`) | |
| Audience prefix | `admin-`, `vendor-` or none (customer) on controllers, DTOs and services that serve one audience | `vendor-orders.controller.ts` |
| Domain events | `<aggregate>.<fact>`, lowercase, past tense | `order.shipped` |
| Queues | `q.nuts.<consumer-group>`; retries `q.nuts.<group>.retry.<delay>`; dead letters `q.nuts.dlq` | `q.nuts.emails.retry.1m` |
| URLs | Plural nouns, kebab-case, one canonical route (legacy aliases removed on a date) | `/vendors/:id/follow` |
| Environment variables | `UPPER_SNAKE`, prefixed by component, per-program overrides `{PROGRAM}_{NAME}` | `WORKER_HEALTH_PORT` |
| Database (new tables and columns) | `snake_case`, tables plural, columns mapped with `@map` | `order_status_history` |
| `package.json` scripts | `<area>:<action>[:<variant>]`; one way to do each thing | `dev:logs:api` |

### 6.2 Target folders

```
apps/api/src/
  main.ts  app.module.ts                     the API's entry point and root module; app.e2e-spec.ts and jest-e2e.json (the end-to-end suite) sit beside them
  e2e-env.setup.ts                           settings the end-to-end suite needs on a machine with no environment file
  bootstrap/                                 start-up concerns that compose the app and may use any layer: the worker and workflow-worker entry points (built to `dist/bootstrap/`, which PM2 and Docker run), instrument.ts, load-env.ts, swagger setup, process-error handlers, cache warm-up
  config/                                    env validation, process roles, ports
  common/                                    generic, knows nothing about the business
    decorators/ filters/ guards/ interceptors/ middleware/ pipes/ errors/ utils/ constants/ types/ dto/
  infrastructure/                            technical adapters only (no business rules)
    database/        prisma, transaction runner
    cache/           redis, cache service
    messaging/       rabbitmq broker, outbox, retry and dead-letter handling, event envelope, event catalog and payload types
    mail/            providers
    storage/         cloudinary
    observability/   metrics, health, request context
    resilience/      circuit breakers, retry policies
    workflows/       temporal client and worker, workflow-start consumer
  modules/                                   business domains
    <domain>/
      <domain>.module.ts
      controllers/   one file per audience: orders.controller.ts, vendor-orders.controller.ts, admin-orders.controller.ts
      (every file goes in the folder for its kind, wherever it was before: a service is always in services/, a DTO always in dto/)
      services/      use-case services (split large files here)
      dto/
      consumers/     queue consumers that belong to this domain
      events/        payload types of the events this domain publishes
      jobs/          scheduled jobs
      listeners/     only if a module reacts to another module's in-process event
      guards/ constants/ types/ mappers/   only when needed
      tests/         the module's unit tests, all directly in this one folder with no subfolders (tests/x.service.spec.ts); the architecture check fails a module spec anywhere else
```

Domains: `auth` (customer, vendor and admin authentication, sessions, OTP, cookies, tokens), `users`, `vendors`, `products` (including stock), `categories`, `cart`, `orders`, `payments`, `wallets`, `discounts`, `referrals`, `reviews`, `wishlists`, `search`, `recommendations`, `analytics`, `notifications` (in-app, push and the email channel), `audit`, `security` (guards, throttling, middleware only), `announcements`, `platform` (configuration), `staff`, `health`, `upload`.

### 6.3 What moves

| From | To |
|---|---|
| `infrastructure/messaging/rabbitmq/analytics.consumer.ts` | `modules/tracking/consumers/tracking.consumer.ts` |
| `infrastructure/messaging/rabbitmq/inventory.consumer.ts` | `modules/products/consumers/` |
| `infrastructure/messaging/rabbitmq/email.consumer.ts` | `modules/notifications/consumers/` |
| `common/audit-log/*` and `modules/security/audit/*` | `modules/audit/` (service, consumer, interceptor, decorator in their folders) |
| `infrastructure/messaging/rabbitmq`, `infrastructure/messaging/outbox` | `infrastructure/messaging/` |
| `infrastructure/database`, `infrastructure/database` | `infrastructure/database/` |
| `infrastructure/cache`, `infrastructure/cache` | `infrastructure/cache/` |
| `infrastructure/storage` | `infrastructure/storage/` |
| `infrastructure/observability/metrics`, `infrastructure/observability/health`, `common/request-context` | `infrastructure/observability/` |
| `infrastructure/resilience` | `infrastructure/resilience/` |
| `infrastructure/workflows` | `infrastructure/workflows/` |
| `config` | `config/` |
| `common/events` (event names and payloads) | `infrastructure/messaging/events/` (the `audit.event` message contract, `audit-event.util.ts`, lives there too because the transaction runner and the dead-letter tool use it) |
| `modules/vendors/vendor-auth.service.ts`, `modules/auth/admin-auth.service.ts` | `modules/auth/services/` (`customer-auth`, `vendor-auth`, `admin-auth`) |
| `modules/vendors/admin-vendors.service.ts` | `modules/vendors/services/` |
| `modules/security/services/token.service.ts`, `account-lock.service.ts` | stay in `modules/security` (decision in step 5: they are security primitives that auth builds on; moving them would make `security` depend on `auth`) |
| `modules/admin/*` | `modules/announcements`, `modules/platform`, `modules/staff` |
| `auth-cookies.module.ts` and `cookies/auth-cookie.module.ts` | one cookie module under `modules/auth/cookies/` |
| `src/types`, `common/interfaces` | `common/types` |
| `**/*.cron.ts` | `**/jobs/*.job.ts` |
| the five very large services | split by use case inside `services/`, each file under about 600 lines |

### 6.4 How it is enforced

The architecture check (`scripts/check-architecture.mjs`) gains rules, so the layout cannot drift back:

1. `common` imports nothing from `infrastructure` or `modules`; `infrastructure` imports nothing from `modules`.
2. A module reaches another module only through providers its module exports, never by deep path.
3. File names must match `<kebab-name>.<allowed-kind>.ts`; a class name must match its file name.
4. Consumers live only in `modules/*/consumers` or `infrastructure/workflows`.
5. Only the `@api/*` alias exists; the unused alias families and the legacy ones are deleted.

### 6.5 How the move is done safely

- **Mechanical only.** A move changes paths and imports, never behaviour; no logic edits in the same pull request.
- **Small steps in this order:** (1) aliases and dead code; (2) `infrastructure` folder renames; (3) consumers into their domains; (4) audit module; (5) auth and the admin split; (6) naming kinds (`cron` to `job`, `type` to `types`, `response` to `dto`); (7) the architecture rules; (8) large files, done together with the money-code work.
- **After every step:** type-check, lint, all 571 tests, the architecture check, a build of the Docker image, and a start of the dev stack. Import paths in about 240 files change, so each step is one reviewable pull request.
- **Database naming (L12)** is not part of this move; it needs its own migration plan and a decision from you.
