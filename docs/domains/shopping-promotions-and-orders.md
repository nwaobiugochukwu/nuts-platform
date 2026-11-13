# Shopping, Promotions, and Orders

> **Scope:** Cart state, promotion eligibility, authoritative checkout validation, and order lifecycle. The [domain index](README.md) maps this guide to its owning API modules; the [backend module map](../reference/backend-module-map.md) provides source and frontend navigation. Current behavior and proposed scale work are labeled separately.

## Domain boundary and outcomes

Cart state, promotion eligibility, authoritative checkout validation, and order lifecycle.

<a id="shopping-promotions-and-orders-design"></a>
## Shopping, Promotions, and Orders: end-to-end design

### Domain model and actors
Coordinates cart item modifications, real-time variant selections, candidate cart selection, and atomic order creation with inventory reservations.

### Problems and controls
- **Flash-Sale Inventory Overselling & Double Allocation:**
  - *The Failure Mode:* Multiple shoppers checking out the final item in stock at the exact same millisecond. Traditional in-memory checks read `stock = 1` for all transactions, allowing all to succeed and driving physical inventory into negative numbers.
  - *How NUTS Solved It:* Replaced in-memory validation with database-level atomic conditional SQL decrements inside an active transaction:
    ```sql
    UPDATE products SET stock = stock - :qty WHERE id = :id AND stock >= :qty;
    ```
    If the modified row count is zero, stock has been depleted. The transaction immediately rolls back and throws `409 Conflict` (`INSUFFICIENT_STOCK`) with a payload identifying the exact conflicting items.
- **Circular Database Deadlocks (`SQLSTATE 40P01`):**
  - *The Failure Mode:* Two shoppers checking out overlapping items in opposing order (Tx 1 locks Item A, waits for Item B; Tx 2 locks Item B, waits for Item A). PostgreSQL detects a circular dependency and violently terminates one transaction with error `40P01`.
  - *How NUTS Solved It:* Checkout sorts stock mutations by the affected variant or product ID before acquiring stock row locks. This reduces opposing lock order among checkout transactions that touch the same stock rows. It does not rule out every database deadlock involving other tables, indexes, or code paths; PostgreSQL deadlock detection remains necessary.
- **Ghost Cart Collisions & Multi-Session Desynchronization:**
  - *The Failure Mode:* Users opening multiple browser tabs or logging in across devices generate multiple cart records. Checkout naively picking the newest cart selects an empty orphan, resulting in false "Empty Cart" checkout rejections.
  - *How NUTS Solved It:* Implemented candidate cart evaluation in [`OrdersService`](../../apps/api/src/modules/orders/orders.service.ts). The service acquires pessimistic row locks (`FOR UPDATE`) across all open carts for the user, evaluates them in-memory to select the active cart containing items (`cartItems.length > 0`), executes checkout, and prunes empty orphan carts in the same atomic SQL commit.

### Current backend mechanism
- **Lexicographical Lock Sorting:** Before stock changes, checkout sorts affected variant/product rows by ID. Consistent ordering reduces checkout-to-checkout deadlock risk for shared stock rows, but does not prove that all transactions across the database are deadlock-free.
- **Pessimistic Row Locking (`FOR UPDATE`):** The user's active cart rows are locked inside an atomic database transaction.
- **Atomic Conditional SQL Decrement:**
  ```sql
  UPDATE products SET stock = stock - :qty WHERE id = :id AND stock >= :qty;
  ```
  If zero rows are modified, checkout immediately rolls back and throws an HTTP `409 Conflict` (`INSUFFICIENT_STOCK`) with a payload identifying the exact conflicting items.
- **Candidate Cart Pruning:** Empty orphan carts are deleted in the same transaction, and the Redis cart cache (`user:cart:v3:${userId}`) is evicted.

### Frontend experience and flow
- **Zustand Cart Drawer (`ShoppingDrawer`):** Real-time sliding drawer with optimistic quantity updates and debounced server sync (300ms).
- **Stock Conflict Modal (`StockConflictModal`):** If checkout encounters a `409 INSUFFICIENT_STOCK`, this dialog displays the out-of-stock items, adjusts the cart quantity to available stock automatically, and lets the user proceed without restarting checkout.
- **Variant Selector (`ProductVariantBuilder`):** Interactive matrix selector disabling out-of-stock attribute combinations in real time.

### Domain terminology
- **Pessimistic Locking (`FOR UPDATE`):** An explicit database lock ensuring no other transaction can read or modify a row until the holding transaction completes.
- **Deadlock (`40P01`):** Two or more database transactions waiting for locks held by each other, frozen indefinitely until PostgreSQL terminates one.
- **TOCTOU (Time-of-Check to Time-of-Use):** A race condition where data is checked in one step and modified in a later step, during which another process altered the data.

### Failure scenarios and edge cases
- Concurrently purchasing the final item in stock.
- Stale price changes during active checkout sessions (re-validated at transaction start).
- Inactive or deleted products in cart items.
- Variant stock exhaustions vs main product stock exhaustions.

### Trade-offs and design considerations
- *Sort shared stock-row lock acquisition consistently to reduce checkout deadlocks; retain PostgreSQL deadlock detection because this cannot prevent every deadlock across all code paths.*
- *Use database-level atomic conditional updates (`WHERE stock >= :qty`) rather than in-memory checks to prevent overselling.*

---

## Cross-application behavior and integration contracts

### Checkout integration with payments

Checkout creates an order and reserves/decrements inventory inside a database transaction. An idempotency key protects order creation retries. Paystack initialization stores a transaction reference; the server verifies provider status, amount, and currency before marking payment successful.

Payment success and the order transition to PROCESSING are coordinated in a transaction. Vendor earnings are credited to pending balances only when the order moves from PENDING to PROCESSING. If Paystack confirms a capture after the order has become non-pending, the API records an audit entry and does not credit vendors; operations must reconcile or refund that capture.

Full refunds create a `PaymentRefund` row and stable Paystack reference before the provider request. The API returns `202` and keeps both payment and order in `REFUND_PENDING`; this blocks shipment while Paystack is processing the request. Signed refund webhooks update the attempt, and a five-minute reconciler fetches the same provider reference and retries safely after timeouts. Only `refund.processed` changes payment/order to `REFUNDED`, restores stock, and reverses vendor earnings with a matching commission ledger entry. A definitive `refund.failed` restores the prior payment/order state. Partial refunds and refunds after shipment remain unsupported because they need item-level allocation, returns, and settled-earnings reversal rules.

## Implementation details by capability

The sections below describe each capability’s problem, current API mechanism, failure cases, and trade-offs. The [backend module map](../reference/backend-module-map.md) provides folder and source navigation.

### Cart state and checkout validation

Customers need cart changes to remain scoped to their account/session, while checkout must not trust stale client prices or stock.

#### Current backend mechanism

Cart endpoints and service own cart mutations; checkout revalidates product/variant price and inventory at the order boundary. The full cart/checkout transaction design is in [Domain 3](shopping-promotions-and-orders.md#shopping-promotions-and-orders-design).

#### Failure scenarios and trade-offs

A stock conflict returns a structured conflict for the client to recover from; the database remains authoritative when cart state is stale. Keep lock ordering and transaction duration under review as checkout concurrency grows.

### Promotion eligibility

Vendors and admins need scoped promotions while checkout must enforce dates, eligibility, usage limits, and calculated totals on trusted server data.

#### Current backend mechanism

Admin and vendor controllers manage discount codes; checkout-side services validate and apply them. The API owns the final calculation rather than accepting a client-supplied discount total.

#### Failure scenarios and trade-offs

Concurrent redemptions can race usage limits, so limit enforcement and usage records need to share a safe transaction boundary. Add load/concurrency coverage before increasing promotion complexity.

### Order lifecycle

Checkout, fulfillment, cancellation, payment, and refunds must move orders through valid states without losing customer/vendor ownership boundaries.

#### Current backend mechanism

Customer, vendor, and admin controllers expose scoped order workflows; services own transitions and inventory/settlement coordination. See [Domain 3](shopping-promotions-and-orders.md#shopping-promotions-and-orders-design) and [Domain 4](payments-and-financial-ledger.md#payments-and-financial-ledger-design) for checkout and payment interactions.

#### Failure scenarios and trade-offs

State changes must be idempotent and transactional where they affect stock or money. Late captures and refund exceptions need explicit operator resolution; partial refunds and post-shipment returns are not currently supported.

## Scaling and traffic direction

The [Scaling Strategy](../scaling/README.md#checkout-inventory-promotions-and-orders) contains the staged concurrency, traffic, and growth recommendations for this domain. Scale checkout concurrency while preserving atomic inventory, promotion limits, order idempotency, and auditable state transitions.
