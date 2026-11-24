# Hub Fulfillment, Lagos Delivery and Live Tracking: Implementation Plan

**Status: proposed plan, nothing here is built yet.** It implements [ADR 0002](adr/0002-hub-consolidated-fulfillment-and-lagos-delivery.md). Current behaviour is described in [Shopping, Promotions, and Orders](../domains/shopping-promotions-and-orders.md); where this plan changes it, the domain guide must be updated as each phase ships. Code layout follows [Code organization and dependency rules](code-organization.md).

Sizes are relative effort (S, M, L, XL), not calendar estimates.

## 1. Goals

1. A customer who buys from several vendors gets **one parcel, one delivery fee, one estimate and one tracked delivery**.
2. The delivery fee and estimated arrival are computed from the customer's **map pin** to the NUTS hub in **Lagos only**, and are shown before payment.
3. The customer can **watch the rider live**, share the link, and confirm delivery with a code.
4. Vendors can no longer move an order they do not fully control, and **payouts are released per vendor** at the right moment.
5. The customer experience is clearer and more honest than the large marketplaces: item-level readiness, a promise with a confidence level, and proactive communication.

Non-goals for this release: delivery outside Lagos, international shipping, scheduled vendor pickup, multiple hubs, route batching across customers, return logistics (listed under [Later](#9-later)).

## 1a. How this project is run and tested (project context)

This is a practice project run by one developer. Every record is a **real database record** and every role has a **real portal**; the developer signs in as each role to test (per-role sign-in cookies allow all of them side by side in one browser). See the amendment in [ADR 0002](adr/0002-hub-consolidated-fulfillment-and-lagos-delivery.md).

| Role or service | In this project | Later, in a real business |
|---|---|---|
| Customer | Storefront, real account | Same |
| Vendor | Vendor portal (exists), real accounts and handover screens | Same |
| Hub staff | Hub console in the admin area behind a hub-staff permission; you sign in and scan items in by hand | Real staff, same screens |
| Rider | Real rider account and a **rider portal** (sign in, accept, arrived, enter delivery code); phone GPS when carried | Same portal, or a logistics-provider adapter behind `DispatchProvider` |
| Rider movement while developing | **Auto-drive** demo tool moves a rider along the OSRM route through the same location pipeline | Not needed |
| Road distance and ETA | Self-hosted OSRM (Lagos extract) plus a modelled time-of-day traffic factor | A traffic-aware routing adapter |
| Geocoding and map | Pin-first flow, cached OSM-based geocoding, MapLibre | A Google adapter |
| SMS / WhatsApp | In-app message inbox | A provider adapter |
| Payments | Paystack test mode (already in place) | Live keys |

**Demo control panel (admin):** seed one demo account per role (development only), seed demo orders, auto-drive speed (1x, 10x, 60x), scenario triggers (vendor late, traffic jam on a zone, rider detour, failed delivery), reset, and a log of demo-driven events. Optional hub and vendor bots can perform check-in and handover after a set delay. All of it is guarded by `DEMO_TOOLS_ENABLED` (off by default in production), and auto-drive locations are labelled as demo data.

**What this makes realistic for one developer:** every headline feature, including the live map, ETA window, delivery code, per-vendor payouts and hub screens, without paid services or real riders. State in the README that traffic is modelled and that riders and hub staff are played by the developer.

## 2. Today versus target

| Area | Today | Target |
|---|---|---|
| Order status | One status; any vendor with an item can set SHIPPED/DELIVERED for the whole order | Derived from the parcel; vendors only hand items to the hub |
| Payout | Reaching DELIVERED settles **every** vendor on the order | Per vendor, after delivery plus a dispute window |
| Address | Free text (`ShippingAddress`), no coordinates | Pin, landmark, phone, geofence-validated, reusable |
| Delivery fee | Static `deliveryCharge` on the cart | Quoted from road distance, time of day and size; stored quote locked at checkout |
| Estimate | None | Window with confidence, refined as the order moves |
| Tracking | Order status badge | Timeline with item readiness, live map, shareable link |
| Delivery confirmation | Status flip by a vendor | Customer code and photo, checked against the pin |
| Cancel/refund | Whole order | Per item or per vendor handover, partial refunds |

## 3. Policies (configurable in admin, versioned)

| Policy | Default | Notes |
|---|---|---|
| Hub location | Set by admin | Latitude, longitude, address, opening hours |
| Vendor handover SLA | 24 h after payment | Reminders at 50% and 90% of the SLA |
| Hard deadline | 72 h | Late item auto-cancelled and refunded |
| Customer choice on SLA miss | Wait / split / cancel the item | Split costs the customer no second delivery fee when the delay is the vendor's |
| Pricing | See ADR 0002 | Base, per km, minimum, cap, crossing, peak window and factor, size tiers, free-delivery threshold |
| Quote validity | 15 minutes | Re-quote on address, cart or window change |
| Payout trigger | Delivery + 48 h dispute window | Per vendor |
| Delivery windows | 3-hour slots | Economy slot priced lower because it batches |
| Location retention | Raw pings deleted after 30 days | See [Privacy](#7-security-privacy-and-compliance) |

## 4. Workstreams

### A. Data model (additive migrations, backfilled)
New tables (Prisma, `packages/database`):
- **`Parcel`**: one per order (two after a split). Status, hub id, packed/dispatched/delivered times, weight/size tier, delivery fee snapshot, tracking token (random, unguessable), proof-of-delivery code hash.
- **`ParcelHandover`**: one per (parcel, vendor). Items, due time (SLA), handed-over time, check-in result (accepted / rejected / damaged), reason.
- **`DeliveryAddress`** (extends `ShippingAddress`): `lat`, `lng`, `landmark`, `placeId`, `lga`, `zone`, `isInsideGeofence`.
- **`DeliveryQuote`**: address, cart hash, distance, duration, fee breakdown, ETA window, expiry; consumed by the order at checkout.
- **`Delivery`**: provider, provider reference, rider (name, phone, vehicle), tracking state, ETA, attempt count.
- **`DeliveryEvent`**: append-only timeline (type, actor, location, payload).
- **`PricingConfig`** and **`FulfillmentPolicy`**: versioned and effective-dated; orders store the version used.
- **`VendorReliability`**: rolling on-time handover rate and rejection rate.
- Live rider position is **not** stored in PostgreSQL: latest value per rider lives in Redis (geo) with a short expiry; a sampled history goes to `DeliveryEvent`.

Status models:
- **Handover:** `AWAITING_HANDOVER → HANDED_OVER → ACCEPTED | REJECTED`, plus `LATE`, `CANCELLED`.
- **Parcel:** `AWAITING_ITEMS → READY_TO_PACK → PACKED → DISPATCH_REQUESTED → RIDER_ASSIGNED → OUT_FOR_DELIVERY → ARRIVING → DELIVERED`, plus `DELIVERY_FAILED → RETURNED_TO_HUB`, `CANCELLED`.
- **Order status stays on the existing enum** and is derived: paid = CONFIRMED, awaiting items or packing = PROCESSING, out for delivery = SHIPPED, delivered = DELIVERED. Existing screens keep working; the new detail lives in the parcel.

Backfill: one parcel and one handover per vendor for every existing order, copying the current status, so nothing in flight breaks.

### B. Fulfillment module (API, `modules/fulfillment`)
- Create the parcel and handovers when payment succeeds (listener on the payment-confirmed event, written through the outbox).
- Vendor endpoints: list handovers due, mark "ready / dropped at hub", print handover labels (QR per item group).
- Hub endpoints (role-restricted): scan an item QR to check in, accept or reject with a reason, mark packed, request dispatch.
- Derive the order status from parcel events in one place (`deriveOrderStatus`), unit-tested exhaustively.
- SLA jobs (existing job pattern, distributed lock): reminders, mark `LATE`, open the customer choice, hard-deadline auto-cancel with partial refund and stock restore.
- Replace `updateStatusForVendor`: vendors can no longer set SHIPPED/DELIVERED on an order.

### C. Money
- **Immediate hotfix (Phase 0):** block vendor SHIPPED/DELIVERED transitions on multi-vendor orders and settle only vendors whose items are delivered, until the fulfillment module replaces it.
- Per-vendor earning credited at payment (as today), **settled per vendor** after delivery plus the dispute window; commission and vendor-funded discounts calculated per handover.
- Delivery fee recorded as its own ledger line (customer-paid, rider cost, platform margin) so margin is measurable.
- Partial refunds: rejected or cancelled handovers refund their items (and a proportional share of discounts); a split second parcel refunds nothing extra. Refunds use the existing refund pipeline.

### D. Geo and pricing (API, `modules/delivery`; provider adapters in `infrastructure/maps`)
- Interfaces: `GeoProvider` (autocomplete, geocode, reverse geocode) and `RoutingProvider` (road distance, traffic-aware duration), with a Google adapter first. Callers never import the vendor SDK.
- **Lagos geofence:** point-in-polygon check against a Lagos State GeoJSON; derive LGA, Island/Mainland (for the crossing surcharge) and zone.
- **Quote service** `POST /delivery/quote`: validates the pin, computes road distance and duration hub → pin, applies the active `PricingConfig`, returns fee breakdown, ETA window and `quoteId` with expiry. Pure pricing function is unit-tested against a table of cases.
- **Cost controls:** cache geocode and routing results by coordinates rounded to ~100 m and time bucket; Places autocomplete session tokens; compute quotes only once the pin is confirmed; per-user and per-IP rate limits; budget alerts and a kill switch that falls back to a distance-band estimate.
- **ETA engine:** `eta = slowest outstanding handover (until SLA) + hub processing time + dispatch wait + live route time + buffer`, returned as a window with a confidence label. Record estimated versus actual per delivery and tune buffers by zone and hour; model-based ETA is a later step.
- Checkout accepts `quoteId`, delivery option and window; the order stores the quote snapshot, so what was shown is what is charged.

### E. Dispatch and live tracking (API, `modules/delivery`)
- `DispatchProvider` interface (request, cancel, status webhook, location feed) with the first provider adapter chosen from a shortlist scored on: live GPS feed, webhooks, Lagos coverage, pricing, SLA, proof-of-delivery support, API quality. Webhooks are verified, idempotent and replay-safe.
- **Own-rider PWA** (fallback and growth path): rider sign-in, task list, navigation hand-off, GPS pings every 5-10 s while on task (batched when offline), "arrived" and "delivered" actions. Pings write to Redis geo and fan out to trackers.
- **Tracking channel:** extend the existing server-sent-events pattern with a per-delivery topic; public tracking page `GET /track/:token` (no login, token not the order id) with limited fields.
- **Proof of delivery:** four-digit code the customer reads to the rider plus a photo and a geotag within a set distance of the pin; failed-delivery flow (customer unreachable, reschedule, return to hub, re-delivery fee rules).

### F. Customer experience (web)
- **Checkout:** map with draggable pin, autocomplete, landmark and phone fields, saved pins; live quote with an itemised fee (distance, time of day, size) and the free-delivery progress bar; delivery option cards (earliest, scheduled slot, economy) with price and window; clear out-of-Lagos message with a waitlist.
- **Order tracking** (one page): a timeline showing each vendor's items ("Aba Shoes: at our hub", "Lagos Bags: arriving"), packed, out for delivery, delivered; **live map** with the rider and a shrinking ETA; confidence badge and proactive "running late" notice; "share my tracking link"; the doorstep code, shown prominently only when the rider is close.
- **Choice screens:** the SLA-miss choice (wait, split, cancel the item) with the consequences spelled out; reschedule and "I am not available" in two taps.
- **Notifications:** one thread per order; only key moments (confirmed, all items at hub, out for delivery with a live link, arriving soon, delivered, problems); SMS or WhatsApp for the last stretch; user preferences respected; deduplicated like existing notifications.
- **Quality bar:** works on slow phones (skeletons, cached last position), dark-mode map, accessible controls, reduced-motion friendly, tested at phone, tablet and desktop widths.

### G. Vendor and admin tooling
- **Vendor:** "Hand over to hub" list with deadline countdowns, label printing, handover history, reliability score, payout schedule that explains why money is pending.
- **Hub/admin:** inbound board (expected, due soon, overdue), scan-in screen, packing queue, dispatch board with a map, exceptions queue (rejected, late, failed), pricing and policy editors with effective dates, geofence viewer, provider console, analytics.
- New role or permission for **hub staff** limited to check-in, packing and dispatch.

## 5. Phases

| Phase | Scope | Size | Exit criteria |
|---|---|---|---|
| **0. Hotfix** | Block vendor SHIPPED/DELIVERED on multi-vendor orders; settle only delivered vendors' earnings; tests | S | No payout can be released by another vendor's action |
| **1. Fulfillment core** | Data model A (parcel, handover), module B, per-vendor payout C, SLA jobs, hub scan-in and vendor handover screens, customer timeline (no map), backfill | XL | A multi-vendor order moves through handover, check-in, pack and delivery with a correct derived status and correct per-vendor payout |
| **2. Geo and pricing** | Address with pin, geofence, quote service, ETA windows, checkout integration, cost controls | L | Fee and window shown before payment; quote stored on the order; map spend within budget in a load test |
| **3. Dispatch and live tracking** | `DispatchProvider` interface, internal rider accounts and **rider portal**, auto-drive and demo control panel, tracking page and live map, delivery code, failed-delivery flow; a third-party provider later behind the same interface | L | You sign in as a rider, accept the task, and the customer sees the rider move on the map (phone GPS or auto-drive at 1x and 60x); delivery cannot complete without the code; scenario triggers behave; delivery events idempotent |
| **4. Experience and scale** | Delivery slots and economy option, SMS/WhatsApp, reschedule, ETA tuning from history, vendor reliability effects, analytics, margin dashboard | L | KPI targets below met for four consecutive weeks |

Phases 1 and 2 can overlap after the Phase 1 data model is merged. Each phase ships behind feature flags and is released by internal pilot, then a few Lagos zones, then all of Lagos.

## 6. How we build and verify it

- **API:** new modules `fulfillment` and `delivery` under `modules/`, provider adapters under `infrastructure/`, domain events through the transactional outbox, RabbitMQ consumers for notifications, Redis for geo and rate limits. The architecture check keeps the layering.
- **Web:** `components/domain/delivery` and `components/domain/fulfillment`, a typed client in `api/services`, hooks in `hooks/`, pure helpers in `lib/` (fee display, ETA formatting, status mapping) with `node:test` tests, a single `DeliveryMap` component wrapping the map library.
- **Tests:** unit (pricing, geofence, ETA, status derivation, payout rules), integration (webhooks, refunds, SLA jobs), end-to-end (multi-vendor order to delivery, late vendor split, failed delivery), load (quote endpoint), plus a staging dry run with real riders.
- **Rollout safety:** additive migrations, backfill script with dry-run, feature flags per phase, runbook for the hub, rollback plan per release, migrations run through the `api-migrate` job before the API.

## 7. Security, privacy and compliance

- Location and phone numbers are personal data under the Nigeria Data Protection Act 2023: collect only what is needed, state it in the privacy notice, delete raw pings after the retention period, restrict hub and admin access by role, audit-log access to delivery details.
- Tracking links use random tokens, expire after delivery plus a grace period, and expose rider first name and position only while out for delivery.
- Rate limit the quote and autocomplete endpoints (they cost money), validate pins server-side (inside the geofence, not implausible), and verify provider webhooks by signature.
- Rider PWA: authenticated, location sent only during an active task, clear consent and battery-aware pinging.

## 8. KPIs

On-time delivery rate; ETA accuracy (median error by zone and hour); vendor SLA hit rate; late-split rate; failed-delivery rate; delivery fee minus rider cost (margin); map and SMS cost per order; checkout conversion after the quote is shown; tracking-page usage; support contacts per order.

## 9. Later

Delivery beyond Lagos, multiple hubs, scheduled vendor pickup, route batching, returns logistics, own rider fleet management, demand-based pricing, model-based ETA.

## 10. Open items to confirm

1. Hub address, opening hours and staffing for check-in.
2. Starting pricing numbers (ADR 0002 lists defaults) once rider cost per kilometre is known.
3. Logistics provider shortlist (only needed if you later replace the internal rider portal).
4. OSRM Lagos extract and tile source (Google is only needed if you later add that adapter).
5. Hub staff permissions and whether vendors may deliver to the hub themselves or only by drop-off.
