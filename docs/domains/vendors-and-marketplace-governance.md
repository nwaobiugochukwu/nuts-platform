# Vendors and Marketplace Governance

> **Scope:** Vendor onboarding and approval, public stores, vendor relationships, and platform governance. The [domain index](README.md) maps this guide to its owning API modules; the [backend module map](../reference/backend-module-map.md) provides source and frontend navigation. Current behavior and proposed scale work are labeled separately.

## Domain boundary and outcomes

Vendor onboarding and approval, public stores, vendor relationships, and platform governance.

## End-to-end flow

This guide documents the capability across the web experience, API, persisted data, providers, and asynchronous work. Capability implementation details follow below.

## Cross-application behavior and integration contracts

### Customer, vendor, and platform portal boundaries

1. **Customer Storefront (`user`):** Shopping catalog, cart, direct checkout, customer orders, customer wallet, and product reviews.
2. **Vendor Merchant Backoffice (`vendor`):** Multi-step merchant registration, store management, product variant builder, inventory controls, order fulfillment, and merchant escrow wallet.
3. **Platform Administration (`admin`):** Marketplace governance, vendor review & approvals, category taxonomy, global user management, and shared Redis cache operations.

- Anonymous recent product history can be claimed after sign-in; it remains a recommendation aid and does not merge anonymous analytics identities into an account identity. The account's **Following** page lists followed vendors and supports search and pagination. Follow/unfollow writes update the relationship and append the corresponding recommendation/outbox events in the same transaction; current follower totals are relationship counts, while historical growth is event-based.

- Admin operations include platform registration/maintenance controls, admin staff status management, audit-log access, and customer/vendor announcements. Announcement delivery is resumable and batched; publishing and scheduled delivery have explicit lifecycle states. Campaigns target customers or vendors, and their in-app destinations are validated for the selected audience.

- Vendor and admin portal shells adapt navigation for narrow screens with a modal drawer and use a persistent sidebar at desktop sizes. These layout behaviors are UI presentation; authorization remains enforced by API role guards.

## Implementation details by capability

The sections below describe each capability’s problem, current API mechanism, failure cases, and trade-offs. The [backend module map](../reference/backend-module-map.md) provides folder and source navigation.

### Vendor onboarding, stores, and follows

Vendors need onboarding, approval, store/catalog management, and customer-facing storefront identity without exposing unapproved inventory.

#### Current backend mechanism

Controllers separate vendor account/auth, admin review, public stores, and customer follow actions. Product visibility and vendor sessions require active/approved vendor state.

#### Failure scenarios and trade-offs

Store slug generation has a concurrent-uniqueness collision path that currently returns a conflict; a bounded retry is a future hardening option. Store discovery options are bounded today; add server-side search when observed marketplace size requires it.

### Platform governance, staff, and announcements

Platform operators need controlled access to configuration, staff lifecycle, audit history, vendor decisions, and customer/vendor communications.

#### Current backend mechanism

Separate admin controllers expose platform, staff, and announcement operations. State-changing admin operations use role protection and audit records; announcement publishing is resumable and batched.

#### Failure scenarios and trade-offs

Campaigns have lifecycle states and recipient deduplication; publishing can resume after interruption. High-risk payment exceptions still lack a dedicated operator queue. The scale plan is to surface late captures and refunds needing attention through an audited work queue.

## Scaling and traffic direction

The [Scaling Strategy](../scaling/README.md#vendors-marketplace-and-governance) contains the staged concurrency, traffic, and growth recommendations for this domain. Scale vendor search and campaign delivery with bounded retries, pagination, idempotency, and audited operator workflows.
