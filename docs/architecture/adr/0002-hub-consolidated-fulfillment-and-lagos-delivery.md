# ADR 0002: Hub-consolidated fulfillment with distance-priced, tracked delivery in Lagos

- **Status:** Accepted (decisions below); implementation not started. See the [implementation plan](../hub-fulfillment-and-delivery-plan.md).
- **Date:** 2026-11-24
- **Owners:** Platform engineering, operations
- **Related code:** [`orders.service.ts`](../../../apps/api/src/modules/orders/services/orders.service.ts), [`cart.service.ts`](../../../apps/api/src/modules/cart/services/cart.service.ts), [schema](../../../packages/database/schema.prisma)

## Context

Today an order has **one** status and any vendor with an item in it can move the **whole** order to SHIPPED or DELIVERED. Reaching DELIVERED settles earnings for **every** vendor on the order, so one vendor's "delivered" can release another vendor's payout, and the customer is told goods have shipped that have not. The delivery charge is a static cart field, addresses are free text with no location, and there is no tracking or delivery estimate.

The product goal is a real-company experience: one parcel from many vendors, a delivery fee and estimate based on where the customer is, and live tracking, launching in **Lagos only**.

## Decision

1. **Consolidation hub.** Vendors hand items to the NUTS hub in Lagos; the hub checks them in, packs **one parcel per order** and delivers it once. Vendors never deliver to customers and never set delivery status.
2. **Late vendors.** Every vendor handover has an SLA (default 24 hours, configurable). On a miss the customer chooses: keep waiting with an updated estimate, or **split** (send what is ready now; no extra delivery fee for the second parcel when the delay is the vendor's). A hard deadline (default 72 hours) cancels and refunds the late item automatically and counts against the vendor's reliability score.
3. **Riders.** Start with a third-party logistics provider behind a `DispatchProvider` interface, chosen on a requirement list that includes a live-location feed and delivery webhooks. A lightweight own-rider PWA is built behind the same interface as the fallback when a provider cannot supply live GPS, and as the path to own riders as volume grows.
4. **Pricing.** A formula, not flat zones: `clamp(min, base + perKm × roadKm) × time-of-day factor + crossing and size surcharges`, with every number editable in admin and versioned. Starting values to tune against real rider cost: base ₦1,000, ₦150 per road km, minimum ₦1,500, cap ₦6,000, Island/Mainland crossing +₦500, peak (07:00-10:00, 16:00-20:00) ×1.2, size tiers +₦0 / +₦500 / +₦1,500, free delivery above ₦50,000 funded by the platform. One delivery fee per order, never per vendor.
5. **Maps.** Google Maps Platform (geocoding and autocomplete, traffic-aware distance and duration, map display) behind `GeoProvider` and routing interfaces, with aggressive caching and budget alerts, so an OpenStreetMap stack (OSRM, MapLibre) can replace it later without touching callers. The customer's map **pin** is the source of truth for the address, because street addresses in Lagos geocode unreliably.

## Amendment: practice project run by one developer (2026-11-24)

NUTS is built to practise real-world engineering, not to operate a live delivery business. Every record is a **real database record** and every role has a **real portal**, but the people are played by the developer, who signs in as each role to test: customer (storefront), vendor (vendor portal), hub staff (hub console in the admin area, with a hub-staff permission) and rider (a new rider portal). Per-role sign-in cookies allow all of them side by side in one browser. This changes decisions 3 and 5 and nothing else.

- **Decision 3 (riders), amended:** dispatch is **internal**. The first `DispatchProvider` implementation is backed by our own rider accounts, assignments and deliveries (real records) and a **rider portal**: sign in, see the task, accept, mark arrived, enter the customer's delivery code. A third-party logistics provider remains a later adapter behind the same interface.
- **Rider location:** the rider portal sends the phone's real GPS when carried. Because nobody can ride across Lagos while developing, a demo-only **auto-drive** tool moves a chosen rider along the routed path at a chosen speed through the same location pipeline, so the live map, ETA and "arriving soon" behave identically.
- **Decision 5 (maps), amended:** an **OpenStreetMap-based** default: self-hosted OSRM on a Lagos extract for road distance and duration, MapLibre for display, and a cached pin-first address flow. There is no live-traffic feed, so traffic is a **modelled time-of-day factor** and ETAs say so. Google Maps stays a possible adapter behind the same interfaces.
- **Optional automation:** hub and vendor **bots** that perform check-in and handover after a set delay, for when clicking through every step by hand is tedious; the real screens remain the primary path.
- **Messaging and payments:** an in-app message inbox stands in for paid SMS and WhatsApp; payments stay in Paystack test mode.
- **Guardrails:** a `DEMO_TOOLS_ENABLED` flag, off by default in production; location produced by auto-drive is labelled as demo data in admin.

## Alternatives considered

| Option | Benefits | Costs and risks | Why selected or rejected |
|---|---|---|---|
| Seller-fulfilled split shipments | No hub; vendors ship themselves | Several parcels, several fees, no single ETA, weak quality control | Rejected for launch: worse customer experience and hard to price from one origin |
| Hub consolidation (chosen) | One parcel, one fee, one tracked delivery, quality check at check-in | Needs a physical hub and staff; the slowest vendor gates the parcel | Selected: matches the pricing-from-your-location goal; the SLA and split policy contain the slow-vendor risk |
| Own riders from day one | Full control of tracking and cost | Hiring, insurance and dispatch tooling before demand is known | Deferred: provider first, own riders behind the same interface |
| Flat zone pricing | Simple to explain | Over- and under-charges; does not use the pin | Rejected: formula can still be rounded into bands in the UI |
| OpenStreetMap stack at launch | Cheaper | Rougher Lagos data and no live-traffic ETA | Deferred: kept possible by the provider interfaces |

## Consequences

- A new fulfillment domain (parcels and per-vendor handovers) replaces vendor-controlled order status; order status becomes derived. Existing orders are backfilled.
- Vendor payouts move to a per-vendor trigger (after delivery plus a short dispute window), fixing the settle-everyone-on-DELIVERED behaviour.
- Operations must staff a hub with check-in scanning, and own the SLA policy.
- Third-party dependencies (maps, logistics provider, SMS/WhatsApp) need cost controls, retries, webhooks with idempotency, and fallbacks.
- Location data is personal data: retention limits, tokenised tracking links and access control are part of the design.

## Validation and revisit trigger

Validate against the KPIs in the plan (on-time delivery, ETA accuracy, vendor SLA hit rate, fee margin over rider cost, failed-delivery rate). Revisit the provider choice when volume justifies own riders, the map provider if monthly map cost exceeds a set share of delivery revenue, and the hub model if the late-vendor split rate stays high.
