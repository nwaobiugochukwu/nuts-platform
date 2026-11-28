# Backend Module Map

This is a navigation reference. It maps every API module folder to its domain guide, representative backend source files, purpose, and frontend surfaces. The domain pages contain current behavior, mechanisms, edge cases, and trade-offs; the [Scaling Strategy](../scaling/README.md) contains proposed scale directions.

## [Identity, Accounts, and Security](../domains/identity-and-account-security.md)

| API module | Source folder and key files | Responsibility | Frontend surfaces |
|---|---|---|---|
| `auth` | [`auth`](../../apps/api/src/modules/auth)<br>[auth.service](../../apps/api/src/modules/auth/services/auth.service.ts)<br>[auth.controller](../../apps/api/src/modules/auth/controllers/auth.controller.ts)<br>[auth-session.service](../../apps/api/src/modules/auth/services/auth-session.service.ts)<br>[google-auth.service](../../apps/api/src/modules/auth/services/google-auth.service.ts) | Customer, vendor, and admin authentication, session issuance, OTP, Google identity, and refresh rotation. | [Auth routes](<../../apps/web/src/app/(auth)/auth>) |
| `security` | [`security`](../../apps/api/src/modules/security)<br>[account-lock.service](../../apps/api/src/modules/security/services/account-lock.service.ts)<br>[token.service](../../apps/api/src/modules/security/services/token.service.ts) | Account lockout, token controls, audit utilities, and API security policies. | Auth flows and protected portal layouts |
| `users` | [`users`](../../apps/api/src/modules/users)<br>[users.service](../../apps/api/src/modules/users/services/users.service.ts)<br>[users.controller](../../apps/api/src/modules/users/controllers/users.controller.ts)<br>[admin-user.controller](../../apps/api/src/modules/users/controllers/admin-users.controller.ts) | Customer profile/account operations and admin user management. | [Customer account](<../../apps/web/src/app/(storefront)/account>), [admin users](<../../apps/web/src/app/(admin)/admin/user>) |

## [Vendors and Marketplace Governance](../domains/vendors-and-marketplace-governance.md)

| API module | Source folder and key files | Responsibility | Frontend surfaces |
|---|---|---|---|
| `staff` | [`staff`](../../apps/api/src/modules/staff)<br>[staff.service](../../apps/api/src/modules/staff/services/staff.service.ts)<br>[admin-staff.controller](../../apps/api/src/modules/staff/controllers/admin-staff.controller.ts) | Staff lifecycle and governance audit access. | [Admin portal](<../../apps/web/src/app/(admin)/admin>) |
| `platform` | [`platform`](../../apps/api/src/modules/platform)<br>[platform.service](../../apps/api/src/modules/platform/services/platform.service.ts)<br>[admin-platform.controller](../../apps/api/src/modules/platform/controllers/admin-platform.controller.ts) | Platform configuration (maintenance mode, registrations) and the system overview. | [Admin portal](<../../apps/web/src/app/(admin)/admin>) |
| `announcements` | [`announcements`](../../apps/api/src/modules/announcements)<br>[admin-announcements.service](../../apps/api/src/modules/announcements/services/admin-announcements.service.ts)<br>[admin-announcements.controller](../../apps/api/src/modules/announcements/controllers/admin-announcements.controller.ts) | Customer and vendor announcements. | [Admin portal](<../../apps/web/src/app/(admin)/admin>) |
| `vendors` | [`vendors`](../../apps/api/src/modules/vendors)<br>[vendors.service](../../apps/api/src/modules/vendors/services/vendors.service.ts)<br>[vendor-auth.service](../../apps/api/src/modules/auth/services/vendor-auth.service.ts)<br>[vendor-follows.service](../../apps/api/src/modules/vendors/services/vendor-follows.service.ts)<br>[vendor-account.controller](../../apps/api/src/modules/vendors/controllers/vendor-account.controller.ts) | Vendor onboarding, public stores, approval, account operations, and following. | [Public stores](<../../apps/web/src/app/(storefront)/vendor>), [Following](<../../apps/web/src/app/(storefront)/account/following>), vendor and admin routes |

## [Catalog and Product Content](../domains/catalog-and-product-content.md)

| API module | Source folder and key files | Responsibility | Frontend surfaces |
|---|---|---|---|
| `categories` | [`categories`](../../apps/api/src/modules/categories)<br>[categories.service](../../apps/api/src/modules/categories/services/categories.service.ts)<br>[categories.controller](../../apps/api/src/modules/categories/controllers/categories.controller.ts)<br>[admin-category.controller](../../apps/api/src/modules/categories/controllers/admin-category.controller.ts) | Hierarchical taxonomy, public category reads, and admin taxonomy changes. | [Category pages](<../../apps/web/src/app/(storefront)/category>), [admin categories](<../../apps/web/src/app/(admin)/admin/category>) |
| `products` | [`products`](../../apps/api/src/modules/products)<br>[products.service](../../apps/api/src/modules/products/services/products.service.ts)<br>[product-variants.service](../../apps/api/src/modules/products/services/product-variants.service.ts)<br>[discover.controller](../../apps/api/src/modules/products/controllers/discover.controller.ts)<br>[admin-product.controller](../../apps/api/src/modules/products/controllers/admin-products.controller.ts) | Public catalog, variants, vendor/admin catalog tools, and the Discover feed. | [Discover](<../../apps/web/src/app/(storefront)/discover>), [product routes](<../../apps/web/src/app/(storefront)/product>), [vendor products](<../../apps/web/src/app/(vendor)/vendor/product>), [admin products](<../../apps/web/src/app/(admin)/admin/product>) |
| `reviews` | [`reviews`](../../apps/api/src/modules/reviews)<br>[reviews.service](../../apps/api/src/modules/reviews/services/reviews.service.ts)<br>[reviews.controller](../../apps/api/src/modules/reviews/controllers/reviews.controller.ts) | Purchase-eligible reviews and product rating/review reads. | [Review page](<../../apps/web/src/app/(storefront)/review>), product detail |
| `upload` | [`upload`](../../apps/api/src/modules/upload)<br>[upload.controller](../../apps/api/src/modules/upload/controllers/image-upload.controller.ts) | Authorized media upload and provider integration. | Product media controls in vendor/admin forms |

## [Discovery and Personalization](../domains/discovery-and-personalization.md)

| API module | Source folder and key files | Responsibility | Frontend surfaces |
|---|---|---|---|
| `recommendations` | [`recommendations`](../../apps/api/src/modules/recommendations)<br>[recommendations.service](../../apps/api/src/modules/recommendations/services/recommendations.service.ts)<br>[recommendations.controller](../../apps/api/src/modules/recommendations/controllers/recommendations.controller.ts) | Deterministic personalized shelves, recent history, the good-place-to-start shelf, and related products. | [Home](../../apps/web/src/app/page.tsx), Discover, product detail |
| `search` | [`search`](../../apps/api/src/modules/search)<br>[search.service](../../apps/api/src/modules/search/services/search.service.ts)<br>[search.controller](../../apps/api/src/modules/search/controllers/search.controller.ts)<br>[admin-search.controller](../../apps/api/src/modules/search/controllers/admin-search.controller.ts) | Public product search plus role-scoped admin/vendor search operations. | [Search page](<../../apps/web/src/app/(storefront)/search>) |
| `wishlists` | [`wishlists`](../../apps/api/src/modules/wishlists)<br>[wishlist.service](../../apps/api/src/modules/wishlists/services/wishlist.service.ts)<br>[wishlist.controller](../../apps/api/src/modules/wishlists/controllers/wishlist.controller.ts) | Saved product/variant relationships and availability. | [Wishlist](<../../apps/web/src/app/(storefront)/wishlist>) |

## [Shopping, Promotions, and Orders](../domains/shopping-promotions-and-orders.md)

| API module | Source folder and key files | Responsibility | Frontend surfaces |
|---|---|---|---|
| `cart` | [`cart`](../../apps/api/src/modules/cart)<br>[cart.service](../../apps/api/src/modules/cart/services/cart.service.ts)<br>[cart.controller](../../apps/api/src/modules/cart/controllers/cart.controller.ts) | Customer cart state and the pre-checkout path. | [Cart](<../../apps/web/src/app/(storefront)/cart>), [checkout](<../../apps/web/src/app/(storefront)/checkout>) |
| `discounts` | [`discounts`](../../apps/api/src/modules/discounts)<br>[discount-code.service](../../apps/api/src/modules/discounts/services/discount-code.service.ts)<br>[vendor-discount-codes.controller](../../apps/api/src/modules/discounts/controllers/vendor-discount-codes.controller.ts)<br>[admin-discount-codes.controller](../../apps/api/src/modules/discounts/controllers/admin-discount-codes.controller.ts) | Vendor/admin discount management (code-based and automatic), voucher claims, stacking engine, and checkout eligibility. | [Vendor discounts](<../../apps/web/src/app/(vendor)/vendor/discount>), [admin discounts](<../../apps/web/src/app/(admin)/admin/discount>) |
| `orders` | [`orders`](../../apps/api/src/modules/orders)<br>[orders.service](../../apps/api/src/modules/orders/services/orders.service.ts)<br>[orders.controller](../../apps/api/src/modules/orders/controllers/orders.controller.ts)<br>[vendor-orders.controller](../../apps/api/src/modules/orders/controllers/vendor-orders.controller.ts)<br>[admin-order.controller](../../apps/api/src/modules/orders/controllers/admin-orders.controller.ts) | Customer, vendor, and admin order views and state transitions. | [Customer orders](<../../apps/web/src/app/(storefront)/order>), [vendor](<../../apps/web/src/app/(vendor)/vendor/order>), [admin](<../../apps/web/src/app/(admin)/admin/order>) |

## [Payments and Financial Ledger](../domains/payments-and-financial-ledger.md)

| API module | Source folder and key files | Responsibility | Frontend surfaces |
|---|---|---|---|
| `payments` | [`payments`](../../apps/api/src/modules/payments)<br>[payments.service](../../apps/api/src/modules/payments/services/payments.service.ts)<br>[payments.controller](../../apps/api/src/modules/payments/controllers/payments.controller.ts) | Paystack confirmation/webhooks, refund lifecycle, and payment state. | [Checkout](<../../apps/web/src/app/(storefront)/checkout>), [order success](<../../apps/web/src/app/(storefront)/order-success>) |
| `wallets` | [`wallets`](../../apps/api/src/modules/wallets)<br>[wallet.service](../../apps/api/src/modules/wallets/services/wallet.service.ts)<br>[user-wallet.controller](../../apps/api/src/modules/wallets/controllers/user-wallet.controller.ts)<br>[vendor-wallet.controller](../../apps/api/src/modules/wallets/controllers/vendor-wallet.controller.ts) | Customer/vendor balances and ledger operations. | [Customer wallet](<../../apps/web/src/app/(storefront)/wallet>), [vendor wallet](<../../apps/web/src/app/(vendor)/vendor/wallet>) |

## [Referrals and Growth](../domains/referrals-and-growth.md)

| API module | Source folder and key files | Responsibility | Frontend surfaces |
|---|---|---|---|
| `referrals` | [`referrals`](../../apps/api/src/modules/referrals)<br>[referral.service](../../apps/api/src/modules/referrals/services/referral.service.ts) | Referral validation, registration attribution, reward tracking, and stats. | [Registration](<../../apps/web/src/app/(auth)/auth/register>), [account settings](<../../apps/web/src/app/(storefront)/account/setting>) |

## [Analytics and Measurement](../domains/analytics-and-measurement.md)

| API module | Source folder and key files | Responsibility | Frontend surfaces |
|---|---|---|---|
| `shopper-activity` | [`shopper-activity`](../../apps/api/src/modules/shopper-activity)<br>[shopper-activity-recorder.service](../../apps/api/src/modules/shopper-activity/services/shopper-activity-recorder.service.ts)<br>[shopper-activity-store.service](../../apps/api/src/modules/shopper-activity/services/shopper-activity-store.service.ts)<br>[product-views.service](../../apps/api/src/modules/shopper-activity/services/product-views.service.ts)<br>[shopper-activity.service](../../apps/api/src/modules/shopper-activity/services/shopper-activity.service.ts)<br>[recommendation-events.service](../../apps/api/src/modules/shopper-activity/services/recommendation-events.service.ts)<br>[recommendation-events.dto](../../apps/api/src/modules/shopper-activity/dto/recommendation-events.dto.ts) | Takes in what shoppers do (product views, searches, store views, cart and wishlist changes, shelf interactions), stores it once through one store, refreshes recommendations, and prunes old data. | Storefront tracking calls |
| `analytics` | [`analytics`](../../apps/api/src/modules/analytics)<br>[shopper-engagement.service](../../apps/api/src/modules/analytics/services/shopper-engagement.service.ts) | Reporting only: vendor and platform reports, including how shoppers engage. | [Admin analytics](<../../apps/web/src/app/(admin)/admin/analytic>), [vendor analytics](<../../apps/web/src/app/(vendor)/vendor/analytic>) |

## [Notifications and Asynchronous Delivery](../domains/notifications-and-async-delivery.md)

| API module | Source folder and key files | Responsibility | Frontend surfaces |
|---|---|---|---|
| `notifications` | [`notifications`](../../apps/api/src/modules/notifications)<br>[notifications.service](../../apps/api/src/modules/notifications/services/notifications.service.ts)<br>[notifications.controller](../../apps/api/src/modules/notifications/controllers/notifications.controller.ts)<br>[notifications-sse.controller](../../apps/api/src/modules/notifications/controllers/notifications-sse.controller.ts) | Inbox, preferences, push delivery, SSE, and consumer-side persistence. | [Customer notifications](<../../apps/web/src/app/(storefront)/notifications>), [vendor](<../../apps/web/src/app/(vendor)/vendor/notifications>), [admin](<../../apps/web/src/app/(admin)/admin/notifications>) |

## [Platform Runtime and Data](../platform/runtime-and-data.md)

| API module | Source folder and key files | Responsibility | Frontend surfaces |
|---|---|---|---|
| `health` | [`health`](../../apps/api/src/modules/health)<br>[health.controller](../../apps/api/src/modules/health/controllers/health.controller.ts) | Liveness/readiness signals for API hosts; dependency status is limited to checks implemented by the controller. | [Web liveness route](../../apps/web/src/app/health) |

## Cross-cutting code outside module folders

| Code area | Responsibility | Navigation |
|---|---|---|
| `apps/api/src/common` | Shared DTOs, guards, filters, pipes, decorators, pagination, and utilities. | [`common`](../../apps/api/src/common) |
| `apps/api/src/infrastructure` | Prisma, Redis/cache, RabbitMQ, outbox, configuration, logging, mail, media, and resilience. | [`infrastructure`](../../apps/api/src/infrastructure) |
| `apps/web/src/app` and `apps/web/src/api` | App Router pages, portal layouts, typed clients, and server-side API adapters. | [Web contributor guide](../../apps/web/README.md) |
| `packages/database` | Prisma schema and ordered migrations. | [`database`](../../packages/database) |
| `packages/config` and `packages/types` | Shared tooling configuration and cross-workspace contracts. | [`packages`](../../packages) |
| `nginx` and Compose | Reverse proxy, TLS mounts, service topology, and environment-specific runtime configuration. | [`nginx`](../../nginx) · [`Compose`](../../docker-compose.yml) |
