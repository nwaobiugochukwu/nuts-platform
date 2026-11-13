# NUTS Business Domains

These guides are the source of truth for how each product capability works across the web app, API, data store, providers, and asynchronous processing. Each guide covers current behavior, failure cases, and trade-offs. The [Scaling Strategy](../scaling/README.md) centralizes proposed concurrency, traffic, and growth directions. The [backend module map](../reference/backend-module-map.md) lists every API module folder and points to its domain without duplicating explanations.

| Domain guide | Scope | Owning API modules |
|---|---|---|
| [Identity, Accounts, and Security](identity-and-account-security.md) | Customer, vendor, and admin identity flows, account lifecycle, session security, and shared access controls. | `auth`, `users`, `security` |
| [Vendors and Marketplace Governance](vendors-and-marketplace-governance.md) | Vendor onboarding and approval, public stores, vendor relationships, and platform governance. | `vendors`, `admin` |
| [Catalog and Product Content](catalog-and-product-content.md) | Category taxonomy, purchasable product and variant data, product media, and product trust through reviews. | `categories`, `products`, `upload`, `reviews` |
| [Discovery and Personalization](discovery-and-personalization.md) | Search, catalog discovery, saved intent, and the complete current and proposed recommendation system. | `search`, `recommendations`, `wishlists` |
| [Shopping, Promotions, and Orders](shopping-promotions-and-orders.md) | Cart state, promotion eligibility, authoritative checkout validation, and order lifecycle. | `cart`, `discounts`, `orders` |
| [Payments and Financial Ledger](payments-and-financial-ledger.md) | Provider payment confirmation, full refunds, vendor settlement, and customer/vendor wallet accounting. | `payments`, `wallets` |
| [Referrals and Growth](referrals-and-growth.md) | Referral attribution, reward eligibility, and abuse-resistant growth mechanics. | `referrals` |
| [Analytics and Measurement](analytics-and-measurement.md) | Event ingestion, identity and attribution definitions, retention, and admin/vendor reporting. | `analytics` |
| [Notifications and Asynchronous Delivery](notifications-and-async-delivery.md) | Transactional outbox publication, broker delivery, in-app notifications, SSE, email side effects, and recovery. | `notifications` |

## Cross-cutting platform coverage

[Platform Runtime and Data](../platform/runtime-and-data.md) covers the `health` module, shared API infrastructure, persistence/runtime configuration, deployment boundaries, Swagger, and operational ownership. Cross-domain guides link there where behavior depends on shared infrastructure.

Every folder under `apps/api/src/modules` must appear exactly once in the [backend module map](../reference/backend-module-map.md). Cross-domain modules have one primary owner and explicit cross-links from other affected guides.
