# NUTS Platform — Web Client Application (`apps/web`)

[![Next.js 16](https://img.shields.io/badge/Next.js-16.x-black.svg)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19.x-61dafb.svg)](https://react.dev/)
[![TypeScript 5.8](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-CSS-38B2AC.svg)](https://tailwindcss.com/)
[![Zustand](https://img.shields.io/badge/State-Zustand-orange.svg)](https://github.com/pmndrs/zustand)
[![TanStack Query](https://img.shields.io/badge/Cache-TanStack_Query-FF4154.svg)](https://tanstack.com/query)

> **`apps/web`** is the Next.js 16 unified front-end client for the NUTS Platform. It delivers an enterprise multi-vendor e-commerce experience partitioned across three distinct user domains (Customer Storefront, Merchant Portal, and Platform Administration) powered by React 19 Server Components, App Router routing, and banking-grade in-memory authentication.

---

## Architecture & Layout Domains

The web client organizes routes into route groups with dedicated layout boundaries:

```
apps/web/src/app/
├── (storefront)/        # Public shopping experience
│   ├── category/        # Deep-slug hierarchical taxonomy browsing
│   ├── product/         # Product detail pages & variant selectors
│   ├── cart/            # Full-page cart overview
│   ├── checkout/        # Order placement & Paystack handoff
│   ├── order/           # Order tracking, live status & payment retry
│   ├── store/           # Branded merchant storefronts (/store/[slug])
│   ├── vendors/         # Marketplace vendor directory
│   └── search/          # Full-text exploratory search
├── (vendor)/            # Authenticated merchant portal
│   ├── vendor/product/  # Merchant product management & variant editor
│   └── vendor/orders/   # Vendor fulfillment & order pipeline
├── (admin)/             # Back-office administration portal
│   ├── admin/category/  # Recursive taxonomy tree management
│   └── admin/product/   # Platform-wide product catalog moderation
└── (auth)/              # Multi-step authentication workflows
    ├── auth/register/   # 3-step customer registration wizard
    ├── auth/login/      # Customer & merchant credential authentication
    ├── auth/vendor/     # Merchant self-service onboarding
    └── auth/forgot-password/ # 2-stage OTP password recovery
```

---

## Core Systems & Component Surfaces

### 1. Multi-Step Onboarding & Identity Flows
- **Customer Registration (`RegisterPage` at `/auth/register`):**
  - **Step 1:** Profile data, password complexity enforcement (`/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#]).*$/`), and live referral pre-check against `/api/v1/account/referral/validate`.
  - **Step 2:** Strict 6-digit numeric OTP email verification with resend cooldown timer.
  - **Step 3:** Immediate initial delivery address capture (`fullName`, `phone`, `street`, `city`, `state`, `country`).
- **Merchant Onboarding (`VendorRegisterPage` at `/auth/vendor/register`):** 4-step progressive onboarding wizard: Step 1 (Store credentials & password complexity), Step 2 (Strict 6-digit OTP email verification with live cooldown timer), Step 3 (Store description & business contact details), Step 4 (Status & pending administrative review screen with approval pipeline explanation).
- **Password Recovery (`ForgotPasswordPage` at `/auth/forgot-password`):** Rate-limited OTP dispatch followed by OTP validation and 12+ character replacement password setting with immediate revocation of existing browser sessions.

### 2. Catalog & Discovery Surfaces
- **Interactive Search Drawer ([`SearchDrawer.tsx`](file:///c:/MY%20PROJECT/NUTS-P/apps/web/src/components/search/SearchDrawer.tsx)):** Portal-mounted search modal with debounced query execution, exploratory category pills, and multi-entity grouping (Products, Categories, Stores, Coupons).
- **Hierarchical Category Traversal ([`category-tree.ts`](file:///c:/MY%20PROJECT/NUTS-P/apps/web/src/lib/category-tree.ts)):** Client tree engine that recursively resolves nested URL slugs of arbitrary depth (e.g. `/category/apparel/footwear/running-shoes`), maintaining breadcrumbs and subcategory filters.
- **Category Tree Picker ([`CategoryPicker.tsx`](file:///c:/MY%20PROJECT/NUTS-P/apps/web/src/components/form/CategoryPicker.tsx)):** Admin and vendor taxonomy explorer with instant path search and leaf-only selection enforcement.
- **Multi-Variant Builder ([`ProductVariantBuilder.tsx`](file:///c:/MY%20PROJECT/NUTS-P/apps/web/src/components/domain/product/ProductVariantBuilder.tsx)):** Multidimensional attribute matrix configuration (Size, Color, Material) with independent SKUs, stock levels, and compare-at prices.

### 3. Merchant Marketplace Surfaces & Storefront Operator Mode
- **Storefront Operator Navigation & Privilege Isolation ([`Navbar.tsx`](file:///c:/MY%20PROJECT/NUTS-P/apps/web/src/components/navbar/Navbar.tsx) & [`BottomNav.tsx`](file:///c:/MY%20PROJECT/NUTS-P/apps/web/src/components/layout/BottomNav.tsx)):** Contextual operator navigation integrated across storefront layouts when authenticated as an Administrator (`canAdminister`) or Merchant (`canSell`). Disables consumer carts and purchasing actions to prevent accidental transactions while offering one-click shortcuts back to Admin/Vendor Consoles, Catalogs, Orders, and Settings.
- **Storefront Merchant & Admin Oversight ([`VendorStoreView.tsx`](file:///c:/MY%20PROJECT/NUTS-P/apps/web/src/components/domain/vendor/VendorStoreView.tsx)):** Contextual management header displayed on public vendor storefronts giving merchants direct shortcuts to manage products, branding, and dashboard, and giving administrators oversight controls to audit vendor items and inspect KYC credentials.
- **Product Detail Operator Inspection ([`ProductDetailView.tsx`](file:///c:/MY%20PROJECT/NUTS-P/apps/web/src/components/domain/product/ProductDetailView.tsx)):** Replaces consumer purchase steppers with role-aware preview banners ("Vendor Catalog Preview" or "Administrator Preview") with deep-links directly into back-office catalog editors.
- **Branded Merchant Storefront ([`VendorStoreView.tsx`](file:///c:/MY%20PROJECT/NUTS-P/apps/web/src/components/domain/vendor/VendorStoreView.tsx)):** Public storefront at `/store/[slug]` featuring server-hydrated store data, vendor initials fallback badge (`getStoreInitials`), verified merchant badging, store-specific product search, price range filtering, and horizontal scrolling category tabs.
- **Merchant Directory ([`VendorsPageView.tsx`](file:///c:/MY%20PROJECT/NUTS-P/apps/web/src/components/domain/vendor/VendorsPageView.tsx)):** Directory of platform merchants at `/vendors` with search, verification status, product counts, and rating aggregations.
- **Management Operator Toolbar ([`ManagementToolbar.tsx`](file:///c:/MY%20PROJECT/NUTS-P/apps/web/src/components/common/ManagementToolbar.tsx)):** Standardized control surface for administrative and vendor grids (`/admin/product`, `/admin/category`, `/admin/order`, `/admin/vendor`, `/admin/user`, `/admin/discount`, `/vendor/product`, `/vendor/order`, `/vendor/discount`) featuring debounced search with clear trigger, dual dynamic select filters, active filter reset action, live spinning refresh indicator (`RefreshCw`), and custom action slots.
- **Enterprise Unified Data Grid ([`DataTable.tsx`](file:///c:/MY%20PROJECT/NUTS-P/apps/web/src/components/data/DataTable.tsx)):** Type-safe generic data grid supporting configurable column definitions (`Column<T>`), dual-model pagination (`DataTablePagination` for cursor or page/limit offset), 6-row skeleton pulse loading states, empty-state illustrations, and interactive row click handlers across all back-office operational portals.
- **Promotions & Discount Code Portals (`/admin/discount` & `/vendor/discount`):** Complete campaign creation and governance surfaces featuring interactive modal editors with Zod schema validation, percentage/fixed discount calculations, 1-click clipboard code copy, and confirmation dialog guards.
- **Defensive Confirmation Dialogs & OTP Prompts ([`ConfirmDialog.tsx`](file:///c:/MY%20PROJECT/NUTS-P/apps/web/src/components/modal/ConfirmDialog.tsx) & [`OtpPromptDialog.tsx`](file:///c:/MY%20PROJECT/NUTS-P/apps/web/src/components/modal/OtpPromptDialog.tsx)):** Intercepts all administrative and merchant state-altering operations with accessible, high-visibility confirmation modals prior to network dispatch:
  - **Admin Actions:** Approving vendor stores, verifying KYC credentials, suspending/reactivating vendor accounts, suspending user accounts (with configurable durations and mandatory justification), unsuspending users, executing user account deletion with 2FA OTP, toggling product active status, purging Redis taxonomy cache, restoring archived categories, and reactivating promotional codes.
  - **Vendor Actions:** Deactivating and reactivating products, deleting products, advancing order fulfillment stages (both table-driven and modal-driven via `OrderDetailsModal`), deactivating discount coupons, reactivating inactive coupons, deleting unused coupons, and deactivating/deleting merchant store profiles.
- **Recursive Category Hierarchy Search ([`admin/category/page.tsx`](file:///c:/MY%20PROJECT/NUTS-P/apps/web/src/app/%28admin%29/admin/category/page.tsx)):** Visual taxonomy explorer that recursively filters nested category nodes and dynamically expands matching branch paths upon search and status filter updates.
- **Multi-Asset Drag-and-Drop Pipeline ([`ImageUpload.tsx`](file:///c:/MY%20PROJECT/NUTS-P/apps/web/src/components/form/ImageUpload.tsx)):** Role-aware uploader (`admin` vs. `vendor`) supporting up to 6 images with local thumbnail preview queues, per-file pre-upload cancellation, 5MB file cap, MIME validation, primary cover star selection, and Cloudinary batch uploading.

### 4. Shopping Cart, Checkout Orchestration & Payment Resumption
- **Shopping Cart Drawer ([`ShoppingDrawer.tsx`](file:///c:/MY%20PROJECT/NUTS-P/apps/web/src/components/domain/cart/ShoppingDrawer.tsx)) & Full Cart View ([`CartPageView.tsx`](file:///c:/MY%20PROJECT/NUTS-P/apps/web/src/components/domain/cart/CartPageView.tsx)):** Slide-over drawer with optimistic item adjustments, line-item subtotal recalculation, and seamless navigation to `/checkout`.
- **Checkout Wizard ([`CheckoutFlow.tsx`](file:///c:/MY%20PROJECT/NUTS-P/apps/web/src/components/domain/cart/CheckoutFlow.tsx)):** Live address selection with inline address capture, discount code validation preview, and idempotent order placement (`Idempotency-Key`).
- **Pure In-Memory Discount Store ([`discount.ts`](file:///c:/MY%20PROJECT/NUTS-P/apps/web/src/zustand/discount.ts)):** Manages active promotional coupon codes and preview amounts exclusively in-memory (`useDiscountStore`) across ShoppingDrawer, CartPageView, and Checkout without writing coupons to `localStorage`. Prevents cross-session leaks and ensures stale promotional state vanishes upon browser restart.
- **Immediate Client Cart Clearing & Gateway Lifecycle ([`cart-cleanup.ts`](file:///c:/MY%20PROJECT/NUTS-P/apps/web/src/lib/cart-cleanup.ts)):**
  - **Atomic Handoff:** Invokes `clearClientCart(queryClient)` the instant checkout order placement succeeds. This immediately resets React Query caches, clears Zustand optimistic cart states, and resets active discount coupons.
  - **Financial Idempotency & Stock Protection:** Matches backend order creation logic where cart items are consumed inside the ACID transaction. This prevents duplicate orders, stops stock hoarding, and blocks duplicate payment attempts if a customer hits the browser "Back" button from Paystack.
- **Storefront Self-Healing & Order Polling ([`order/[id]/page.tsx`](file:///c:/MY%20PROJECT/NUTS-P/apps/web/src/app/%28storefront%29/order/%5Bid%5D/page.tsx)):** Polls every 3 seconds while `order.status === 'PENDING'`, running a silent background verification against Paystack. If the customer completed payment on Paystack but closed the window before redirecting to the callback URL, the order page settles the transaction and advances the UI to `PROCESSING` on load.
- **Safe Gateway Redirection:** Validates payment authorization links through domain-guarded `safePaystackCheckoutUrl`, enforcing navigation exclusively to `https://checkout.paystack.com/*`.

### 5. Real-Time Notification Pipeline
- **SSE Stream Lifecycle ([`use-notifications.ts`](file:///c:/MY%20PROJECT/NUTS-P/apps/web/src/hooks/use-notifications.ts)):** Manages live Server-Sent Events connections at `/api/v1/notifications/sse/stream` scoped to the active portal role.
- **Connection Policy ([`notification-stream-policy.ts`](file:///c:/MY%20PROJECT/NUTS-P/apps/web/src/lib/notification-stream-policy.ts)):** Limits stream reconnect retries to a maximum of 3 failures (`MAX_NOTIFICATION_STREAM_FAILURES = 3`), retrying selectively on status 429 and server errors >= 500 while avoiding tight retry loops on proxy 502 Bad Gateway responses.
- **CORS Preflight & Event Reconnection:** Fully supports W3C event resumption via `Last-Event-ID` and `last-event-id` headers alongside `Cache-Control: no-store` whitelisted in API CORS configuration, ensuring cross-origin reconnections succeed without preflight blocks.
- **Pure In-Memory Notification Store ([`notifications.ts`](file:///c:/MY%20PROJECT/NUTS-P/apps/web/src/zustand/notifications.ts)):** Removed all persistent local storage middleware (`nuts_notifications_cache`). All notifications, read statuses, and unread counters are stored exclusively in memory and updated live via REST and SSE, eliminating data stale-caching and cross-user leaks on shared devices.

- **Dual-Layer Push & Desktop Notifications ([use-push-notifications.ts](file:///c:/MY%20PROJECT/NUTS-P/apps/web/src/hooks/use-push-notifications.ts)):** Supports background VAPID WebPush and native HTML5 desktop notifications. When browser privacy shields (e.g. Brave) or corporate networks block remote push gateways, the client seamlessly and silently falls back to in-browser desktop notifications.
- **Granular Notification Preferences ([NotificationPreferencesView.tsx](file:///c:/MY%20PROJECT/NUTS-P/apps/web/src/components/domain/notification/NotificationPreferencesView.tsx)):** Single-switch preference controls for delivery channels and functional event categories with environment-gated test alerts (`Send Test Alert` rendered strictly in development).
- **Responsive Notification Surfaces ([NotificationBell.tsx](file:///c:/MY%20PROJECT/NUTS-P/apps/web/src/components/domain/notification/NotificationBell.tsx), [NotificationsManager.tsx](file:///c:/MY%20PROJECT/NUTS-P/apps/web/src/components/domain/notification/NotificationsManager.tsx)):** Mobile-centered header dropdown with backdrop overlay preventing clipping across Storefront, Vendor Dashboard, and Admin Console, with high-density inbox views and touch-ready action buttons.

### 6. Client Security & Pure Token Session Architecture
- **In-Memory Token Hygiene ([`token-storage.ts`](file:///c:/MY%20PROJECT/NUTS-P/apps/web/src/api/core/token-storage.ts)):** JWT access tokens are retained strictly in private closure memory, immune to XSS theft.
- **Zero Client Storage Leakage:** Completely eradicated all synthetic role and session keys (`nuts_active_role`, `nuts_session_role`, `nuts_notifications_cache`, `nuts_applied_discount`, `nuts_cart_snapshot`) from `localStorage` and `sessionStorage`. Session authority and permissions are derived strictly from:
  1. Decoded in-memory JWT claims (`decodeRoleFromToken`, `getAuthSessionRole()`).
  2. Server-controlled `HttpOnly`, `SameSite`, `Secure` refresh cookies verified against Redis security stamps.
- **Multi-Portal Auth Routing & Role Boundaries ([`portal-role.ts`](file:///c:/MY%20PROJECT/NUTS-P/apps/web/src/lib/portal-role.ts), [`PublicOnlyLayout.tsx`](file:///c:/MY%20PROJECT/NUTS-P/apps/web/src/components/domain/auth/PublicOnlyLayout.tsx)):** Enforces role-matched redirection across storefront, vendor, and admin auth paths. Users authenticated in one role can navigate to another role's auth page without encountering infinite redirect loops or panel bouncing.
- **Cross-Tab Session Role Synchronization ([`auth.ts`](file:///c:/MY%20PROJECT/NUTS-P/apps/web/src/zustand/auth.ts)):** Synchronizes active portal role state across open browser tabs, supported by silent fallback to the universal `/auth/refresh` endpoint during cold-start cookie hydration.
- **Deterministic Double-Submit CSRF Defense ([`client.ts`](file:///c:/MY%20PROJECT/NUTS-P/apps/web/src/api/core/client.ts)):** Request interceptor attaches a single, sanitized `x-csrf-token` header extracted from the `csrf_token` cookie, preventing Axios default duplicate header concatenation.
- **Multi-Tab Token Refresh Mutex (Web Locks API):** Refreshes tokens using `navigator.locks.request("nuts-auth-refresh:{role}")`, collapsing concurrent multi-tab refresh attempts into a single network flight.
- **Cross-Tab Event Synchronization ([`auth-events.ts`](file:///c:/MY%20PROJECT/NUTS-P/apps/web/src/lib/auth-events.ts)):** BroadcastChannel coordinates `LOGIN`, `LOGOUT`, and `SESSION_EXPIRED` events across tabs, immediately purging in-memory tokens and query caches on logout without page reloads.
- **Dynamic Content Security Policy ([`proxy.ts`](file:///c:/MY%20PROJECT/NUTS-P/apps/web/src/proxy.ts)):** Generates Web Crypto nonces per request, enforcing strict script and style restrictions alongside Paystack, Cloudinary, and Google authentication origins while stripping spoofed client identity headers.

---

## Local Development

```bash
# Start Next.js web client on port 5173
npm run dev --prefix apps/web

# Execute frontend TypeScript type checking
npm run typecheck --prefix apps/web

# Execute frontend unit test suites
npm run test:unit --prefix apps/web

# Build optimized production bundle
npm run build --prefix apps/web
```
