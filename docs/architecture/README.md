# NUTS Architecture Diagrams

This page is the visual architecture reference. Captions identify the view and link to the domain guide with implementation details. **Solid lines show current behavior; dashed lines show an external boundary or a proposed path.** The diagrams are versioned with the repository; update the relevant view when its implementation changes.

## 1. System context and runtime — current

```mermaid
flowchart LR
    Customer[Customer] --> Web[Next.js web app]
    Vendor[Vendor] --> Web
    Admin[Platform admin] --> Web
    Web -->|HTTP /api/v1| API[NestJS modular monolith]
    API --> PG[(PostgreSQL / Prisma)]
    API --> Redis[(Redis)]
    API --> Broker[RabbitMQ]
    API --> Paystack[Paystack]
    API --> Media[Cloudinary]
    API --> Email[Brevo email API]
    API -->|SSE notification stream| Web
```

The API modules share one process and commerce database. See the [platform guide](../platform/runtime-and-data.md) and [backend module map](../reference/backend-module-map.md).

## 2. Deployment and release boundary — current

```mermaid
flowchart LR
    Source[Git commit] --> CI[GitHub Actions CI]
    CI -->|build and publish| Registry[GHCR image registry]
    Registry -. image selected by external host process .-> Host[Hosting environment]
    Host --> Compose[Production Compose profile]
    Compose --> Proxy[Nginx / TLS edge]
    Proxy --> Web[Web container]
    Proxy --> API[API container]
    Compose --> Migration[One-off API migration job]
    Migration --> DB[(PostgreSQL)]
    API --> DB
    API --> Redis[(Redis)]
    API --> Broker[RabbitMQ]
```

The repository workflow publishes images; host rollout and live verification are external operational steps. See [release and recovery](../operations/runbooks/release-and-recovery.md).

## 3. Browser identity and session boundary — current

```mermaid
sequenceDiagram
    actor Shopper
    participant Browser
    participant Web as Next.js app
    participant API as NestJS API
    participant DB as PostgreSQL
    Shopper->>Browser: Submit role-specific credentials
    Browser->>API: Login or verified Google ID token
    API->>DB: Validate account, role, approval, and session state
    API-->>Browser: Access and rotating refresh cookies
    API-->>Browser: CSRF cookie for cookie-authenticated writes
    Browser->>API: Write request with CSRF cookie/header pair
    API->>DB: Enforce role-scoped operation
    API-->>Browser: Authorized response
```

Vendor sessions require an active, approved vendor. See [Identity, Accounts, and Security](../domains/identity-and-account-security.md).

## 4. Checkout, payment, and refund lifecycle — current

```mermaid
sequenceDiagram
    actor Shopper
    participant Web as Web app
    participant API as API
    participant DB as PostgreSQL
    participant PSP as Paystack
    Shopper->>Web: Submit checkout
    Web->>API: Create order with idempotency key
    API->>DB: Revalidate price and stock; persist order and inventory change
    API-->>Web: Order and payment initialization
    Web->>API: Start payment
    API->>PSP: Initialize payment
    PSP-->>Web: Provider checkout
    PSP->>API: Signed payment webhook
    API->>PSP: Verify provider transaction and amount
    API->>DB: Settle payment and advance valid order state
    API->>DB: Credit vendor earnings as pending
    Shopper->>API: Request full refund
    API->>DB: Persist refund attempt and stable provider reference
    API->>PSP: Request refund
    PSP->>API: Signed refund event or reconciliation result
    API->>DB: On refund.processed, reverse settlement and restore stock
```

Payment confirmation and refunds have explicit failure and reconciliation paths. See [Shopping, Promotions, and Orders](../domains/shopping-promotions-and-orders.md) and [Payments and Financial Ledger](../domains/payments-and-financial-ledger.md).

## 5. Transactional outbox and notification delivery — current

```mermaid
flowchart LR
    Change[Business command] --> Tx[PostgreSQL transaction]
    Tx --> State[Domain state change]
    Tx --> Outbox[Outbox event]
    Outbox --> Relay[Outbox relay]
    Relay -->|confirmed publish| Broker[RabbitMQ]
    Broker --> Consumer[Event consumer]
    Consumer --> Inbox[Notification row with dedupe key]
    Inbox --> SSE[SSE stream]
    SSE --> Browser[Web client]
    Broker -. consumer failure .-> DLQ[Shared durable dead-letter queue]
```

The outbox covers selected business events and delivers at least once. Consumer failure and outbox publish failure are separate recovery stages. See [Notifications and Asynchronous Delivery](../domains/notifications-and-async-delivery.md).

## 6. Analytics and recommendation signals — current and proposed

```mermaid
flowchart LR
    Browser[Web activity] --> API[NestJS API]
    API -->|recent history upsert| PG[(PostgreSQL)]
    API -->|raw product-view buffer| Redis[(Redis list)]
    Redis -->|periodic batches| Rabbit[RabbitMQ]
    Rabbit --> Consumer[Analytics consumer]
    Consumer --> PG
    API -->|other marketplace and recommendation events| PG
    PG --> Reports[Admin and vendor reports]
    Reports -->|polling| Browser
    PG --> Ranker[Deterministic recommendation logic]
    Ranker --> Shelves[Home, discovery, and product surfaces]
    Events[Higher-quality impressions and outcomes] -. proposed .-> Eval[Offline and online evaluation]
    Eval -. proposed .-> Model[Optional bounded ML ranker]
    Model -. timeout fallback .-> Ranker
```

The Redis/RabbitMQ path applies to product views; other event types can write directly to PostgreSQL. The ML path is proposed and has no trained model in the current system. See [Analytics and Measurement](../domains/analytics-and-measurement.md), [Discovery and Personalization](../domains/discovery-and-personalization.md), and the [recommendation scaling plan](../scaling/recommendations.md).

## Related references

- [Domain guides](../domains/README.md)
- [Platform Runtime and Data](../platform/runtime-and-data.md)
- [Architecture decisions](adr/README.md)
