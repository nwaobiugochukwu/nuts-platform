# Scheduled work review

Date: 2026-11-28. Every scheduled task in the API, what it does, whether it should stay a cron, become an event, or wait for a Temporal workflow, and why. Evidence is the code on `development`; nothing here was load-tested.

**Rule used:** a cron is right for housekeeping that is fine running late and is safe to repeat (deleting old rows). Work that belongs to one business object and has a deadline (expire *this* order after 30 minutes, remind *this* cart after 2 hours, publish *this* announcement at 09:00) is a timer for that object: a delayed event or, better, a Temporal timer, because it needs to survive restarts, be visible per object, and be cancelled when the object changes.

All tasks run in the `jobs` role (one instance) and every one now holds a distributed lock, so a second instance, or `all` next to `jobs`, cannot run them twice.

## Stay as they are: plain housekeeping

| Task | Schedule | What it does |
|---|---|---|
| `notification-retention-cleanup` | daily 00:00 | deletes old notifications |
| `analytics-event-retention` | daily 03:40 | deletes old product views and marketplace events |
| `recommendation-events-retention` | daily 03:25 | deletes old recommendation events |
| `recent-product-view-retention` | daily 03:00 | trims the recently viewed list |
| `outbox-published-retention-cleanup` | daily 03:00 | deletes published outbox rows after 90 days |
| `processed-events-retention` | daily 03:50 | forgets processed-message records after 14 days |
| `webhook-inbox-retention` | daily 03:55 | deletes processed webhooks after 30 days |
| `voucher-claim-cleanup` | daily 04:00 | releases expired voucher claims |
| `abandoned-cart-purge` | daily 00:00 | deletes carts untouched for 30 days |
| `outbox-stalled-event-alert` | every 5 minutes | logs an alert for dead or stuck outbox rows |
| `vendor-weekly-summary` | weekly | builds and sends each vendor's summary; a schedule by nature |
| `outbox relay poll` | every 10 s | the guarantee behind the wake-on-commit; stays a poll |

## Waits for Temporal (phase 8): a deadline per business object

| Task | Today | Becomes | Why not now |
|---|---|---|---|
| `unpaid-orders-expiration` (W1) | polls for unpaid orders past the limit | a timer started when the order is placed; cancelled when it is paid | a delayed message now would be thrown away when Temporal arrives |
| `abandoned-cart-reminder` (W7) | scans carts that went quiet | a timer per cart, reset by activity | same |
| `announcement scheduled publish` (W6) | polls every minute for due announcements | a timer at `scheduledAt` | same; the delivery itself (below) is already sound |
| `payment refund reconcile` (W2) | polls pending refunds every 5 minutes | a workflow per refund that polls Paystack with backoff until a terminal state | money: done once, as a workflow |
| `user-account-cleanup` (W8) | daily scan for accounts to delete | a deletion workflow with a grace period | needs the deletion policy (phase 7.6) first |

## Candidates for events, not yet built

| Task | Why it is a candidate | Why it is not built |
|---|---|---|
| `wishlist-price-and-restock-alerts` (every 15 minutes) | scans all wishlist rows to find price drops and restocks (finding H19) | the right trigger is `product.price_changed` and `product.restocked`, which nothing publishes yet; building the publishers only for this is the same work as a first real consumer, so it goes with the catalog events in the backlog |
| `low-stock-alert` | scans products below a threshold | `product.low_stock_detected` published when stock changes would replace the scan; same reason |

## Verified, no change needed: announcement delivery (finding E12)

`deliver` in the announcements service sends in chunks of 200 recipients, walking users by id (no offset scan), and stamps a lease after each chunk. A scheduled announcement is claimed with a conditional update (`SCHEDULED` to `PUBLISHING`), so two instances cannot both take it; if the process dies mid-delivery the 15-minute lease expires and the next minute's run takes it over and continues. Each recipient's notification has the key `announcement:<id>:<role>:<recipient>`, so repeating a chunk creates nothing twice. It runs in the `jobs` role, not through the queue, and that is enough: it is chunked, resumable, exclusive and idempotent.
