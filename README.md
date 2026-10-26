# NUTS Platform — Enterprise Multi-Vendor E-Commerce Platform

[![CI — Monorepo Quality Gates](https://github.com/UGOCHUKWU1124/nuts-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/UGOCHUKWU1124/nuts-platform/actions/workflows/ci.yml)
[![TypeScript 5.8](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![NestJS 11](https://img.shields.io/badge/NestJS-11.x-red.svg)](https://nestjs.com/)
[![Next.js 16](https://img.shields.io/badge/Next.js-16.x-black.svg)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19.x-61dafb.svg)](https://react.dev/)
[![Prisma 7](https://img.shields.io/badge/Prisma-7.x-2D3748.svg)](https://www.prisma.io/)
[![PostgreSQL 16](https://img.shields.io/badge/PostgreSQL-16-336791.svg)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-Alpine-DC382D.svg)](https://redis.io/)
[![RabbitMQ](https://img.shields.io/badge/RabbitMQ-AMQP-FF6600.svg)](https://www.rabbitmq.com/)
[![Docker](https://img.shields.io/badge/Docker-Multi--Stage-2496ED.svg)](https://www.docker.com/)

> **NUTS Platform** is a multi-vendor e-commerce marketplace built with **NestJS 11**, **Next.js 16**, **TypeScript 5.8**, **PostgreSQL 16**, **Prisma 7**, **Redis Alpine**, and **RabbitMQ**, strictly adhering to Domain-Driven Design (DDD) principles. It features real-time Server-Sent Events (SSE), atomic flash-sale inventory reservation, two-phase vendor marketplace escrow, recursive category taxonomy, and zero-trust capability-based role isolation.

---

## Live Deployments & Quick Links

- 🌐 **Live Storefront (Web App):** [https://nuts-platform.onrender.com/](https://nuts-platform.onrender.com/)
- 📖 **Interactive Swagger API Documentation:** [https://nuts-platform.onrender.com/api/docs](https://nuts-platform.onrender.com/api/docs)
- 📦 **Monorepo GitHub Repository:** [https://github.com/UGOCHUKWU1124/nuts-platform](https://github.com/UGOCHUKWU1124/nuts-platform)

---

## Contents

1. [High-Level Architecture](#1-high-level-architecture)
2. [Monorepo Structure](#2-monorepo-structure)
3. [Domain-by-Domain Architecture & Problems Solved](#3-domain-by-domain-architecture--problems-solved)
   - [Domain 1: Identity, Authentication & Security Governance](#domain-1-identity-authentication--security-governance)
   - [Domain 2: Catalog Taxonomy & Hierarchical Category DAG](#domain-2-catalog-taxonomy--hierarchical-category-dag)
   - [Domain 3: Shopping Cart & Checkout Orchestration](#domain-3-shopping-cart--checkout-orchestration)
   - [Domain 4: Billing, Payments & Settlement Engine](#domain-4-billing-payments--settlement-engine)
   - [Domain 5: Real-Time Notifications, Outbox & Messaging](#domain-5-real-time-notifications-outbox--messaging)
   - [Domain 6: Search, Autocomplete & Multi-Tier Relevance](#domain-6-search-autocomplete--multi-tier-relevance)
   - [Domain 7: Infrastructure, Data Governance & Connection Pooling](#domain-7-infrastructure-data-governance--connection-pooling)
4. [The NUTS Engineering & Distributed Systems Field Manual](#4-the-nuts-engineering--distributed-systems-field-manual)
   - [Part I: Networking, Protocols & Web API Architecture](#part-i-networking-protocols--web-api-architecture)
   - [Part II: Database Systems, Query Optimization & Concurrency](#part-ii-database-systems-query-optimization--concurrency)
   - [Part III: Distributed Caching & Redis Architecture](#part-iii-distributed-caching--redis-architecture)
   - [Part IV: Asynchronous Messaging & Event Reliability (RabbitMQ)](#part-iv-asynchronous-messaging--event-reliability-rabbitmq)
   - [Part V: Application Security & Cyber Defense Shield](#part-v-application-security--cyber-defense-shield)
   - [Part VI: Software Quality, Testing & CI/CD Gates](#part-vi-software-quality-testing--cicd-gates)
5. [Local Development & Quickstart](#5-local-development--quickstart)
6. [Environment Variables Reference](#6-environment-variables-reference)

---

## 1. High-Level Architecture

```mermaid
graph TD
    Client[Next.js 16 Web Client / Edge Middleware] -->|HTTPS / WSS| Nginx[Nginx Reverse Proxy / Load Balancer]
    Nginx -->|Rewrites / API Calls| API[NestJS 11 Modular Monolith API]
    API -->|Session Mode / Migrations: 5432| Postgres[(PostgreSQL 16 DB)]
    API -->|Transaction Mode / Runtime: 6543| PgBouncer[PgBouncer Connection Pooler]
    PgBouncer --> Postgres
    API -->|Sessions / Token Grace / Mutex Locks| Redis[(Redis Alpine)]
    API -->|Transactional Outbox / Async Queues| RabbitMQ[(RabbitMQ Message Broker)]
    API -->|Real-Time Server-Sent Events| Client
    RabbitMQ -->|Background Email Workers| Brevo[Brevo Transactional API]
```

### The 3 Autonomous Security Boundaries
1. **Customer Storefront (`user`):** Shopping catalog, cart, direct checkout, customer orders, customer wallet, and product reviews.
2. **Vendor Merchant Backoffice (`vendor`):** Multi-step merchant registration, store management, product variant builder, inventory controls, order fulfillment, and merchant escrow wallet.
3. **Platform Administration (`admin`):** Marketplace governance, vendor review & approvals, category taxonomy, global user management, and shared Redis cache operations.

> **Zero-Trust Role Boundary:** A valid token for a `vendor` or `admin` receives an immediate `403 Forbidden` on customer shopping endpoints (`/cart`, `/checkout`, `/orders/my-orders`). Role capabilities are strictly verified on both the backend guards and database queries.

---

## 2. Monorepo Structure

```bash
nuts-platform/
├── apps/
│   ├── api/             # NestJS 11 REST API, Swagger docs, background workers, crons
│   └── web/             # Next.js 16 App Router storefront, vendor portal, admin backoffice
├── packages/
│   ├── config/          # Shared ESLint, Prettier, and TypeScript configurations
│   ├── database/        # Prisma 7 schema, migrations, and typed Prisma Client
│   └── types/           # Shared domain DTOs, API envelopes, and user capabilities
├── nginx/               # Reverse proxy templates, SSL certificates, rate limits
├── docker-compose.yml   # Multi-profile orchestration (dev, staging, prod)
└── package.json         # Turbopack and npm workspaces orchestration
```

---

## 3. Domain-by-Domain Architecture & Problems Solved

### Domain 1: Identity, Authentication & Security Governance

#### 1. Context & Mental Model
Manages identities across Customers, Vendors, and Admins. Issues short-lived access credentials, rotating session refresh tokens, verifies emails via numeric OTPs, and enforces zero-trust role isolation.

#### 2. Problems Solved & Engineering Defenses
- **Multi-Tab Session Destruction & False Token Theft:**
  - *The Failure Mode:* When a user has multiple browser tabs open and access tokens expire simultaneously, all tabs trigger concurrent refresh requests. In a naive RFC 6819 rotation scheme, Tab 1 rotates the refresh token. When Tabs 2–5 send the previous token milliseconds later, the server flags it as "Token Reuse / Theft Detected" and terminates the user's session cluster-wide across all devices.
  - *How NUTS Solved It:* Implemented a dual defense: (1) On the client, tabs coordinate via the **Web Locks API** (`navigator.locks.request('auth_refresh_lock')`) so only one tab makes the network call while other tabs wait and consume the rotated token from shared memory. (2) On the backend, when a refresh token rotates, its old ID is stored in Redis under `auth:grace:{refreshId}` with a **15-second grace window**. Any in-flight concurrent requests arriving within this window receive the new token instead of triggering account revocation.
- **Stateless Token Invalidation Delay:**
  - *The Failure Mode:* Standard stateless JWTs remain valid until their expiration timestamp even after a user changes their password, logs out, or is suspended by an administrator.
  - *How NUTS Solved It:* Engineered an active **Security Stamp** mechanism cached in Redis (`auth:stamp:{role}:{userId}`). On every authenticated request, the `JwtAuthGuard` performs a sub-millisecond Redis check to compare the token's version against the stamp. On password reset, logout, or admin suspension, the stamp increments immediately, invalidating active access tokens across the entire cluster within milliseconds without database queries.
- **User Enumeration via Latency Timing Attacks:**
  - *The Failure Mode:* Attackers discovering registered emails by timing the difference between existing accounts (slow bcrypt compare ~80ms) and non-existent accounts (fast 404 reject ~2ms).
  - *How NUTS Solved It:* Implemented constant-time dummy password hashing. When an email does not exist in the database, `AuthService` executes `bcrypt.compare(dto.password, UNKNOWN_ACCOUNT_PASSWORD_HASH)` against a pre-computed dummy hash. Every login attempt takes the exact same duration regardless of account existence, preventing timing-based enumeration.

#### 3. Backend Mechanism (With Exact Timings & TTLs)
- **Access Token TTL (`JWT_ACCESS_EXPIRES_IN`):** Exactly **15 minutes**. Stateless Bearer token carrying `sub`, `email`, `role`, `tokenVersion`, and `sessionId`.
- **Refresh Token TTL (`JWT_REFRESH_EXPIRES_IN`):** Exactly **7 days**. Stored as a cryptographic hash in PostgreSQL and bound to a unique device `sessionId`.
- **The 15-Second Grace Window:** When a refresh token is rotated, its previous ID is cached in Redis (`auth:grace:{refreshId}`) for **15 seconds**. Any concurrent request arriving within this 15-second window receives the newly minted token instead of triggering account revocation.
- **Security Stamp Invalidation (`auth:stamp:{role}:{userId}`):** Cached in Redis for **24 hours**. On password reset or administrative suspension, the stamp increments; active access tokens are immediately rejected on their next request.
- **OTP Lifecycle (`OTP_TTL_MIN`):** Exactly **10 minutes**. Numeric 6-digit code stored in Redis. Cooldown between resends: **60 seconds** (`OTP_RESEND_COOLDOWN_SEC`). Max attempts: **5 attempts** (`OTP_MAX_ATTEMPTS`) before auto-invalidation.

#### 4. Client-Side Architecture & UX Flow
- **Web Locks API (`navigator.locks.request('auth_refresh_lock')`):** When multiple tabs experience a token expiry, only **one single tab** executes the refresh network request. Other tabs await the lock release and read the rotated token from shared memory.
- **Zustand Auth Store (`useAuthStore`):** In-memory token storage. Access tokens are kept in JavaScript memory closures—never written to `localStorage` or `sessionStorage` (XSS immunity).
- **Public-Only Auth Layout (`PublicOnlyLayout`):** Client-side boundary that redirects already-authenticated users away from login/register screens directly to their role-specific dashboard (`/` for customer, `/vendor/dashboard` for vendor, `/admin/dashboard` for admin).

#### 5. Acronym & Concept Glossary
- **RFC 6819:** Official IETF security best-practice standard for token rotation and replay prevention.
- **CAS (Compare-and-Swap):** An atomic database instruction updating a row only if its current version matches the expected value, preventing race conditions.
- **Timing Attack:** An attack where response time leaks data. We eliminate this by running `bcrypt.compare` against `UNKNOWN_ACCOUNT_PASSWORD_HASH` on non-existent users so every response takes the exact same ~80ms.

#### 6. Edge Cases & Failure Scenarios Handled
- Multi-tab concurrent refresh.
- Expired or manipulated OTP codes.
- Rapid successive login failures triggering exponential backoff delays.
- Account self-deactivation with a **60-day recovery grace period** (`ACCOUNT_DELETION_GRACE_DAYS`).

#### 7. Jot-Down Notes
- *Stateless JWTs are made statefully revocable by verifying a Redis security stamp on every request.*
- *Prevent multi-tab token theft false positives using client-side Web Locks and a 15-second backend grace window.*
- *Perform constant-time password comparisons against dummy hashes for non-existent users to eliminate timing attacks.*

---

### Domain 2: Catalog Taxonomy & Hierarchical Category DAG

#### 1. Context & Mental Model
Manages product categorization in an arbitrary-depth nested category tree (e.g. `Apparel > Men > Outerwear > Jackets`) and handles dynamic URL paths (e.g. `/category/apparel/men/outerwear`).

#### 2. Problems Solved & Engineering Defenses
- **Infinite Recursion & Stack Overflow Crashes:**
  - *The Failure Mode:* An administrator moving a category (e.g., `Electronics`) inside one of its own descendants (e.g., `Gaming Laptops`) creates a circular graph loop (`Gaming Laptops -> Electronics -> Computers -> Gaming Laptops`). Any recursive tree builder or breadcrumb generator then loops infinitely, pegging CPU at 100% and crashing the Node.js event loop with `RangeError: Maximum call stack size exceeded`.
  - *How NUTS Solved It:* Engineered a Directed Acyclic Graph (DAG) cycle-detection algorithm in [`CategoriesService.validateParent`](file:///c:/MY%20PROJECT/NUTS-P/apps/api/src/modules/catalog/categories/categories.service.ts). Before committing parent updates: (1) it rejects self-parenting (`parentId === id`); (2) it recursively queries all descendants using `getDescendantIds(currentCategoryId)`; (3) if `descendantIds.includes(newParentId)`, it aborts with `400 Bad Request: Circular hierarchy detected` before any database write occurs.
- **Sibling Name Ambiguity & Route Collisions:**
  - *The Failure Mode:* Two distinct categories created with the same name under the same parent generate identical URL path slugs, leading to ambiguous routing and customer confusion.
  - *How NUTS Solved It:* Enforced a database composite unique index `(parentId, slug)` in PostgreSQL coupled with a case-insensitive name pre-check in `CategoriesService` to reject sibling duplicates before hitting constraint violations.
- **Stale Path Slugs & Broken Deep Links:**
  - *The Failure Mode:* Updating a parent category's slug without updating its children causes broken deep links, cached navigation mismatches, and SEO 404 penalties.
  - *How NUTS Solved It:* Integrated transactional descendant path synchronization combined with atomic Redis cache purging (`CATEGORY_TREE` and `CATEGORY_BY_SLUG`), triggering immediate Next.js ISR/cache revalidation.

#### 3. Backend Mechanism (With Exact Timings & TTLs)
- **DAG Cycle Detection Algorithm (`CategoriesService.validateParent`):**
  1. Guard: `parentId !== currentCategoryId` (cannot self-parent).
  2. Traversal: Recursively gather all descendant IDs via `getDescendantIds(currentCategoryId)`.
  3. Cycle check: If `descendantIds.includes(newParentId)`, immediately abort with `400 Bad Request: Circular hierarchy detected`.
- **Cache Eviction Strategy:** Category trees are cached in Redis under `CATEGORY_TREE` with a TTL of **24 hours** (`CATEGORY_TTL`). Mutations (create, update, move, delete) purge `CATEGORY_TREE` and `CATEGORY_BY_SLUG` instantly across all replicas.

#### 4. Client-Side Architecture & UX Flow
- **Hierarchical Tree Picker (`CategoryPicker`):** Multi-level drill-down modal with visual hierarchy indentation and search filtering.
- **Deep-Slug Dynamic Routing (`/category/[...slug]`):** Next.js App Router catch-all route resolving nested categories server-side with breadcrumbs rendered for SEO.
- **React Query Hydration:** Category hierarchies pre-fetched during server component rendering and cached on the client with a 10-minute `staleTime`.

#### 5. Acronym & Concept Glossary
- **DAG (Directed Acyclic Graph):** A graph structure that flows in one direction with zero closed loops (no node can be its own ancestor).
- **Slug:** A clean, URL-safe version of a string (e.g., `Gaming Laptops` $\rightarrow$ `gaming-laptops`).
- **Catch-All Route (`[...slug]`):** A Next.js route pattern that captures any number of URL path segments into an array.

#### 6. Edge Cases & Failure Scenarios Handled
- Attempting to attach a category to an `ARCHIVED` parent.
- Case-insensitive sibling name collision checks.
- Deletion protection: categories with active products cannot be hard-deleted.

#### 7. Jot-Down Notes
- *Model categories as a Directed Acyclic Graph (DAG) and recursively check descendant lists before updating parent foreign keys to prevent infinite loops.*
- *Combine server-side breadcrumb generation with client-side tree caching for optimal SEO and sub-10ms navigation.*

---

### Domain 3: Shopping Cart & Checkout Orchestration

#### 1. Context & Mental Model
Coordinates cart item modifications, real-time variant selections, candidate cart selection, and atomic order creation with inventory reservations.

#### 2. Problems Solved & Engineering Defenses
- **Flash-Sale Inventory Overselling & Double Allocation:**
  - *The Failure Mode:* Multiple shoppers checking out the final item in stock at the exact same millisecond. Traditional in-memory checks read `stock = 1` for all transactions, allowing all to succeed and driving physical inventory into negative numbers.
  - *How NUTS Solved It:* Replaced in-memory validation with database-level atomic conditional SQL decrements inside an active transaction:
    ```sql
    UPDATE products SET stock = stock - :qty WHERE id = :id AND stock >= :qty;
    ```
    If the modified row count is zero, stock has been depleted. The transaction immediately rolls back and throws `409 Conflict` (`INSUFFICIENT_STOCK`) with a payload identifying the exact conflicting items.
- **Circular Database Deadlocks (`SQLSTATE 40P01`):**
  - *The Failure Mode:* Two shoppers checking out overlapping items in opposing order (Tx 1 locks Item A, waits for Item B; Tx 2 locks Item B, waits for Item A). PostgreSQL detects a circular dependency and violently terminates one transaction with error `40P01`.
  - *How NUTS Solved It:* Implemented **Lexicographical Lock Sorting**. Before requesting locks or executing decrements, all cart items are sorted alphabetically by ID (`variantId ?? productId`). Because every concurrent transaction acquires row locks in the exact same sequence, circular wait cycles are mathematically impossible.
- **Ghost Cart Collisions & Multi-Session Desynchronization:**
  - *The Failure Mode:* Users opening multiple browser tabs or logging in across devices generate multiple cart records. Checkout naively picking the newest cart selects an empty orphan, resulting in false "Empty Cart" checkout rejections.
  - *How NUTS Solved It:* Implemented candidate cart evaluation in [`OrdersService`](file:///c:/MY%20PROJECT/NUTS-P/apps/api/src/modules/checkout/orders/orders.service.ts). The service acquires pessimistic row locks (`FOR UPDATE`) across all open carts for the user, evaluates them in-memory to select the active cart containing items (`cartItems.length > 0`), executes checkout, and prunes empty orphan carts in the same atomic SQL commit.

#### 3. Backend Mechanism (With Exact Timings & TTLs)
- **Lexicographical Lock Sorting:** Before acquiring row locks or updating stock, all cart items are sorted alphabetically by ID (`variantId ?? productId`). Because all transactions acquire locks in the exact same sequence, circular deadlocks are mathematically eliminated.
- **Pessimistic Row Locking (`FOR UPDATE`):** The user's active cart rows are locked inside an atomic database transaction.
- **Atomic Conditional SQL Decrement:**
  ```sql
  UPDATE products SET stock = stock - :qty WHERE id = :id AND stock >= :qty;
  ```
  If zero rows are modified, checkout immediately rolls back and throws an HTTP `409 Conflict` (`INSUFFICIENT_STOCK`) with a payload identifying the exact conflicting items.
- **Candidate Cart Pruning:** Empty orphan carts are deleted in the same transaction, and the Redis cart cache (`user:cart:v3:${userId}`) is evicted.

#### 4. Client-Side Architecture & UX Flow
- **Zustand Cart Drawer (`ShoppingDrawer`):** Real-time sliding drawer with optimistic quantity updates and debounced server sync (300ms).
- **Stock Conflict Modal (`StockConflictModal`):** If checkout encounters a `409 INSUFFICIENT_STOCK`, this dialog displays the out-of-stock items, adjusts the cart quantity to available stock automatically, and lets the user proceed without restarting checkout.
- **Variant Selector (`ProductVariantBuilder`):** Interactive matrix selector disabling out-of-stock attribute combinations in real time.

#### 5. Acronym & Concept Glossary
- **Pessimistic Locking (`FOR UPDATE`):** An explicit database lock ensuring no other transaction can read or modify a row until the holding transaction completes.
- **Deadlock (`40P01`):** Two or more database transactions waiting for locks held by each other, frozen indefinitely until PostgreSQL terminates one.
- **TOCTOU (Time-of-Check to Time-of-Use):** A race condition where data is checked in one step and modified in a later step, during which another process altered the data.

#### 6. Edge Cases & Failure Scenarios Handled
- Concurrently purchasing the final item in stock.
- Stale price changes during active checkout sessions (re-validated at transaction start).
- Inactive or deleted products in cart items.
- Variant stock exhaustions vs main product stock exhaustions.

#### 7. Jot-Down Notes
- *Sort all locked resource IDs lexicographically to prevent database deadlocks.*
- *Use database-level atomic conditional updates (`WHERE stock >= :qty`) rather than in-memory checks to prevent overselling.*

---

### Domain 4: Billing, Payments & Settlement Engine

#### 1. Context & Mental Model
Manages payment gateway interactions (Paystack), handles asynchronous order settlement, governs vendor escrow accounts, and cleans up abandoned inventory holds.

#### 2. Problems Solved & Engineering Defenses
- **Dropped Payment Redirects & Lost Purchases:**
  - *The Failure Mode:* Customers complete payment on the gateway but close their browser, lose internet connection, or experience an error before returning to the `/order-success` callback URL, leaving the order stuck in `PENDING` state.
  - *How NUTS Solved It:* Made Paystack webhooks the single source of truth for payment settlement. As soon as Paystack fires `charge.success`, the backend asynchronously settles the order, updates inventory, and credits the vendor escrow ledger without requiring the customer's browser to complete the return redirect.
- **Duplicate Payment Processing & Webhook Replays:**
  - *The Failure Mode:* Payment gateways retry webhooks on transient network timeouts, which could credit vendor wallets multiple times or generate duplicate fulfillment events.
  - *How NUTS Solved It:* Built an idempotent state machine on the order payment reference. If an incoming webhook arrives for an order that is already in `PROCESSING` or `PAID` state, the handler logs the duplicate and immediately returns `200 OK` without re-executing ledger updates or event publishing.
- **Abandoned Inventory Holds:**
  - *The Failure Mode:* Shoppers initiate checkout but abandon the Paystack payment window, leaving inventory reserved and preventing other customers from purchasing.
  - *How NUTS Solved It:* Engineered an automated distributed sweeper (`UnpaidOrdersCron`) running every **60 seconds** under an atomic Redis lock (`cron:lock:unpaid-orders`, 45s TTL). It queries `PENDING` orders older than **15 minutes**, releases reserved inventory back to products/variants in a single database transaction, and transitions orders to `CANCELLED`.
- **Premature Merchant Payouts & Marketplace Exposure:**
  - *The Failure Mode:* Vendors withdrawing sales revenue immediately upon checkout, leaving the platform liable for buyer refunds if goods are never shipped or delivered.
  - *How NUTS Solved It:* Implemented a two-phase escrow ledger: 85% of order funds are initially locked in `pendingBalance`. Funds only transfer to available `balance` when the buyer or carrier confirms delivery status as `DELIVERED`.

#### 3. Backend Mechanism (With Exact Timings & TTLs)
- **Timing-Safe Webhook Verification:** Paystack webhooks are verified using a timing-safe `crypto.timingSafeEqual` check on the `x-paystack-signature` header against an HMAC-SHA512 digest of the raw request buffer.
- **Asynchronous State Machine:**
  - Order created: Status set to `PENDING`.
  - Webhook received (`charge.success`): State transitions atomically `PENDING -> PROCESSING`.
  - Duplicate webhooks receive `200 OK` immediately without re-executing business logic.
- **Two-Phase Escrow Release:**
  - When payment succeeds, **85%** of the item total is credited to the vendor's `pendingBalance`.
  - When the customer confirms delivery or the carrier status updates to `DELIVERED`, the funds transfer from `pendingBalance` to available `balance` for payout.
- **Unpaid Order Cleanup Sweeper (`UnpaidOrdersCron`):**
  - Runs **every 60 seconds** (`* * * * *`).
  - Acquires an atomic Redis lock: `cron:lock:unpaid-orders` with an auto-release TTL of **45 seconds**.
  - Sweeps all orders in `PENDING` state older than **15 minutes** (`UNPAID_ORDER_TTL_MINUTES`).
  - Restores the reserved stock back to `products` / `product_variants` and transitions order status to `CANCELLED`.

#### 4. Client-Side Architecture & UX Flow
- **Paystack Pop / Gateway Redirect (`CheckoutFlow`):** Launches Paystack payment modal or redirect; tracks transaction reference in session storage.
- **Payment Verification Polling (`/order-success`):** If user returns before webhook arrives, client polls order status up to 5 times (2-second interval) before displaying success.
- **Vendor Wallet Dashboard (`VendorWalletView`):** Shows clear visual distinction between *Pending Escrow* and *Available Balance* with transaction ledger.

#### 5. Acronym & Concept Glossary
- **HMAC (Hash-based Message Authentication Code):** A cryptographic signature that proves a message came from Paystack and wasn't altered in transit.
- **Idempotency:** An operation that can be applied multiple times without changing the result beyond the initial application.
- **Escrow:** Holding funds in a secure intermediate state until contractual obligations (order delivery) are fulfilled.

#### 6. Edge Cases & Failure Scenarios Handled
- Webhook arrives before client redirect completes.
- Customer payment fails or is rejected by their issuing bank.
- Distributed cron multi-instance overlap (prevented via Redis lock token).
- Partial refunds and inventory re-stocking.

#### 7. Jot-Down Notes
- *Webhooks must be the definitive source of truth for payment status, not client-side redirects.*
- *Release marketplace vendor funds via two-phase escrow tied strictly to delivery state.*
- *Protect automated database cron sweepers with distributed Redis locks to prevent multi-container cluster duplication.*

---

### Domain 5: Real-Time Notifications, Outbox & Messaging

#### 1. Context & Mental Model
Maintains real-time browser updates via Server-Sent Events (SSE), routes domain messages through RabbitMQ queues, and dispatches transactional emails via Brevo.

#### 2. Problems Solved & Engineering Defenses
- **The Dual-Write Problem (Lost Queue Messages):**
  - *The Failure Mode:* Saving an entity to PostgreSQL and publishing a message to RabbitMQ in separate operations. If the server crashes or the network partitions after the database commit, the RabbitMQ message is lost forever while the database record remains, causing desynchronized downstream services.
  - *How NUTS Solved It:* Implemented the **Transactional Outbox Pattern**. The business entity and the domain event are inserted into the database in the **same atomic SQL transaction**. A resilient background worker continuously polls the `outbox` table and publishes events to RabbitMQ with automatic retries and dead-letter queue routing (`nuts.dlx`).
- **Dropped SSE Connections via Cloud Proxies:**
  - *The Failure Mode:* Cloud reverse proxies (Nginx, Render, Cloudflare) automatically terminate idle HTTP streaming connections after 30–60 seconds of inactivity, breaking real-time browser updates.
  - *How NUTS Solved It:* Engineered an active keepalive heartbeat (`: keepalive\n\n`) dispatched every **15 seconds** across all active SSE streams. This resets proxy idle timers while validating the user's Redis security stamp on each pulse to terminate compromised connections immediately.
- **Duplicate Notification Replay on Worker Restarts:**
  - *The Failure Mode:* Background workers crashing and reprocessing unacknowledged queue messages, sending duplicate emails or SMS messages to users.
  - *How NUTS Solved It:* Implemented consumer-level message deduplication using atomic Redis keys (`msg:processed:{eventId}`) with a **24-hour TTL**, guaranteeing at-most-once side-effect execution.

#### 3. Backend Mechanism (With Exact Timings & TTLs)
- **Transactional Outbox Pattern:**
  - The business entity and the domain event are inserted into the database in the **same atomic SQL transaction**.
  - Background workers poll the `outbox` table and publish to RabbitMQ with automatic retries and exponential backoff.
- **SSE Connection Keepalive:**
  - Heartbeat comment (`: keepalive\n\n`) dispatched every **15 seconds** to keep reverse proxy connections open.
  - Active Redis session validation runs on every heartbeat; if the user's security stamp is revoked, the SSE connection terminates immediately.
- **RabbitMQ Topology:**
  - Queues: `q.nuts.emails`, `q.nuts.analytics`, `q.nuts.inventory`.
  - Durable queues with Dead Letter Exchanges (DLX) for failed messages.

#### 4. Client-Side Architecture & UX Flow
- **Zustand Notification Store (`useNotificationStore`):** Manages live unread badge count, toast popups, and SSE stream lifecycle.
- **Persistent Connection across Navigation:** SSE connection lives in the root provider, surviving Next.js route transitions without reconnecting.
- **Auto-Reconnect with Backoff:** Re-establishes connection on network drops (1s, 2s, 5s, max 30s) using the `Last-Event-ID` header to resume missed events.

#### 5. Acronym & Concept Glossary
- **Dual-Write Problem:** A distributed systems challenge where writing to two separate systems (DB + Message Queue) cannot be done atomically without a two-phase commit or an outbox pattern.
- **SSE (Server-Sent Events):** A persistent, unidirectional HTTP connection where the server pushes live updates to the client without the overhead of WebSockets.
- **DLQ (Dead Letter Queue):** A queue holding messages that failed processing after reaching maximum retry limits.

#### 6. Edge Cases & Failure Scenarios Handled
- Temporary RabbitMQ network partition.
- Browser tab sleeping or entering background mode.
- Rate-limited email provider (Brevo) backed by an internal Circuit Breaker.

#### 7. Jot-Down Notes
- *Solve the dual-write problem by saving domain events into an outbox table in the same database transaction as the business entity.*
- *Maintain long-lived SSE connections by sending 15-second heartbeat comments to prevent reverse proxies from dropping idle connections.*

---

### Domain 6: Search, Autocomplete & Multi-Tier Relevance

#### 1. Context & Mental Model
Provides instant, typo-tolerant search across products, categories, vendors, and SKUs with relevance scoring directly inside PostgreSQL without external cluster maintenance.

#### 2. Problems Solved & Engineering Defenses
- **Elasticsearch Operational Complexity & Failure Modes:**
  - *The Failure Mode:* Running a dedicated Elasticsearch or Meilisearch cluster for a catalog under 500,000 items introduces cluster maintenance overhead, indexing sync delays, and network failure points.
  - *How NUTS Solved It:* Engineered an 8-tier relevance search engine directly in PostgreSQL using `pg_trgm` (trigram similarity) and `tsvector` (full-text search) with GIN indexes (`gin_trgm_ops`). Achieves sub-**35ms** query latency with zero external cluster dependencies.
- **Zero Results on Typos & Misspellings:**
  - *The Failure Mode:* Standard `LIKE` or `ILIKE` queries return zero results when users make slight spelling mistakes (e.g., "shooes" instead of "shoes").
  - *How NUTS Solved It:* Configured a fallback tier in raw SQL evaluating `similarity(p.name, :term) > 0.3`, matching misspelled queries against the GIN trigram index and sorting results by relevance score.

#### 3. Backend Mechanism (With Exact Timings & TTLs)
- **Multi-Tier Relevance Scoring:**
  Queries run through a tiered `CASE` ranking in raw PostgreSQL SQL:
  1. **Exact Name Match:** Weight `10.0 + similarity`
  2. **Prefix Name Match (`ILIKE term%`):** Weight `6.0 + similarity`
  3. **Exact SKU Match:** Weight `5.0`
  4. **Prefix SKU Match:** Weight `4.0`
  5. **Substring Name Match (`ILIKE %term%`):** Weight `3.0 + similarity`
  6. **Full-Text Match (`to_tsvector @@ plainto_tsquery`):** Weight `2.8 + similarity`
  7. **Store Name Match:** Weight `2.0 + similarity`
  8. **Trigram Fuzzy Fallback (`similarity() > 0.3`):** Weight `1.0`
- **Latency Target:** Sub-**35ms** query execution on indexed PostgreSQL tables using GIN indexes (`gin_trgm_ops`).

#### 4. Client-Side Architecture & UX Flow
- **Interactive Search Drawer (`SearchDrawer`):** Slide-out search interface with debounced keystroke execution (250ms).
- **Instant Autocomplete & Recents:** Displays previous searches stored in client session alongside live product suggestions.
- **Faceted Filters:** Dynamic category, price range, and in-stock filters reflected immediately in browser URL query parameters.

#### 5. Acronym & Concept Glossary
- **GIN Index (Generalized Inverted Index):** A database index designed for multi-value elements like text arrays and full-text documents.
- **Trigram (`pg_trgm`):** Breaking words into 3-character slices (e.g. `shoes` $\rightarrow$ `sho`, `hoe`, `oes`) to measure how similar two words are even with typos.
- **tsvector:** A sorted list of distinct normalized lexemes optimized for full-text search.

#### 6. Edge Cases & Failure Scenarios Handled
- Special characters and punctuation in search queries.
- Multi-word search terms matching across store name, product description, and category.
- Search queries returning zero matches falling back to popular recommendations.

#### 7. Jot-Down Notes
- *PostgreSQL's built-in `pg_trgm` and `tsvector` can match external search engines in performance for catalogs up to hundreds of thousands of items without extra operational overhead.*

---

### Domain 7: Infrastructure, Data Governance & Connection Pooling

#### 1. Context & Mental Model
Governs how the NestJS API communicates with PostgreSQL, manages connection lifecycles, runs database migrations safely, and logs slow queries.

#### 2. Problems Solved & Engineering Defenses
- **PostgreSQL Connection Starvation & Pool Exhaustion:**
  - *The Failure Mode:* Cloud containers and traffic surges spawning dozens of database connections that exceed PostgreSQL's `max_connections` (typically 100), crashing the database with `FATAL: remaining connection slots are reserved for non-replication superuser connections`.
  - *How NUTS Solved It:* Implemented a two-tier connection pooling architecture using **PgBouncer in transaction-pooling mode** on port 6543. Connections are held only for the duration of a single transaction then immediately released back to the pool. Application pools per container are capped at 10 (`DB_CONNECTION_LIMIT=10`), allowing hundreds of concurrent requests to share a minimal footprint of physical connections.
- **Migration Advisory Lock Conflicts on Pooled Connections:**
  - *The Failure Mode:* Running Prisma migrations through transaction-mode connection poolers causes migrations to fail because transaction-level poolers do not support session-level advisory locks.
  - *How NUTS Solved It:* Partitioned database connections into two dedicated endpoints: a **Direct Session Connection (Port 5432)** used exclusively for Prisma schema migrations (`prisma migrate deploy`) and advisory locks, and a **Transaction Pooler (Port 6543)** for all runtime application queries.

#### 3. Backend Mechanism (With Exact Timings & TTLs)
- **Two-Tier Connection Architecture:**
  - **Tier 1: Direct Session Connection (Port 5432):** Direct TCP connection used exclusively for Prisma schema migrations (`prisma migrate deploy`) and advisory locks.
  - **Tier 2: Transaction Pooler (Port 6543 via PgBouncer):** Used for all runtime queries. Connections are held only for the duration of a single transaction, then immediately released to the pool.
- **Driver Adapter Connection Throttling:**
  - Using `@prisma/adapter-pg` with explicit connection limits (`DB_CONNECTION_LIMIT=10`), keepalive timeouts (`DB_KEEPALIVE_MS=240000`), and idle timeouts (`DB_IDLE_TIMEOUT_MS=300000`).

#### 4. Client-Side Architecture & UX Flow
- **Next.js Server Component Fetcher (`server-fetcher.ts`):** Direct server-to-server API calls with upstream latency tracking and automatic timeout aborts (3.5s prod, 15s dev).
- **Next.js Standalone Build:** Standalone node output packaging only necessary dependencies, reducing container image size from 1.2 GB to under 250 MB.

#### 5. Acronym & Concept Glossary
- **PgBouncer:** A lightweight connection pooler for PostgreSQL that allows thousands of client connections to share a small pool of actual database connections.
- **Session Pooling vs. Transaction Pooling:** In session pooling, a client keeps one physical connection until it disconnects. In transaction pooling, the client borrows a connection only for the millisecond duration of a single query or transaction.

#### 6. Edge Cases & Failure Scenarios Handled
- Database restarts handled gracefully via pool reconnect backoff.
- Slow query detection without logging sensitive user parameters.
- Schema migration lock timeouts preventing deployment deadlocks.

#### 7. Jot-Down Notes
- *Never run Prisma migrations through a transaction-mode connection pooler; migrations require direct session mode.*
- *Cap application connection pool sizes to prevent database connection exhaustion during traffic spikes.*

---

## 4. The NUTS Engineering & Distributed Systems Field Manual

### Part I: Networking, Protocols & Web API Architecture

1. **HTTP Methods & Semantic Verbs:**
   - **Concept & Foundation:** HTTP defines standard verbs with explicit semantic contracts regarding *safety* (whether a request alters server state) and *idempotency* (whether executing a request multiple times yields the exact same server state). `GET` and `HEAD` must be safe and idempotent. `PUT` (full replacement), `DELETE` (resource removal), and `OPTIONS` (capability negotiation) are idempotent. `POST` (resource creation, non-idempotent action) and `PATCH` (partial modification) are non-idempotent.
   - **NUTS Production Implementation:** NUTS strictly maps business semantics to verbs: `PATCH /api/v1/cart/items/:id` mutates only the item quantity without re-uploading the line item; `POST /api/v1/orders/checkout` processes an order snapshot and reserves stock; `DELETE /api/v1/cart` clears the active cart; `GET /api/v1/products` is purely read-only and edge-cacheable.
   - **Architecture & Interview Takeaway:** *Never use `POST` for safe reads or `GET` for state mutations. Use `PUT` when the client provides the full replacement entity; use `PATCH` when sending partial delta mutations to conserve bandwidth and prevent clobbering concurrent field updates.*

2. **HTTP Status Codes & Semantic Error Mapping:**
   - **Concept & Foundation:** Standard 3-digit status codes communicate the exact outcome of a request across 5 classes: 2xx (Success), 3xx (Redirection), 4xx (Client Errors), and 5xx (Server/Upstream Errors). Precise status codes allow clients, proxies, and monitoring agents to make automated retry, alerting, and error-handling decisions.
   - **NUTS Production Implementation:** NUTS uses semantic codes with high precision:
     - `200 OK`: Standard read / synchronous mutation success.
     - `201 Created`: Returned with `Location` header on user registration, order creation, and product publishing.
     - `400 Bad Request`: Validation failure on malformed DTO payloads.
     - `401 Unauthorized`: Missing, expired, or cryptographically invalid access token.
     - `403 Forbidden`: Authenticated identity lacks permission (e.g. Vendors attempting Customer shopping routes).
     - `404 Not Found`: Resource does not exist or user does not own it (scoping defense).
     - `409 Conflict`: Business invariant violation, specifically `INSUFFICIENT_STOCK` during checkout or duplicate unique fields.
     - `422 Unprocessable Entity`: Syntactically valid JSON that fails domain semantic rules (e.g. refund amount exceeding order total).
     - `429 Too Many Requests`: Throttler triggered, accompanied by `Retry-After: <seconds>`.
     - `503 Service Unavailable`: Database, Redis, or RabbitMQ down during health readiness probes (`/api/v1/health/ready`).
   - **Architecture & Interview Takeaway:** *A production API must never return `200 OK` with an `{ error: true }` body. This breaks HTTP caching, monitoring alerts, and circuit breakers. Return accurate 4xx/5xx codes to trigger automated resilience behaviors.*

3. **HTTP Headers & Content Negotiation:**
   - **Concept & Foundation:** Headers are protocol-level metadata key-value pairs governing caching (`Cache-Control`, `ETag`), security (`Content-Security-Policy`), negotiation (`Accept`, `Content-Type`), authorization (`Authorization`), and tracing (`X-Request-Id`). Content negotiation allows a client to declare acceptable representation formats (`Accept: application/json`).
   - **NUTS Production Implementation:**
     - `Authorization: Bearer <token>`: Transmits short-lived access JWTs on Axios requests.
     - `x-csrf-token`: Header holding the double-submit token compared against the encrypted CSRF cookie on all mutating requests.
     - `x-paystack-signature`: Webhook header holding the HMAC-SHA512 signature computed over the raw payload buffer.
     - `Content-Type: text/event-stream`: Declares long-lived Server-Sent Event channels.
   - **Architecture & Interview Takeaway:** *Headers provide out-of-band operational context without polluting entity payloads. Never pass authorization tokens or cryptographic signatures inside JSON request bodies.*

4. **Cookies vs. Sessions vs. Tokens:**
   - **Concept & Foundation:**
     - *Cookies:* Browser-managed key-value storage automatically transmitted in the `Cookie` header on every HTTP request to matching domains.
     - *Sessions:* Server-managed state stored in a fast datastore (e.g. Redis), referenced by a random Session ID cookie.
     - *Tokens (JWT):* Self-contained, stateless, cryptographically signed JSON documents encoding claims (`sub`, `roles`, `exp`).
   - **NUTS Production Implementation:** NUTS uses a hybrid **Defense-in-Depth Session/Token Architecture**:
     - The **Access Token** is a 15-minute stateless JWT held in client memory closures (React state) and sent via `Authorization: Bearer` headers (immune to CSRF).
     - The **Refresh Token** is a 7-day cryptographically random token stored in an `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/api/v1/auth` cookie (immune to XSS).
     - The **Session Record** is stored in Redis/PostgreSQL (`refreshTokenId`), allowing immediate remote revocation (`POST /api/v1/auth/logout-all`).
   - **Architecture & Interview Takeaway:** *Storing access tokens in `localStorage` leaves users vulnerable to XSS token exfiltration. Relying purely on stateless JWTs makes instant session revocation impossible. Use short-lived in-memory tokens for requests, HttpOnly cookies for refresh, and server-side session tracking for revocability.*

5. **Authentication vs. Authorization & Zero-Trust Governance:**
   - **Concept & Foundation:**
     - *Authentication (AuthN):* Verifying *who* you are (identity verification via passwords, OTPs, biometric signatures).
     - *Authorization (AuthZ):* Verifying *what* you are allowed to do (permissions, role-based access control [RBAC], attribute-based access control [ABAC]).
   - **NUTS Production Implementation:**
     - **AuthN:** Multi-step registration, bcrypt password hashing with constant-time dummy verification, and Redis-backed 6-digit OTP verification.
     - **AuthZ:** Zero-Trust capability isolation using NestJS `@Roles('USER' | 'VENDOR' | 'ADMIN')` decorators, `RolesGuard`, and database tenant scoping (`where: { userId }`). A vendor attempting to call customer checkout receives `403 Forbidden` at the guard layer before any database query executes.
   - **Architecture & Interview Takeaway:** *Authentication establishes identity; Authorization enforces boundaries. Always enforce authorization at both the API gateway/guard layer and the database query layer (tenant isolation).*

6. **Request & Response Lifecycle in NestJS:**
   - **Concept & Foundation:** The sequence of processing phases an HTTP request traverses: Middleware $\rightarrow$ Guards $\rightarrow$ Interceptors (pre) $\rightarrow$ Pipes $\rightarrow$ Controller Handler $\rightarrow$ Service Layer $\rightarrow$ Interceptors (post) $\rightarrow$ Exception Filters.
   - **NUTS Production Implementation:**
     1. `RawBodyMiddleware`: Captures unmodified bytes for HMAC verification on webhook routes.
     2. `CsrfProtectionMiddleware`: Validates `x-csrf-token` against cookie.
     3. `JwtAuthGuard`: Resolves Bearer header or cookie into `req.user`.
     4. `RolesGuard`: Verifies role metadata.
     5. `LoggingInterceptor`: Starts high-resolution monotonic timer.
     6. `ValidationPipe`: Validates and transforms payload into typed DTO.
     7. `Controller & Service`: Executes business logic and database transaction.
     8. `TransformInterceptor`: Envelopes response into `{ success: true, statusCode, data, meta }`.
     9. `GlobalExceptionFilter`: Catches unhandled errors and maps Prisma codes into RFC-compliant JSON.
   - **Architecture & Interview Takeaway:** *Strict separation of concerns across lifecycle hooks prevents code pollution. Security lives in Middlewares and Guards; transformation lives in Pipes and Interceptors; failure translation lives in Exception Filters.*

7. **Content Types & Serialization:**
   - **Concept & Foundation:** MIME types declare payload serialization format via `Content-Type` headers (`application/json`, `multipart/form-data`, `text/event-stream`, `application/x-www-form-urlencoded`).
   - **NUTS Production Implementation:**
     - `application/json`: Standard REST endpoint communication format.
     - `multipart/form-data`: Intercepted by `FileInterceptor` and streamed directly to Cloudinary without buffering multi-megabyte payloads in server RAM.
     - `text/event-stream`: Long-lived unbuffered streaming for Server-Sent Events.
   - **Architecture & Interview Takeaway:** *Never parse multipart file uploads into Node.js server memory buffers in high-throughput environments. Pipe streams directly to object storage or CDN ingestion endpoints.*

8. **CORS (Cross-Origin Resource Sharing) & Origin Sandboxing:**
   - **Concept & Foundation:** A browser security standard preventing scripts on `origin-a.com` from making requests to `origin-b.com` and reading responses unless `origin-b.com` explicitly issues `Access-Control-Allow-Origin` headers. Preflight `OPTIONS` requests verify permissions before mutating requests execute.
   - **NUTS Production Implementation:** NestJS CORS is configured with explicit whitelist parsing (`ALLOWED_ORIGINS` environment variable). Wildcard `*` is strictly disallowed in production. When requests arrive with credentials (`credentials: true`), the server echoes the verified origin explicitly, preventing credential leakage across rogue origins.
   - **Architecture & Interview Takeaway:** *Setting `Access-Control-Allow-Origin: *` while enabling `Access-Control-Allow-Credentials: true` is rejected by modern browsers. Always whitelist explicit origins and ensure reverse proxies pass origin headers accurately.*

9. **CSRF (Cross-Site Request Forgery) & Double-Submit Protection:**
   - **Concept & Foundation:** CSRF attacks exploit ambient browser credential transmission (cookies sent automatically with cross-site requests). A malicious site tricks an authenticated user's browser into executing unwanted state changes on the target application.
   - **NUTS Production Implementation:**
     - NUTS employs a **Double-Submit Cookie Pattern with Cryptographic HMAC Noncing**:
       1. The server issues a cryptographically secure CSRF token in an unreadable cookie.
       2. The client reads the token and transmits it in the `x-csrf-token` request header.
       3. The server compares the header token against the cookie token. Cross-origin attackers cannot read the cookie to set the matching header.
     - Third-party webhooks (e.g. Paystack) bypass CSRF on route match `/api/v1/payments/webhook` and are defended via raw HMAC-SHA512 verification.
   - **Architecture & Interview Takeaway:** *Modern `SameSite=Lax` cookies provide baseline defense against standard cross-site POSTs, but defense-in-depth requires explicit CSRF noncing or custom authorization headers for all state-mutating requests.*

10. **HTTPS, TLS/SSL & Origin Encryption:**
    - **Concept & Foundation:** TLS (Transport Layer Security) encrypts communication between client and server, preventing eavesdropping, tampering, and Man-in-the-Middle (MITM) packet sniffing. It combines asymmetric cryptography (RSA/ECC for key exchange) with high-speed symmetric encryption (AES-256-GCM) for data transfer.
    - **NUTS Production Implementation:** NUTS enforces HTTPS across all environments. Nginx or Cloudflare/Render terminates public TLS certificates and forwards traffic to the NestJS application over internal secure virtual networks. All cookies have the `Secure` flag enforced (`AUTH_COOKIE_SECURE=true`), preventing transmission over plaintext HTTP.
    - **Architecture & Interview Takeaway:** *Never run production applications over unencrypted HTTP. Enforce HTTP Strict Transport Security (HSTS) and ensure all authentication cookies have the `Secure` attribute to eliminate plaintext credential transmission.*

11. **HTTP/1.1 vs. HTTP/2 vs. HTTP/3:**
    - **Concept & Foundation:**
      - *HTTP/1.1:* Text-based protocol suffering from Head-of-Line (HOL) blocking at the application layer (only 1 request per TCP socket at a time, prompting browsers to open 6 parallel TCP connections).
      - *HTTP/2:* Binary protocol with single-TCP multiplexing (multiple bidirectional streams interleaved over one connection) and HPACK header compression.
      - *HTTP/3:* Runs over QUIC (UDP), eliminating transport-layer HOL blocking caused by TCP packet loss.
    - **NUTS Production Implementation:** Nginx and Render edge proxies serve HTTP/2 to web clients, enabling the browser to load store assets, icons, product catalogs, and the SSE notification channel simultaneously over a single TCP connection without socket exhaustion.
    - **Architecture & Interview Takeaway:** *HTTP/2 multiplexing makes persistent Server-Sent Events (SSE) practical alongside normal API traffic without exhausting the browser's 6-connection per-origin limit.*

12. **Keep-Alive, TCP Handshakes & Connection Reuse:**
    - **Concept & Foundation:** Establishing a TCP connection requires a 3-way handshake (`SYN`, `SYN-ACK`, `ACK`), plus additional round-trips for TLS negotiation. Reusing existing TCP connections via `Connection: keep-alive` eliminates this latency on subsequent requests.
    - **NUTS Production Implementation:**
      - The Next.js upstream fetcher (`server-fetcher.ts`) utilizes an `http.Agent` with `keepAlive: true` and a 120-second timeout, ensuring SSR server calls reuse established TCP channels to NestJS.
      - Database connection pools maintain active TCP keep-alive probes (`DB_KEEPALIVE_MS=240000`) to prevent cloud firewalls and NAT gateways from silently terminating idle pool connections.
    - **Architecture & Interview Takeaway:** *In microservices and modular monoliths, TLS negotiation latency can dominate request duration. Connection reuse via keep-alive reduces P99 latency by 40-70%.*

13. **Payload Compression (Gzip / Brotli) & Streaming Disablement:**
    - **Concept & Foundation:** HTTP compression algorithms (Brotli `br`, Gzip `gzip`) compress JSON and text responses at the server boundary, reducing network payload size by up to 80%. However, compression requires buffering data blocks, which breaks real-time chunked streaming protocols.
    - **NUTS Production Implementation:** Nginx applies Brotli/Gzip compression to all static assets and standard REST JSON responses. However, on the Server-Sent Events route (`/api/v1/notifications/sse/stream`), compression is explicitly disabled via `X-Accel-Buffering: no` and `no-transform` cache controls to prevent reverse proxies from buffering SSE event frames.
    - **Architecture & Interview Takeaway:** *Compression and real-time streaming are mutually exclusive at the proxy level. Streaming endpoints must explicitly disable proxy buffering and compression.*

14. **Real-Time Streaming & Server-Sent Events (SSE):**
    - **Concept & Foundation:** SSE is a unidirectional streaming protocol over standard HTTP where the server pushes UTF-8 formatted text events (`text/event-stream`) to the client without the overhead, handshake complexity, or binary framing of WebSockets.
    - **NUTS Production Implementation:**
      - Controller endpoint `@Sse('stream')` returns an RxJS `Observable<MessageEvent>`.
      - When domain events occur (e.g. order placed, payment confirmed), Redis Pub/Sub broadcasts the event to all API cluster nodes.
      - Active SSE streams push the event to connected user clients.
      - A 15-second heartbeat ping (`:ping\n\n`) is emitted continuously to prevent cloud reverse proxies from killing idle connections.
    - **Architecture & Interview Takeaway:** *For server-to-client notifications (order updates, stock alerts, badge counters), SSE is vastly superior to WebSockets: it works over standard HTTP/2, traverses enterprise firewalls seamlessly, and includes native browser reconnection (`EventSource`).*

15. **Idempotency & Idempotent API Design:**
    - **Concept & Foundation:** An idempotent operation can be applied multiple times without changing the result beyond the initial application. In distributed networks, clients often retry requests upon network timeouts; without idempotency, retried payments or checkouts cause double-charges or duplicate orders.
    - **NUTS Production Implementation:**
      - Payment webhooks use the unique payment transaction reference (`reference`) as a cryptographic idempotency key.
      - `PaymentsService` checks if `order.paymentStatus === 'PAID'` inside a transaction. If already processed, it returns `200 OK` immediately without re-crediting vendor escrow or creating duplicate receipts.
      - Order checkout verifies candidate cart item state to ensure re-submissions do not double-decrement inventory.
    - **Architecture & Interview Takeaway:** *Network calls will fail and clients will retry. Design all financial mutations, inventory operations, and webhook handlers to be strictly idempotent using unique deduplication keys.*

16. **API Versioning Strategies:**
    - **Concept & Foundation:** As business requirements evolve, APIs must change without breaking existing mobile apps, external integrations, or legacy web clients. Strategies include: URI Path (`/v1`), Request Header (`Accept-Version: v1`), or Query Parameter (`?v=1`).
    - **NUTS Production Implementation:** NUTS enforces **Strict URI Path Versioning** configured globally via NestJS `app.setGlobalPrefix('api/v1')`. All routes, Swagger documentation, and frontend API clients explicitly target `/api/v1/*`. Breaking changes in the future will be introduced under `/api/v2/*` alongside legacy controllers without disruption.
    - **Architecture & Interview Takeaway:** *URI path versioning provides the highest visibility in access logs, reverse proxy routing rules, and browser debugging tools compared to header-based versioning.*

17. **Pagination, Filtering, Sorting & Search Query Contracts:**
    - **Concept & Foundation:** Unbounded database queries (`SELECT * FROM products`) exhaust server RAM and crash production databases under scale. Standard query contracts enforce controlled pagination (Offset/Limit or Cursor-based), safe column filtering, and whitelisted sorting.
    - **NUTS Production Implementation:**
      - `PaginationDto` enforces strict limits: `page` (default: 1, min: 1), `limit` (default: 20, max: 100).
      - Prisma queries calculate `skip: (page - 1) * limit` and execute `prisma.$transaction([query, count])` for accurate pagination envelopes.
      - Sort fields are validated against strict TypeScript enums (`createdAt`, `price`, `rating`), rejecting arbitrary user strings to prevent SQL error injection.
    - **Architecture & Interview Takeaway:** *Never allow unlimited query limits. Always enforce maximum page sizes and validate sort fields against an explicit whitelist of indexed database columns.*

18. **Rate Limiting, Sliding Windows & Throttling Algorithms:**
    - **Concept & Foundation:** Protects APIs against brute-force attacks, credential stuffing, scraping, and Denial of Service (DoS). Algorithms include: Fixed Window, Token Bucket, Leaky Bucket, and Sliding Window Counter.
    - **NUTS Production Implementation:**
      - NUTS uses **Redis-backed Sliding Window Throttling** via `@nestjs/throttler`:
        - Global API: 100 requests per 60-second window.
        - Refresh Token Endpoint: 10 requests per 60-second window.
        - OTP Generation & Verification: 5 requests per 10-minute window.
      - Throttled requests immediately return `429 Too Many Requests` with a calculated `Retry-After` header.
    - **Architecture & Interview Takeaway:** *Fixed-window counters suffer from traffic spikes at boundary edges (2x limit at window seams). Sliding-window algorithms distribute rate-limiting evenly across time slices.*

19. **API Contracts, DTO Validation & Schema Whitelisting:**
    - **Concept & Foundation:** An API contract defines the exact structure, types, and constraints of incoming and outgoing data. Runtime validation ensures malformed or malicious payloads are rejected before reaching business logic.
    - **NUTS Production Implementation:**
      - NestJS `ValidationPipe` configured with:
        - `whitelist: true`: Strips undeclared properties from incoming request bodies.
        - `forbidNonWhitelisted: true`: Immediately rejects payloads containing unknown attributes with `400 Bad Request`.
        - `transform: true`: Automatically coerces primitives and instantiates typed DTO classes.
    - **Architecture & Interview Takeaway:** *Whitelisting protects systems against Mass Assignment vulnerabilities where attackers attempt to inject fields like `{ "role": "ADMIN", "isApproved": true }` into standard user profile updates.*

20. **Standardized Error Handling, RFC 7807 & Exception Translation:**
    - **Concept & Foundation:** Uniform error formatting allows client applications to parse errors consistently and display meaningful user messages. RFC 7807 defines standard Problem Details for HTTP APIs.
    - **NUTS Production Implementation:**
      - `GlobalExceptionFilter` intercepts all thrown exceptions.
      - Internal Prisma database errors are intercepted and translated:
        - `P2002` (Unique constraint violation) $\rightarrow$ `409 Conflict` with the conflicting field name.
        - `P2025` (Record not found) $\rightarrow$ `404 Not Found`.
      - Responses follow a uniform envelope:
        ```json
        {
          "success": false,
          "statusCode": 409,
          "timestamp": "2026-10-25T21:00:00.000Z",
          "path": "/api/v1/vendors/register",
          "error": "Conflict",
          "message": "A store with this name already exists"
        }
        ```
    - **Architecture & Interview Takeaway:** *Never leak raw database stack traces or SQL syntax errors to clients. Exception translation sanitizes internal infrastructure details while providing actionable client errors.*

21. **Synchronous vs. Asynchronous Communication:**
    - **Concept & Foundation:**
      - *Synchronous (Blocking):* Client waits for server to complete all work before receiving an HTTP response (tight coupling, high latency, cascade failure risk).
      - *Asynchronous (Non-Blocking):* Server accepts the request, persists an event or queues a job, and returns an immediate response (`202 Accepted` or `201 Created`), while background workers complete the processing.
    - **NUTS Production Implementation:**
      - **Synchronous:** Cart validation, payment charge verification, and order row locking (must be consistent before returning to user).
      - **Asynchronous:** Brevo transactional email delivery, seller order notification emails, search reindexing, and real-time SSE event fanout via RabbitMQ and Redis Pub/Sub.
    - **Architecture & Interview Takeaway:** *Keep the HTTP request-response cycle as fast as possible. Any work that can tolerate eventual consistency (emails, analytics, push notifications) must be offloaded to asynchronous background queues.*

---

### Part II: Database Systems, Query Optimization & Concurrency

22. **ACID Guarantees & Transaction Boundaries:**
    - **Concept & Foundation:** The fundamental properties of relational database reliability:
      - *Atomicity:* All operations inside a transaction succeed together or all roll back completely (All-or-Nothing).
      - *Consistency:* State transitions preserve all database invariants and constraints.
      - *Isolation:* Concurrent transactions execute without dirty reads, non-repeatable reads, or phantom updates.
      - *Durability:* Once committed, data survives power failures and system crashes via write-ahead logging (WAL).
    - **NUTS Production Implementation:** `OrdersService.checkout()` executes inside a single `prisma.$transaction(async (tx) => { ... })`:
      1. Locks candidate cart with items.
      2. Validates product availability and active status.
      3. Atomically decrements variant stock levels.
      4. Creates the `Order` and `OrderItem` records.
      5. Generates the payment reference.
      6. Writes domain events into the `Outbox` table.
      If variant stock is insufficient or payment setup fails, every change rolls back instantly.
    - **Architecture & Interview Takeaway:** *Keep ACID transactions as short as possible. Never make external network HTTP calls (e.g. Stripe/Paystack API) inside an open database transaction, as network latency holds database locks and starves the connection pool.*

23. **CAP Theorem & PACELC Trade-Offs:**
    - **Concept & Foundation:**
      - *CAP Theorem:* In a distributed system with Network Partitions (P), you can choose either Consistency (C) or Availability (A), but never both.
      - *PACELC Theorem:* Extends CAP: If there is a Partition (P), how do you trade off Availability (A) and Consistency (C); Else (E), how do you trade off Latency (L) and Consistency (C)?
    - **NUTS Production Implementation:**
      - **CP (Consistency / Partition-Tolerant):** Applied to Inventory Reservation, Order Checkout, and Escrow Balance Settlements. If database locks cannot be acquired or network partitions occur, the checkout request fails fast with an error rather than overselling physical stock.
      - **AP (Availability / Partition-Tolerant):** Applied to Catalog Browsing, Search Autocomplete, and Category Taxonomy Trees. Cached read replicas and Redis return slightly stale catalog data rather than returning HTTP 500 errors to shoppers.
    - **Architecture & Interview Takeaway:** *Enterprise systems are not uniformly CP or AP. Partition your architecture so financial and inventory domains prioritize Consistency (CP), while browsing and search prioritize Availability and Low Latency (AP).*

24. **Database Connection Starvation & Pooling (PgBouncer):**
    - **Concept & Foundation:** PostgreSQL operates a process-per-connection architecture where each client connection allocates 5-10 MB of RAM. High concurrency or serverless auto-scaling can spawn hundreds of instances, exhausting `max_connections` and crashing the database. Connection poolers maintain a small pool of persistent physical connections and multiplex client requests through them.
    - **NUTS Production Implementation:** NUTS implements a **Two-Tier Dual-Mode Architecture**:
      - **Tier 1 — Direct Session Connection (Port 5432):** Direct connection used exclusively for Prisma schema migrations (`prisma migrate deploy`) and advisory locks (`DIRECT_URL`).
      - **Tier 2 — PgBouncer Transaction Pooler (Port 6543):** Multiplexes runtime API traffic (`DATABASE_URL`). Physical connections are borrowed only for the millisecond duration of an active transaction and immediately returned to the pool.
    - **Architecture & Interview Takeaway:** *Never run database schema migrations through a transaction-mode connection pooler like PgBouncer. Migrations require session-level locks that fail in transaction mode. Always provide a direct session connection URL for migrations.*

25. **The N+1 Query Problem & Batch Loading:**
    - **Concept & Foundation:** The N+1 problem occurs when an application executes 1 database query to fetch N parent records, and then executes N individual queries to fetch associated child records for each parent (e.g. 50 orders $\rightarrow$ 50 queries for order items = 51 queries).
    - **NUTS Production Implementation:**
      - Eliminated across all Prisma queries using eager relational loading (`include: { items: { include: { variant: true } } }`), which compiles into optimized single `JOIN` queries or batched `WHERE parent_id IN (...)` queries.
      - In `SearchService`, raw SQL queries aggregate child relations via PostgreSQL `json_agg()` directly inside the database engine, returning complete object graphs in a single round-trip.
    - **Architecture & Interview Takeaway:** *Always inspect database query logs in development. An API endpoint whose query count scales linearly with the number of returned records will collapse under production load.*

26. **Optimistic vs. Pessimistic Locking & Lost Update Defense:**
    - **Concept & Foundation:**
      - *Optimistic Locking:* Assumes conflicts are rare. Reads records with a `version` number; updates only if the version hasn't changed (`UPDATE ... WHERE id = :id AND version = :currentVersion`). If 0 rows updated, a conflict occurred and the client retries.
      - *Pessimistic Locking:* Assumes conflicts are frequent. Acquires an exclusive database row lock immediately upon reading (`SELECT ... FOR UPDATE`), blocking other transactions until the lock is released.
    - **NUTS Production Implementation:**
      - **Pessimistic Locking (`SELECT ... FOR UPDATE`):** Used during Checkout in `OrdersService` when locking candidate cart rows to prevent concurrent checkout submissions from two tabs.
      - **Atomic Conditional Writes (Optimistic Mutation):** Used for stock decrements: `UPDATE variants SET stock = stock - :qty WHERE id = :id AND stock >= :qty`. If stock is insufficient, the query affects 0 rows, prompting an instant `409 Conflict`.
    - **Architecture & Interview Takeaway:** *Optimistic locking is ideal for low-contention scenarios (user profile updates); atomic conditional updates and pessimistic locking are essential for high-contention physical inventory decrements.*

27. **Distributed Deadlocks & Ordered Lock Acquisition:**
    - **Concept & Foundation:** A deadlock occurs when Transaction A holds Lock 1 and waits for Lock 2, while Transaction B holds Lock 2 and waits for Lock 1. The database detects the cycle in its wait-for graph and forcibly terminates one transaction with a deadlock error.
    - **NUTS Production Implementation:**
      - When checking out an order with multiple items from different vendors, `OrdersService` sorts all variant IDs **lexicographically** (`items.sort((a, b) => a.variantId.localeCompare(b.variantId))`) before acquiring row locks or running atomic stock decrements.
      - Because all concurrent transactions acquire row locks in the exact same deterministic order, circular wait-for dependency graphs are mathematically impossible.
    - **Architecture & Interview Takeaway:** *Eliminate deadlocks by design rather than relying on retry loops. Enforcing a global deterministic sorting order on locked resource IDs prevents circular wait chains entirely.*

28. **Database Indexing Mechanics (B-Tree, GIN, Composite Indexes):**
    - **Concept & Foundation:** Indexes are auxiliary data structures that allow the database engine to find matching rows in $O(\log N)$ time rather than performing full table scans ($O(N)$).
      - *B-Tree:* Default self-balancing search tree optimized for equality (`=`) and range queries (`<`, `>`, `BETWEEN`).
      - *GIN (Generalized Inverted Index):* Maps elements (words, array values, JSON keys) to lists of row IDs containing them.
      - *Composite Index:* An index spanning multiple columns where column order matters (leftmost prefix rule).
    - **NUTS Production Implementation:**
      - B-Tree indexes on foreign keys: `userId`, `vendorId`, `orderId`, and `status`.
      - Composite index on `[vendorId, createdAt DESC]` for merchant backoffice order pagination.
      - GIN Trigram index (`CREATE INDEX idx_products_search ON products USING gin (name gin_trgm_ops)`) for sub-35ms fuzzy text matching.
    - **Architecture & Interview Takeaway:** *Indexes accelerate reads but slow down writes. Index foreign keys, frequently filtered status columns, and composite sort keys, but avoid indexing high-churn write columns with low query frequency.*

29. **Full-Text Search, Trigrams (`pg_trgm`) & `tsvector` Lexemes:**
    - **Concept & Foundation:** Standard `LIKE '%query%'` queries cannot use standard B-Tree indexes and force slow sequential table scans. Advanced text search uses:
      - *Trigrams:* Slicing strings into 3-character chunks to calculate similarity scores, enabling typo tolerance (e.g. `snakers` matches `sneakers`).
      - *tsvector & tsquery:* Parsing text into normalized linguistic stems/lexemes (e.g. `running` $\rightarrow$ `run`), matching text with boolean search operators.
    - **NUTS Production Implementation:** NUTS combines both inside `SearchService` via raw PostgreSQL SQL:
      - Generates `tsvector` for full-text phrase matching.
      - Uses `pg_trgm` `similarity(name, :query)` for fuzzy typo handling.
      - Weights exact matches, prefix matches, and fuzzy matches in a tiered `CASE` ranking, executing in under 35ms without external Elasticsearch operational overhead.
    - **Architecture & Interview Takeaway:** *For catalogs under 500,000 items, PostgreSQL's native `pg_trgm` and `tsvector` offer exceptional search relevance and sub-50ms latency without the complexity of managing a separate Elasticsearch cluster.*

30. **SQL Injection Defense & Parameterized Abstract Syntax Trees:**
    - **Concept & Foundation:** SQL Injection occurs when untrusted user input is concatenated directly into SQL query strings, allowing attackers to manipulate query logic, bypass authentication, or drop tables.
    - **NUTS Production Implementation:**
      - Prisma ORM compiles type-safe TypeScript expressions into parameterized queries (`$1`, `$2`), separating SQL command logic from user data at the database driver protocol layer.
      - Where raw SQL is required in `SearchService`, queries strictly use Prisma's tagged template literal `Prisma.sql` (e.g. `prisma.$queryRaw(Prisma.sql\`SELECT * FROM products WHERE name ILIKE \${term}\`)`), which automatically compiles inputs into bind parameters.
    - **Architecture & Interview Takeaway:** *Never concatenate strings to build SQL queries. Always use parameterized queries or type-safe ORM abstractions to ensure user input is treated strictly as data.*

---

### Part III: Distributed Caching & Redis Architecture

31. **In-Memory Key-Value Architecture & Memory Footprint:**
    - **Concept & Foundation:** Redis is an in-memory, single-threaded (event loop based), non-blocking data store delivering sub-millisecond read/write operations. By keeping entire datasets in RAM and using optimized C data structures (Strings, Hashes, Lists, Sets, Sorted Sets), it serves as a high-speed caching and ephemeral coordination layer.
    - **NUTS Production Implementation:**
      - Redis Alpine stores:
        - Active session security stamps (`auth:stamp:{role}:{userId}`).
        - Ephemeral 6-digit OTP verification codes (`otp:{email}`).
        - Refresh token rotation grace window records (`auth:grace:{hash}`).
        - Hierarchical category tree caches (`catalog:categories:tree`).
        - Rate limiting sliding-window counters.
    - **Architecture & Interview Takeaway:** *Redis executes commands on a single thread. Avoid long-running commands like `KEYS *` in production because they block all other client operations; use `SCAN` or key namespacing with explicit TTLs.*

32. **Cache Invalidation & The Two Hard Problems in Computer Science:**
    - **Concept & Foundation:** *"There are only two hard things in Computer Science: cache invalidation and naming things."* Keeping cached data synchronized with the primary database is critical. Serving stale data can result in displaying incorrect prices, out-of-stock items, or outdated merchant status.
    - **NUTS Production Implementation:**
      - NUTS employs **Explicit Event-Driven Cache Invalidation**:
        - When an administrator creates, updates, re-parents, or deletes a category, `CategoriesService` immediately calls `cacheService.del('catalog:categories:tree')` and evicts matching slug keys.
        - When a user logs out globally or resets their password, `auth:stamp:{role}:{userId}` is purged, forcing immediate session invalidation cluster-wide.
    - **Architecture & Interview Takeaway:** *Never rely on TTLs alone for critical business data. Pair time-based expiration with active event-driven invalidation upon entity mutations.*

33. **Cache Patterns: Cache-Aside vs. Write-Through vs. Write-Behind:**
    - **Concept & Foundation:**
      - *Cache-Aside (Lazy Loading):* The application first checks the cache. On a hit, it returns data. On a miss, it reads from the database, writes the result to the cache, and returns data.
      - *Write-Through:* The application writes to the cache and database simultaneously before returning success.
      - *Write-Behind (Write-Back):* The application writes to the cache immediately and asynchronously flushes changes to the database in background batches.
    - **NUTS Production Implementation:** NUTS uses **Cache-Aside** implemented in `CacheService.getOrSet(key, factoryFn, ttl)`:
      ```typescript
      async getOrSet<T>(key: string, factory: () => Promise<T>, ttlSeconds: number): Promise<T> {
        const cached = await this.redis.get(key);
        if (cached) return JSON.parse(cached);
        const fresh = await factory();
        await this.redis.set(key, JSON.stringify(fresh), 'EX', ttlSeconds);
        return fresh;
      }
      ```
    - **Architecture & Interview Takeaway:** *Cache-Aside ensures that only actively requested data occupies RAM. If the cache crashes, the application continues functioning by falling back directly to the primary database.*

34. **TTLs, Eviction Policies & Memory Sizing:**
    - **Concept & Foundation:** Memory is finite. Time-to-Live (TTL) ensures keys are removed after a set duration. When memory limits are reached (`maxmemory`), Redis evicts keys according to an eviction policy: `volatile-lru` (least recently used keys with TTL), `allkeys-lru`, or `noeviction` (rejects writes).
    - **NUTS Production Implementation:**
      - Strict TTL assignments:
        - Refresh token grace concurrency window: 15 seconds.
        - Ephemeral OTP verification codes: 10 minutes.
        - Category taxonomy tree: 24 hours (with event-driven bust).
        - Distributed cron locks: 45 seconds.
      - Configured with `maxmemory-policy: volatile-lru` to protect permanent configurations while evicting expired cache records cleanly.
    - **Architecture & Interview Takeaway:** *Never store unbounded keys in Redis without an explicit TTL. An unmanaged Redis instance will eventually exhaust RAM and reject new writes.*

35. **Cache Stampede (Thundering Herd) & Probabilistic Early Expiration:**
    - **Concept & Foundation:** When a popular cached key expires, thousands of concurrent user requests experience a cache miss simultaneously. All requests hit the database at the exact same instant to recompute the value, saturating CPU and crashing the database.
    - **NUTS Production Implementation:**
      - For expensive computations (like the hierarchical category tree), NUTS utilizes a **Distributed Mutex Lock**:
        - The first thread to encounter a cache miss acquires a 5-second Redis lock (`lock:categories:tree`).
        - Only that thread recomputes the tree from PostgreSQL and writes back to Redis.
        - Concurrent threads wait briefly or receive the last known cached representation rather than hammering the database.
    - **Architecture & Interview Takeaway:** *Protect heavy database read queries with locking or probabilistic early recomputation (XFetch) to prevent traffic spikes from causing cascading database failures upon cache expiration.*

36. **Distributed Mutual Exclusion Locks (Mutex / Redlock):**
    - **Concept & Foundation:** In a multi-replica application deployment, standard in-process locks (like JavaScript mutexes) only synchronize threads within a single container. Coordinating tasks across multiple containers requires a distributed locking mechanism.
    - **NUTS Production Implementation:**
      - `UnpaidOrdersCron` runs across multiple container replicas.
      - To prevent concurrent containers from canceling the same unpaid orders twice, the cron attempts to acquire an atomic distributed lock via Redis:
        `SET cron:lock:unpaid-orders <workerId> NX PX 45000`
      - Only the replica that successfully sets the key proceeds to execute the cancellation job; other replicas skip the iteration gracefully.
    - **Architecture & Interview Takeaway:** *Always use atomic `SET key value NX PX <milliseconds>` when implementing distributed mutexes. The `NX` ensures mutual exclusion, and `PX` ensures locks are automatically released if the holding worker crashes.*

37. **Redis Pub/Sub vs. Redis Streams vs. Message Brokers:**
    - **Concept & Foundation:**
      - *Redis Pub/Sub:* Fire-and-forget message broadcasting. If a subscriber is offline, the message is permanently lost (no persistence, no acknowledgements).
      - *Redis Streams:* Persistent, append-only log with consumer groups and offset tracking.
      - *RabbitMQ:* Dedicated enterprise message broker with persistent queues, complex routing topologies (topic, fanout, direct), consumer backpressure, and dead-letter handling.
    - **NUTS Production Implementation:**
      - **Redis Pub/Sub:** Used for ephemeral real-time SSE broadcasts across API cluster nodes (`notifications:stream`).
      - **RabbitMQ:** Used for mission-critical background jobs (Brevo email delivery, transactional notifications) where at-least-once delivery and retry queues are non-negotiable.
    - **Architecture & Interview Takeaway:** *Use Redis Pub/Sub for ephemeral, real-time broadcasts where dropped messages are acceptable (live UI badge updates). Use dedicated brokers like RabbitMQ for mission-critical transactional tasks.*

38. **Atomic Operations & Embedded Lua Scripting:**
    - **Concept & Foundation:** Redis processes individual commands atomically. However, multi-step operations (Read-Modify-Write) are subject to race conditions if interleaved with other commands. Embedded Lua scripts execute atomically inside Redis without interruption.
    - **NUTS Production Implementation:**
      - Refresh token grace verification evaluates whether a presented token is within the 15-second grace window atomically using Redis atomic key evaluations, eliminating token hijacking race conditions during multi-tab parallel browser reloads.
    - **Architecture & Interview Takeaway:** *When multiple Redis commands must execute as an indivisible unit without network round-trip interleaving, encapsulate them in an atomic Lua script.*

39. **Redis Persistence (RDB vs. AOF) & High-Availability Replication:**
    - **Concept & Foundation:**
      - *RDB (Redis Database Backup):* Point-in-time snapshots of the dataset written to disk at specified intervals. Low storage overhead, fast recovery, but risk of data loss between snapshots.
      - *AOF (Append Only File):* Logs every write operation received by the server. Provides maximum data durability (`fsync everysec`), but larger file size and slower restart recovery.
    - **NUTS Production Implementation:** In production environments, Redis is configured with hybrid persistence: periodic RDB snapshots combined with AOF append-only logging (`appendonly yes; appendfsync everysec`), ensuring minimal data loss during infrastructure reboots while maintaining sub-millisecond memory performance.
    - **Architecture & Interview Takeaway:** *For pure caching layers, persistence can be disabled to maximize throughput. For session and state stores, hybrid RDB + AOF ensures durability without sacrificing operational speed.*

---

### Part IV: Asynchronous Messaging & Event Reliability (RabbitMQ)

40. **Message Broker Architecture: Producers, Exchanges, Queues & Consumers:**
    - **Concept & Foundation:** Decouples message publishers from consumers via AMQP topology:
      - *Producer:* Application component creating and publishing messages.
      - *Exchange:* Routing engine inspecting message routing keys and headers.
      - *Queue:* FIFO buffer holding messages until consumed.
      - *Consumer:* Background worker reading messages from queues and executing tasks.
    - **NUTS Production Implementation:**
      - API controllers act as **Producers**, publishing events to topic exchange `nuts.events`.
      - RabbitMQ routes messages with routing key `email.transactional` to durable queue `q.nuts.emails`.
      - `EmailConsumerWorker` acts as the **Consumer**, processing Brevo transactional email dispatches in the background.
    - **Architecture & Interview Takeaway:** *Decoupling components through message brokers prevents slow third-party APIs (e.g. Brevo email latency) from degrading customer-facing HTTP response times.*

41. **Message Acknowledgements (ACK / NACK) & At-Least-Once Delivery:**
    - **Concept & Foundation:** Guarantees message delivery across unreliable networks. A consumer must explicitly acknowledge (`ACK`) message completion. If a worker crashes or errors, it issues a negative acknowledgement (`NACK`), prompting the broker to redeliver the message.
    - **NUTS Production Implementation:**
      - RabbitMQ consumer sets `noAck: false` (manual acknowledgements).
      - After the external email API returns a `2xx` success code, the worker executes `channel.ack(message)`.
      - If an unexpected error occurs, the worker issues `channel.nack(message, false, false)` to route the failure to a dead-letter queue rather than looping infinitely on the primary queue.
    - **Architecture & Interview Takeaway:** *Never use automatic acknowledgements (`noAck: true`) in mission-critical systems. Manual acknowledgements ensure messages are only cleared after work has actually succeeded.*

42. **Poison Messages, Exponential Backoff & Dead Letter Exchanges (DLX / DLQ):**
    - **Concept & Foundation:** A *poison message* is a malformed or invalid message that crashes the consumer every time it is processed. If requeued blindly, it creates an infinite crash loop. A Dead Letter Exchange (DLX) captures messages that have exceeded maximum retry attempts.
    - **NUTS Production Implementation:**
      - If email delivery fails, the worker tracks retry count in message headers (`x-retry-count`).
      - Retries follow exponential backoff intervals (2s, 4s, 8s, 16s).
      - If delivery fails after 5 attempts, the message is routed via dead-letter exchange `dlx.nuts` into `q.nuts.emails.dlq` for administrator inspection and manual replay.
    - **Architecture & Interview Takeaway:** *Every production queue must have a corresponding Dead Letter Queue (DLQ). Unhandled poison messages must never be allowed to block healthy queue traffic.*

43. **Consumer Prefetch, Congestion & Backpressure Management:**
    - **Concept & Foundation:** Without prefetch limits, a message broker pushes all pending messages in a queue to connected workers simultaneously. This floods worker memory and crashes Node.js processes during sudden message surges. Prefetch specifies the maximum number of unacknowledged messages a worker can hold.
    - **NUTS Production Implementation:**
      - The email worker explicitly sets `channel.prefetch(10)`.
      - The worker receives at most 10 email jobs concurrently. As each job completes and is acknowledged (`ACK`), the broker sends the next job, maintaining smooth memory usage and predictable throughput.
    - **Architecture & Interview Takeaway:** *Always configure consumer prefetch (`channel.prefetch`) to match worker concurrency limits. This applies backpressure to the broker and prevents worker Out-Of-Memory (OOM) crashes.*

44. **The Dual-Write Problem & The Transactional Outbox Pattern:**
    - **Concept & Foundation:** When an application must update a database and publish an event to a message broker in response to a business action, network partitions can cause one to succeed while the other fails. Updating the database but failing to publish leaves the system inconsistent; publishing first risks broadcasting events for transactions that subsequently roll back.
    - **NUTS Production Implementation:**
      - NUTS resolves the dual-write problem via the **Transactional Outbox Pattern**:
        1. When an order is created, the order record AND an `Outbox` event record are saved in the **same database transaction** (`prisma.$transaction`).
        2. If the transaction rolls back, neither record is persisted.
        3. A reliable background worker polls the `Outbox` table for unpublished events, publishes them to RabbitMQ, and marks them as `published: true` upon confirmed broker acknowledgement.
    - **Architecture & Interview Takeaway:** *Never attempt distributed dual-writes across heterogeneous systems without an Outbox or two-phase commit. Storing events in the local database transaction guarantees zero message loss.*

45. **Circuit Breaker Pattern & Cascading Failure Prevention:**
    - **Concept & Foundation:** When an external dependency (payment gateway, email API) experiences an outage, repeated synchronous calls tie up application threads, exhaust connection pools, and cause cascading system failures. A Circuit Breaker monitors failure rates and has three states:
      - *Closed:* Normal operation; traffic flows to external service.
      - *Open:* Failure threshold exceeded; calls fail immediately without touching the external service.
      - *Half-Open:* Probe requests test whether the external service has recovered.
    - **NUTS Production Implementation:**
      - `CircuitBreakerService` wraps outgoing Brevo API calls.
      - If the error rate exceeds 50% over a 1-minute rolling window, the circuit trips to **Open** for 30 seconds. Outgoing email requests fail fast to the background retry queue, protecting API worker threads from blocking indefinitely.
    - **Architecture & Interview Takeaway:** *Fail fast when downstream dependencies collapse. Circuit breakers isolate external outages and prevent them from dragging down your core application.*

---

### Part V: Application Security & Cyber Defense Shield

46. **Broken Object Level Authorization (BOLA / IDOR):**
    - **Concept & Foundation:** Insecure Direct Object References (IDOR/BOLA) occur when an API endpoint uses user-supplied IDs to retrieve database objects without verifying that the authenticated user owns that specific resource (e.g. User A accessing `GET /api/v1/orders/1234` belonging to User B).
    - **NUTS Production Implementation:**
      - NUTS enforces strict **Multi-Tenant Query Scoping** across all services:
        - Customer order queries: `prisma.orders.findFirst({ where: { id: orderId, userId: currentUser.id } })`.
        - Vendor product updates: `prisma.products.updateMany({ where: { id: productId, vendorId: currentVendor.id }, data: ... })`.
      - If an ID exists but belongs to another entity, the query returns `null`, prompting a standard `404 Not Found` rather than leaking resource existence.
    - **Architecture & Interview Takeaway:** *Never rely purely on resource IDs passed in request parameters. Always scope database queries with the authenticated user ID extracted from verified session claims.*

47. **Cross-Site Scripting (XSS) & Content Security Policy (CSP):**
    - **Concept & Foundation:** XSS allows attackers to inject malicious scripts into trusted web pages, stealing cookies, session tokens, or altering DOM contents.
    - **NUTS Production Implementation:**
      - **Zero-Storage of Sensitive Tokens:** Access tokens are stored in in-memory JavaScript closures; refresh tokens are stored in `HttpOnly` cookies completely inaccessible to JavaScript (`document.cookie`).
      - **Dynamic CSP Noncing:** Next.js edge middleware generates a unique cryptographic nonce per request using Web Crypto (`crypto.randomUUID()`), applied to inline scripts and style headers (`script-src 'self' 'nonce-...'`).
    - **Architecture & Interview Takeaway:** *`HttpOnly` cookies neutralize XSS cookie-theft attacks. A strict Content Security Policy (CSP) with cryptographic nonces prevents injected inline scripts from executing.*

48. **Server-Side Request Forgery (SSRF) & Whitelist Egress Defense:**
    - **Concept & Foundation:** SSRF occurs when an attacker tricks the server into making HTTP requests to arbitrary URLs, potentially accessing internal cloud metadata endpoints (`http://169.254.169.254`), internal databases, or local intranet services.
    - **NUTS Production Implementation:**
      - Media uploads and remote image transformations validate target URLs against strict whitelists:
        - Protocols are restricted to `https:`.
        - Hostnames must match verified CDN endpoints (`res.cloudinary.com`).
        - Private IP ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.1`) are strictly rejected before outbound HTTP requests are dispatched.
    - **Architecture & Interview Takeaway:** *Never execute outbound HTTP requests to user-supplied URLs without verifying protocol schemes, validating domain whitelists, and resolving DNS to block private loopback and link-local IP addresses.*

49. **Replay Attacks & Cryptographic Signatures (HMAC-SHA512):**
    - **Concept & Foundation:** A replay attack occurs when an attacker intercepts a valid network transmission and re-transmits it to execute the action again (e.g. re-sending a payment confirmation webhook to receive duplicate credits).
    - **NUTS Production Implementation:**
      - Paystack payment webhooks require raw payload verification against an `x-paystack-signature` header:
        ```typescript
        const hash = crypto
          .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
          .update(rawBodyBuffer)
          .digest('hex');
        if (hash !== signature) throw new UnauthorizedException('Invalid signature');
        ```
      - Webhook events are processed idempotently based on event timestamps and unique transaction references. Duplicate webhook payloads are rejected.
    - **Architecture & Interview Takeaway:** *Always verify webhook signatures using raw, unparsed request body buffers. Parsing JSON before signature calculation can alter whitespace or key ordering, breaking cryptographic hashes.*

50. **Prototype Pollution & DTO Object Sanitization:**
    - **Concept & Foundation:** JavaScript objects inherit properties from `Object.prototype`. Prototype pollution occurs when unsanitized user inputs inject properties into `__proto__`, altering application behavior globally and leading to Denial of Service or Remote Code Execution.
    - **NUTS Production Implementation:**
      - Inbound JSON payloads are processed through NestJS `ValidationPipe` with `class-transformer`.
      - Payloads are instantiated into strictly typed class instances, automatically stripping `__proto__` and constructor properties before reaching application controllers.
    - **Architecture & Interview Takeaway:** *Enforce strict input serialization and whitelisting at the HTTP boundary. Never pass unvalidated raw JSON objects directly into deep object merge functions.*

---

### Part VI: Software Quality, Testing & CI/CD Gates

51. **The Test Pyramid: Unit, Integration & End-to-End (E2E) Testing:**
    - **Concept & Foundation:** A balanced test suite follows the testing pyramid:
      - *Unit Tests (Base):* Fast, isolated tests mocking dependencies, verifying individual business logic methods.
      - *Integration Tests (Middle):* Tests verifying interactions between services, real database adapters, and cache layers.
      - *E2E Tests (Top):* High-fidelity tests simulating complete user journeys from HTTP request to database persistence.
    - **NUTS Production Implementation:**
      - **Unit Tests (`*.spec.ts`):** Complete test suites for `CartService`, `OrdersService`, `UnpaidOrdersCron`, and `GlobalExceptionFilter` using mocked Prisma clients.
      - **Integration Tests:** Authentication session tests verifying real cookie headers, Redis sliding-window throttlers, and grace period expirations.
      - **E2E Tests:** Complete checkout flows verifying stock decrement conflict handling and payment webhook processing.
    - **Architecture & Interview Takeaway:** *Unit tests give fast feedback on business algorithms; integration tests catch database query and schema regressions; E2E tests ensure critical revenue workflows function end-to-end.*

52. **Mocking, Fakes & Database Sandbox Isolation:**
    - **Concept & Foundation:** Tests must be deterministic and independent. Tests that mutate shared database state can interfere with one another, causing flaky failures. Mocking replaces external dependencies with controlled fakes.
    - **NUTS Production Implementation:**
      - Unit tests use `jest-mock-extended` to create type-safe deep mocks of Prisma and Redis clients.
      - Database integration tests run against ephemeral test databases where each test suite executes within isolated transactions that roll back upon test completion, ensuring pristine test state.
    - **Architecture & Interview Takeaway:** *Never point automated test suites at shared persistent staging databases. Tests must be isolated, idempotent, and capable of executing concurrently in any order.*

53. **Monorepo CI/CD Pipeline & Quality Gates:**
    - **Concept & Foundation:** Continuous Integration (CI) enforces automated quality gates on every Pull Request, preventing regressions, linting violations, type errors, or broken builds from reaching main branches.
    - **NUTS Production Implementation:**
      - GitHub Actions workflow (`.github/workflows/ci.yml`) enforces 5 mandatory quality gates:
        1. **Lockfile Integrity:** Verifies `package-lock.json` matches dependencies without unexpected modifications.
        2. **Linting & Code Quality:** Runs `eslint` and `prettier` across `apps/api`, `apps/web`, and shared packages.
        3. **Typechecking:** Runs `tsc --noEmit` across all workspace projects, ensuring zero TypeScript compilation errors.
        4. **Backend Validation Tests:** Executes Jest test suites across the API domain services.
        5. **Frontend Build Verification:** Executes Next.js production build (`next build`), ensuring static generation and route configurations compile cleanly.
    - **Architecture & Interview Takeaway:** *Branch protection rules paired with automated CI quality gates ensure that bad code cannot be merged into shared staging or production branches.*

---

## 5. Local Development & Quickstart

### Prerequisites
- Node.js 22+
- Docker & Docker Compose
- npm 11+

### Step 1: Clone & Install Dependencies
```bash
git clone https://github.com/UGOCHUKWU1124/nuts-platform.git
cd nuts-platform
npm install
```

### Step 2: Boot Infrastructure & Database
```bash
# Starts local PostgreSQL, Redis, and RabbitMQ
npm run db:up

# Run Prisma schema migrations
npm run migrate:deploy
```

### Step 3: Run Development Server
```bash
# Runs both NestJS API (port 3001) and Next.js Storefront (port 3000) with Turbopack
npm run dev
```

Visit the storefront at `http://localhost:3000` and Swagger docs at `http://localhost:3001/api/docs`.

---

## 6. Environment Variables Reference

| Variable | Description | Example / Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL transaction-mode connection pooler URL | `postgresql://user:pass@host:6543/db?pgbouncer=true` |
| `DIRECT_URL` | PostgreSQL direct session connection (for migrations) | `postgresql://user:pass@host:5432/db` |
| `REDIS_URL` | Redis in-memory cache and session store | `rediss://default:token@endpoint.upstash.io:6379` |
| `RABBITMQ_URL` | AMQP connection string for message broker | `amqps://user:pass@host.cloudamqp.com/vhost` |
| `JWT_SECRET` | 32+ character cryptographic secret for access tokens | `min-32-chars-secret-key-here` |
| `JWT_REFRESH_SECRET` | 32+ character cryptographic secret for refresh tokens | `min-32-chars-refresh-secret-here` |
| `PAYSTACK_SECRET_KEY` | Paystack merchant secret key | `sk_test_...` / `sk_live_...` |
| `BREVO_API_KEY` | Brevo transactional email delivery API key | `xkeysib-...` |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary CDN bucket name | `your_cloud_name` |