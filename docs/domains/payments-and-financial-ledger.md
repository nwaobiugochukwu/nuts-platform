# Payments and Financial Ledger

> **Scope:** Provider payment confirmation, full refunds, vendor settlement, and customer/vendor wallet accounting. The [domain index](README.md) maps this guide to its owning API modules; the [backend module map](../reference/backend-module-map.md) provides source and frontend navigation. Current behavior and proposed scale work are labeled separately.

## Domain boundary and outcomes

Provider payment confirmation, full refunds, vendor settlement, and customer/vendor wallet accounting.

<a id="payments-and-financial-ledger-design"></a>
## Payments and Financial Ledger: end-to-end design

### Domain model and actors
Manages payment gateway interactions (Paystack), handles asynchronous order settlement, governs vendor escrow accounts, enforces non-repudiable financial audit logging, and cleans up abandoned inventory holds.

### Problems and controls
- **Dropped Payment Redirects & Lost Purchases:**
  - *The Failure Mode:* Customers complete payment on the gateway but close their browser, lose internet connection, or experience an error before returning to the `/order-success` callback URL, leaving the order without a browser-side confirmation.
  - *How NUTS Solves It:* Payment settlement is driven by the server-side Paystack webhook/callback flow, not by the browser return. The API verifies the transaction with Paystack when available and can use a valid signed webhook payload if provider verification times out; it then applies the payment/order transition transactionally, without requiring the customer to finish the redirect.
- **Duplicate Payment Processing & Webhook Replays:**
  - *The Failure Mode:* Payment gateways retry webhooks on transient network timeouts, which could credit vendor wallets multiple times or generate duplicate fulfillment events.
  - *How NUTS Solved It:* Built an idempotent state machine on the order payment reference. If an incoming webhook arrives for an order that is already in `PROCESSING` or `PAID` state, the handler logs the duplicate and immediately returns `200 OK` without re-executing ledger updates or event publishing.
- **Abandoned Inventory Holds:**
  - *The Failure Mode:* Shoppers initiate checkout but abandon the Paystack payment window, leaving inventory reserved and preventing other customers from purchasing.
  - *How NUTS Solved It:* Engineered an automated distributed sweeper (`UnpaidOrdersCron`) running every **5 minutes** under a Redis lock (`cron:lock:unpaid-orders`, 4-minute TTL). The default payment window is **15 minutes**, configurable from 5 to 120 minutes. Each run handles up to 100 eligible orders and excludes orders older than 7 days; cancellation rechecks order/payment state before restoring reserved inventory.
- **Premature Merchant Payouts & Marketplace Exposure:**
  - *The Failure Mode:* Vendors withdrawing sales revenue immediately upon checkout, leaving the platform liable for buyer refunds if goods are never shipped or delivered.
  - *How NUTS Solved It:* Implemented a two-phase escrow ledger: 85% of order funds are initially locked in `pendingBalance`. Funds only transfer to available `balance` when the buyer or carrier confirms delivery status as `DELIVERED`.
- **Audit Trail Immutability for Critical Financial & Discount Transitions:**
  - *The Failure Mode:* High-consequence financial mutations (payment confirmations, refunds) and promotional discount adjustments executing without tamper-evident audit records, creating accounting discrepancies, operational risk, or vendor disputes.
  - *How NUTS Solved It:* Integrated transactional `AuditLog` generation directly within the database transactions for `PAYMENT_REFUNDED`, `PAYMENT_CONFIRMED`, and across `DiscountCodeService` mutations (`DISCOUNT_CODE_CREATED`, `DISCOUNT_CODE_UPDATED`, `DISCOUNT_CODE_DEACTIVATED`, `DISCOUNT_CODE_REACTIVATED`, `DISCOUNT_CODE_DELETED`). If the transaction fails, the audit record is rolled back; if committed, the financial trace is immutably persisted alongside order, user, and admin actor IDs.

### Current backend mechanism
- **Timing-Safe Webhook Verification:** Paystack webhooks are verified using a timing-safe `crypto.timingSafeEqual` check on the `x-paystack-signature` header against an HMAC-SHA512 digest of the raw request buffer.
- **Paystack IP Whitelisting (`PaystackIpMiddleware`):** Verifies incoming webhooks against official Paystack CIDR blocks in production (`52.31.139.75`, `52.49.173.169`, `52.214.14.220`) with reverse-proxy `x-forwarded-for` client extraction.
- **Canonical Payment Namespace:** Standardized onto `/payments` (`/payments/initialize`, `/payments/callback`, `/payments/webhook`, `/payments/order/:orderId`), deprecating ambiguous aliases.
- **Asynchronous State Machine:**
  - Order created: Status set to `PENDING`.
  - Webhook received (`charge.success`): State transitions atomically `PENDING -> PROCESSING`.
  - Duplicate webhooks receive `200 OK` immediately without re-executing business logic.
- **Two-Phase Escrow Release:**
  - When payment succeeds, **85%** of the item total is credited to the vendor's `pendingBalance`.
  - When the customer confirms delivery or the carrier status updates to `DELIVERED`, the funds transfer from `pendingBalance` to available `balance` for payout.
- **Unpaid Order Cleanup Sweeper (`UnpaidOrdersCron`):**
  - Runs every **5 minutes** (`*/5 * * * *`) in Africa/Lagos time.
  - Acquires `cron:lock:unpaid-orders` with a unique owner token and a **4-minute** Redis TTL.
  - Uses a default **15-minute** payment window configurable from 5 to 120 minutes, processes at most 100 orders per run, and ignores orders older than 7 days.
  - Restores reserved stock and cancels each still-eligible order through the order service.

### Frontend experience and flow
- **Paystack Pop / Gateway Redirect (`CheckoutFlow`):** Launches Paystack payment modal or redirect; tracks transaction reference in session storage.
- **Payment Verification Polling (`/order-success`):** If user returns before webhook arrives, client polls order status up to 5 times (2-second interval) before displaying success.
- **Vendor Wallet Dashboard (`VendorWalletView`):** Shows clear visual distinction between *Pending Escrow* and *Available Balance* with transaction ledger.

### Domain terminology
- **HMAC (Hash-based Message Authentication Code):** A cryptographic signature that proves a message came from Paystack and wasn't altered in transit.
- **Idempotency:** An operation that can be applied multiple times without changing the result beyond the initial application.
- **Escrow:** Holding funds in a secure intermediate state until contractual obligations (order delivery) are fulfilled.

### Failure scenarios and edge cases
- Webhook arrives before client redirect completes.
- Customer payment fails or is rejected by their issuing bank.
- Distributed cron multi-instance overlap (prevented via Redis lock token).
- Partial refunds and post-shipment returns are unsupported; a refund only changes payment, order, stock, and vendor earnings after Paystack reports it as processed.

### Trade-offs and design considerations
- *Webhooks must be the definitive source of truth for payment status, not client-side redirects.*
- *Release marketplace vendor funds via two-phase escrow tied strictly to delivery state.*
- *Protect automated database cron sweepers with distributed Redis locks to prevent multi-container cluster duplication.*

---

## Cross-application behavior and integration contracts

- Payment confirmation verifies Paystack before settlement. A captured payment that cannot transition its order into processing is recorded for reconciliation and does not credit vendor earnings. Vendor earnings remain pending until delivery.

- Full refund requests create a durable attempt and stable Paystack reference. The API returns `202` while a refund is pending; shipment is blocked, and payment, stock, and vendor-earnings changes occur only after `refund.processed`. `refund.failed` restores the prior order/payment state. Partial refunds and post-shipment returns are not supported.

## Implementation details by capability

The sections below describe each capability’s problem, current API mechanism, failure cases, and trade-offs. The [backend module map](../reference/backend-module-map.md) provides folder and source navigation.

### Payment and refund lifecycle

Browser redirects alone cannot establish payment truth; duplicate webhooks and delayed refunds must not double-credit wallets or reverse inventory early.

#### Current backend mechanism

The API verifies Paystack events and signatures over the raw request body. Full refund attempts are durable, and settlement/reversal follows provider-confirmed states. See [Domain 4](payments-and-financial-ledger.md#payments-and-financial-ledger-design).

#### Failure scenarios and trade-offs

A captured payment that cannot advance its order is withheld from vendor earnings and requires reconciliation. `needs-attention` refunds still need an operator path. Keep partial refunds and returns as explicit product/policy decisions.

### Customer and vendor ledgers

Customer and vendor balances require decimal-safe accounting and traceable reasons for every credit/debit.

#### Current backend mechanism

Separate user/vendor controllers call shared wallet services; transaction records link balance changes to order/payment/referral reasons. Vendor earnings remain pending until the applicable order state permits settlement.

#### Failure scenarios and trade-offs

Provider retries and duplicate business events must not duplicate a ledger credit. Reconciliation against payments and orders, plus database-enforced idempotency, should remain a release and scale concern.

## Scaling and traffic direction

The [Scaling Strategy](../scaling/README.md#payments-and-financial-ledgers) contains the staged concurrency, traffic, and growth recommendations for this domain. Scale provider retries, reconciliation, and wallet processing with durable state, idempotency, and operator recovery.
