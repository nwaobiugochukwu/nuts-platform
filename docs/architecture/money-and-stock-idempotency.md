# Money and stock: what happens when a request or event repeats

Every write that moves money or stock can be sent twice: a customer double-clicks, a response is lost
and the client retries, Paystack repeats a webhook, RabbitMQ redelivers, an operator replays a dead
letter. This page lists each such write, what makes the second one harmless, and the test that proves
it. It was produced by reading the code (roadmap 6.6); a guard listed here without a test is a gap.

The patterns, strongest first:

1. **A conditional update is the gate.** `UPDATE ... WHERE status = <what I read>` changes at most one
   row, so of two concurrent attempts only one wins and the other changes nothing.
2. **The database refuses the duplicate.** A unique key or index (`(userId, idempotencyKey)`,
   `transactionReference`, `providerReference`, the wallet ledger's once-only indexes).
3. **A recorded id.** The request or message carries an id; the first one records it in the same
   transaction as the work, and a repeat finds it and does nothing.

## The writes

| Write | What makes a repeat harmless | Proven by |
|---|---|---|
| **Checkout** (order, lines, payment row, stock, vouchers) | One transaction. `(userId, idempotencyKey)` is unique, the cart is locked `FOR UPDATE`, a repeat returns the same order, and a simultaneous repeat that loses the race reads the winner's order. | `order-checkout.service.spec.ts` (replay, race, conflict) |
| **Stock taken at checkout** | `UPDATE ... SET stock = stock - n WHERE stock >= n`, in the order's transaction, in a fixed row order. It can never go below zero and rolls back with the order. | `order-checkout.service.spec.ts` (stock) |
| **Payment initialisation** | `orderId` is unique on the payment; a retry returns the stored link and reference instead of asking Paystack again. | `payment-initialization.spec.ts` (retry returns the stored link; refused states; free orders) |
| **Payment confirmation** | Gate 1: the payment moves `PENDING → SUCCESS` by conditional update; only the delivery that wins goes on to start the order, credit vendors and queue notices. Webhooks are also de-duplicated on arrival (webhook inbox). | `payment-confirmation.service.spec.ts` ("loses the race", "already settled") |
| **Vendor earnings credited** (`SALE`) | Only the confirmation that won the gate reaches the credit. As a backstop the ledger itself allows one `SALE` credit per vendor wallet per order. | confirmation spec; ledger index (below) |
| **Order status change** | Conditional update on the status that was read; a concurrent change returns a conflict. Cancelling a paid order is refused (it must be refunded). | `order-status.service.spec.ts` |
| **Vendor settlement on delivery** (`COMMISSION`) | Happens inside the status change that won, and settles exactly what was credited. One `COMMISSION` entry per vendor per order at the ledger. | `order-status.service.spec.ts`; ledger index |
| **Stock put back** (cancel, refund) | The order's `stockRestored` flag is claimed in the same transaction; a second restore finds it set. | `order-status.service.spec.ts`, `payment-refunds.service.spec.ts` |
| **Voucher used / released** | Recorded in the checkout transaction. Release deletes the usage rows and only decrements counters for rows it actually deleted. | `order-checkout.service.spec.ts`; `releaseDiscountUsage` |
| **Refund request** | The payment (`SUCCESS → REFUND_PENDING`) and the order are claimed by conditional update; the Paystack reference is saved first and reused on every retry, and Paystack is asked whether it already has that reference before a refund is created. | `payment-refunds.service.spec.ts` ("does not claim twice") |
| **Refund settled** | The refund is claimed (`active → PROCESSED`) by conditional update; payment, order, stock, vendor wallet reversal, voucher release, audit and the customer's notice all commit together or not at all. One `REFUND` ledger entry per vendor per order. | `payment-refunds.service.spec.ts` ("already settled", "claimed first", mismatched amounts); ledger index |
| **Referral reward** | The referral row is claimed (`rewardGranted`) under a Serializable transaction with retries; one `REFERRAL` credit per wallet per referral at the ledger. | `referral.service.spec.ts`, `referral-reward.consumer.spec.ts`; ledger index |
| **Inventory adjustment by queue** | `ProcessedEventService.runOnce` records the message id; redelivery is skipped. | `inventory.consumer.spec.ts` |
| **Stock adjustment by an admin or vendor** | The request may carry a `requestId`. The first request with that id records it in the adjustment's own transaction; a repeat changes nothing and answers with the current stock. The web sends one id per intended adjustment (same product, amount and reason keep the id until it succeeds; a changed request gets a new one). | `product-stock-adjustment.spec.ts`; `intent-id.test.mjs` |
| **Shopper activity** (not money) | Each row carries the id it becomes and is inserted with `skipDuplicates`. | `tracking-store.service.spec.ts` |

## The ledger backstop

The application already gates each ledger entry above. The migration `wallet_ledger_once_guards` makes
the database refuse a second one anyway, so a future bug or a replayed path cannot credit or reverse
the same money twice:

- vendor wallet: one `SALE`, one `COMMISSION` and one `REFUND` entry per order (the reference is the order id);
- user wallet: one `REFERRAL` credit per referral.

The migration stops with a clear message if the ledger already holds such duplicates, instead of a bare
index error; they would have to be reviewed by a person before it can run. Behaviour was checked on a
scratch database: the duplicates are refused, a different vendor, a different reason or a different
wallet on the same order are allowed.

## Gaps and decisions

- **Stock adjustments without a `requestId` still behave as before** (apply every time). The web now
  always sends one; an API client that does not is not protected. Making the id required would break
  existing API clients, so it stays optional.
- **The id of a stock adjustment is remembered for 14 days** (the processed-events retention), after
  which the same id would apply again. A retry that late is not a realistic repeat.
- **Wallet deposits, withdrawals and manual adjustments have no constraint**, because no code writes
  them yet. Whoever builds one must define its idempotency key and add its own once-only index.
- **Notifications and emails** are not money; they use their own de-duplication keys.
