# NUTS Web

The web application uses Next.js App Router for the customer storefront, vendor portal, and platform admin portal. It combines server-rendered public pages with typed browser API clients and TanStack Query for interactive data. This README is the frontend contributor guide. The [backend module map](../../docs/reference/backend-module-map.md) follows the API folders and links each one to its domain and web surface. The [NUTS Engineering & Distributed Systems Field Manual](../../docs/engineering/field-manual/README.md) covers cross-cutting concepts.

## Route and component layout

- src/app/(storefront) — public shopping routes, including /, /discover, /product/[slug], /search, /category, /cart, /checkout, /order, /vendor, and /vendor/[handle]. The old /product catalog path redirects to /discover.
- src/app/(vendor) — authenticated merchant catalog, inventory, order, analytics, and settings routes.
- src/app/(admin) — platform governance and operations routes.
- src/app/(auth) — customer, vendor, and admin authentication flows.
- src/components/domain/<feature> — feature components: auth, cart, category, home (homepage shelves), maintenance, notification, order, payments, product, promotions (campaign banner), review, search, vendor, voucher, wishlist, analytics.
- src/components/ui, form, data, feedback, modal, navigation, theme — shared building blocks that never import feature code.
- src/components/layout — app shells: storefront navbar, footer, bottom nav, and the vendor/admin panel shell and headers.
- src/api/services — one typed browser client per backend domain; src/api/core holds the HTTP clients; src/api/dto mirrors API contracts.
- src/api/server — server-side API adapters with Next.js cache and revalidation options.
- src/hooks and src/zustand — shared query hooks and client session/UI state; src/lib holds pure helpers; src/provider holds root providers.

There is a single import alias, `@/`, mapped to `src/`. Layering and naming rules are in [Code organization and dependency rules](../../docs/architecture/code-organization.md) and are checked by `npm run check:architecture`.

## Route map by portal

The web tree is organized by audience. These routes are frontend entry points; authorization and data ownership remain enforced by the API.

| Portal | Main routes and flows |
|---|---|
| Customer storefront | `/`, `/discover`, `/product/[slug]`, `/search`, `/category/[...slug]`, `/vendor`, `/vendor/[handle]`, `/cart`, `/checkout`, `/order`, `/order/[id]`, `/order-success`, `/review`, `/wishlist`, `/wallet`, `/account`, `/account/following`, account settings, and notifications. |
| Authentication | Customer login/registration, vendor login/registration, admin login/setup, logout, password recovery, and account reactivation. Referral codes are validated during customer registration and stats appear in account settings. |
| Vendor portal | Analytics, discounts, notifications, orders, products/variants, settings, and wallet. |
| Admin portal | Analytics, announcements, categories, discounts, notifications, orders, platform settings, products/variants, staff, users, and vendors. |
| Health | `/health` is a lightweight host liveness route, not a shopper page. |

The [backend module map](../../docs/reference/backend-module-map.md) maps these routes to the owning API modules. The API guide describes endpoint contracts and local backend setup.

## Discovery experience

The home shelves appear in this order: **A good place to start**; **Continue where you left off**; **Picked based on your activity**; **Shop by interest**; **New from vendors you follow**; and **Vendors to explore**. Product shelves show at most 12 products. The activity shelf appears as soon as at least one available recommendation remains after products already shown in earlier shelves are removed.

**Homepage skeleton loaders — no pre-fetched products:**
Homepage product shelves (`HomeProductShelves`, `GoodPlaceToStartSection`) do **not** pre-fetch product data on the server. Each shelf fetches only on the client using React Query, displaying a skeleton loader while data loads. This prevents the visible product-swap flash that would occur if pre-fetched products were replaced by a different personalised set after hydration.

**Scroll Position Restoration:**
The homepage integrates `useScrollRestoration` (`src/hooks/use-scroll-restoration.ts`). Shopper scroll coordinates are throttled and persisted to `sessionStorage`. When shoppers navigate into a product page and hit the browser back button, the hook coordinates double `requestAnimationFrame` cycles to smoothly restore the exact scroll depth without jarring jumps.

**A good place to start** is a horizontal sampler of up to 12 purchasable products with an image, and at most one product per vendor. The API builds it in one request (`/recommendations/good-place-to-start`): it starts with a daily spread across stores, stable per shopper or visitor identity for the UTC day, and uses relevant activity-based picks to fill available slots. Activity includes product views, clicks, searches, cart and wishlist actions, qualifying purchases, category views, and store follows. The spread favors fresh listings and balances vendors and categories; product rotation is stable per shopper or visitor identity for the UTC day. Product cards retain the plus-to-cart and wishlist actions; variant products open their detail page for option selection. Recommendation reason labels display `"Based on your shopping activity"` for activity-driven picks. **Shop by interest** links root categories to `/category/[slug]`, preserving the category hierarchy for further browsing. **Vendors to explore** remains a separate vendor focused section. The homepage does not duplicate the complete product feed.

**Recommendation and recent-history storage:** the browser stores only the recommendation session and visitor identifiers in `localStorage` (`nuts.recommendation-session.v2`, `nuts.recommendation-visitor.v1`, and the visitor creation timestamp). Product history is not kept in browser storage. Product views upsert PostgreSQL `recent_product_views` rows, keyed by account or anonymous visitor and product; the homepage reads them through `GET /api/v1/recommendations/recently-viewed` for **Continue where you left off**. Anonymous rows expire after 180 days; account rows are retained for account continuity, so older signed-in history does not disappear on that timer. When a shopper signs in, `RecentHistoryClaim` links available guest rows to the account. The visitor ID is rotated after 180 days and on an account switch.

**Picked based on your activity** is generated by `GET /api/v1/recommendations/for-you`; the product list itself is not saved in `localStorage`. The API ranks from persisted recent and legacy product views, recommendation clicks/impressions, searches, cart and wishlist activity, qualifying orders, category activity, and followed vendors. Recommendation event rows are retained for 180 days (follow/unfollow events are kept for follower-change reporting). TanStack Query caches responses in memory while the app is open; PostgreSQL activity records are the durable source.

**Storefront promotions and dynamic discount architecture:**
- **Header announcement ticker (`PlatformPromoTicker`):** Retrieves active and upcoming site-wide promotions using `GET /api/v1/public/discounts/campaigns`. Displays live ticking countdown timers with full precision (days, hours, minutes, and seconds) across both mobile and desktop screens without truncation, scroll dots across both mobile and desktop screens, and seamless light/dark theme styling with high-contrast elements that never interfere with the route progress bar. The React Query hook (`usePlatformPromos`) is configured with `staleTime: 5 * 60 * 1000` (5 minutes) and `refetchOnMount: false`, eliminating random or redundant background refetches when navigating across product pages while keeping campaigns fresh. Offers rotate automatically: each stays at least 5 seconds, longer for long text (+40 ms per character past 40, capped at 8 seconds); hovering (on devices that can hover), keyboard focus, or tapping, swiping or using the arrows/dots pauses rotation until 10 seconds after the last interaction (a mouse or tap click that merely leaves a button focused does not pause it); it never rotates in a background tab, and when the OS requests reduced motion the offers still rotate but without the slide animation. The timing rule lives in `src/lib/promo-timing.ts`.
- **On-Demand Taxonomy Loading on Catalogs:** Admin and vendor product catalog and discount management pages load category taxonomies on-demand (`enabled: open` or dropdown focus), preventing premature network calls to `GET /api/v1/categories` or `/admin/categories` on simple catalog view.
- **Vendor Discount Product Scoping:** Vendors can restrict discount coupons to specific products via an in-modal searchable catalog selector with SKU and pricing info, or apply them store-wide.
- **Admin & Vendor Streamlined Headers:** Redundant body section titles and descriptions across admin and vendor dashboards are eliminated in favor of clean, unified sticky headers displaying route context and responsive live marketplace/storefront shortcuts.
- **Product detail page vouchers dock (`ProductVoucherDock`):** Fetches the complete deal intelligence and claimable vouchers for an item via `GET /api/v1/public/discounts/:productId/available-product-deals-and-vouchers`. Distinguishes between immediately applicable vouchers (`bestDiscount`) and conditional spend goals (`unlockableDiscount`), providing real-time savings previews, one-click voucher claiming, and minimum spend progress indicators.
- **High-throughput batch deals (`useBatchProductDeals`):** Product grids, catalog feeds, and horizontal shelves coalesce deal lookups via `POST /api/v1/public/discounts/best-value-deal` (supporting single `productId` and batch `productIds` up to 100 products per request). The client queues product deal requests with a 350ms window (`PRODUCT_DEAL_BATCH_WINDOW_MS = 350`) and an in-memory LRU cache, completely eliminating database hammering and duplicate batch requests during page load. First-order-only vouchers are automatically filtered out for authenticated shoppers with prior orders. Single-product deals route directly to `GET /api/v1/public/discounts/:productId/available-product-deals-and-vouchers`.

**Maintenance mode:** a structured maintenance response activates a full-screen notice for customers and vendors with the message configured in Admin → Platform Controls. Regular API requests pause while the notice is active, avoiding retry loops; no separate polling request is made. **Check again** reloads the app to see whether service has returned, and admin routes remain accessible so an operator can disable maintenance. The client state is held in memory and is rediscovered from the API after a reload; it is not saved in browser storage.

Discover is titled **Good Finds Across the Market**, with the subtitle **Find your next favourite from vendors across NUTS.** It uses a server-rendered initial page followed by cursor-based requests to the sole discovery feed, GET /api/v1/discover. There is no retry against a second discovery URL. The filter drawer has underlined search inputs for stores and categories, plus suggested options shoppers can select directly; product search remains on /search. Price, in-stock, and sort controls are also in the drawer, and selected filters are kept in the URL. Shoppers see a personalized horizontal shelf when recommendations are available. Sort choices are newest, oldest, price low-to-high, and price high-to-low. The old /product catalog URL redirects to /discover.

Admin and vendor analytics default to a day view using Africa/Lagos calendar boundaries. While a dashboard is open and visible, summary queries refresh every 30 seconds and detail queries every 60 seconds; browser focus also triggers a refresh. This is periodic polling backed by short server caches, not instantaneous push. **Views** count product-view events and can repeat for the same person; **unique viewers** count distinct account or anonymous visitor/session identities in the selected period, without stitching them across login or devices. View-to-cart and view-to-paid-purchase use identified account/product pairs; cart-to-purchase matches distinct cart/product/variant lines. Each uses a seven-day attribution window, and recent cohorts can mature after the selected period. Revenue is gross before refunds. See [Analytics and Measurement](../../docs/domains/analytics-and-measurement.md) for full definitions and retention limits.

**Unified Telemetry, Store Views & Impression Batching:**
- **Consolidated Event Ingestion:** All behavioral analytics (`product_view`, `search`), storefront visits (`store_view`), and recommendation interactions (`CLICK`, `IMPRESSION`, etc.) route cleanly to a single endpoint: `POST /api/v1/analytics/events`.
- **Server-Side Optional Authentication:** Authentication is resolved on the server using `@OptionalAuth()`. Clients do not branch into `/authenticated` or `/guest` endpoints, eliminating artificial route splits like `/store-view/authenticated`.
- **SSR Prefetched Campaigns & High-Contrast Progress Bar:** Top banners prefetch platform discount campaigns on the server (`serverGetPlatformPromos`) for instantaneous hydration. That list is anonymous, so it is trusted only for a confirmed guest; signed-in customers fetch their own list so first-order-only offers never reach returning customers, and the route progress bar uses high-contrast emerald glow gradients visible across both light and dark modes.
- **Batch Impression Queue:** Product impression events in `src/api/services/analytics.ts` are buffered with a 2,000ms window (`IMPRESSION_BATCH_WINDOW_MS = 2000`) and a maximum threshold of 100 events (`IMPRESSION_BATCH_THRESHOLD = 100`, matching backend DTO batch limits). This ensures all cards across multiple homepage shelves settle into a single network call on initial page load.
- **Deduplication & Pagehide Flush:** Impressions are deduplicated using composite `${sessionId}:${surface}:${entityId}` keys to avoid duplicate telemetry for already-viewed items. An active `pagehide` listener guarantees all pending telemetry flushes before navigating away or closing tabs.
- **Inactive Query Preservation:** Product view tracking invalidates recommendation queries using `refetchType: "active"`, marking inactive homepage queries as stale without triggering background network requests while viewing product detail pages.

## Push notifications

The web client uses the [Web Push API](https://www.w3.org/TR/push-api/) with VAPID keys to deliver push notifications. Push notification state is managed in `src/hooks/use-push-notifications.ts` and exposed to the UI through `src/components/domain/notification/NotificationPreferencesView.tsx`; the root provider mounts `PushNotificationHost` from `src/components/domain/notification`.

**Support detection and guidance (`src/lib/push-support.ts`):** "unsupported" is split into its real causes, each with its own message and steps: insecure (non-HTTPS) page, Brave (the Push API is hidden until *Use Google services for push messaging* is enabled in `brave://settings/privacy`, so the screen shows the steps and a copy button), iPhone/iPad Safari outside the Home Screen (add the site to the Home Screen), and browsers with no Push API. A failed `pushManager.subscribe()` is translated to a specific explanation (blocked, push service unreachable, stale registration). Email and in-app notifications keep working whatever push does.

**Permission prompt (`PushNotificationHost`):** signed-in users see an in-app prompt first, about 6 seconds after load and only while the browser permission is undecided; the browser's one-shot dialog opens only when they tap *Turn on*. *Not now* snoozes the prompt with backoff (3 days, 2 weeks, then 2 months). The prompt is never shown where push cannot work.

**Architecture decisions:**

- **Preference-only toggle (no subscription destruction):** Toggling the push notification switch off calls `PATCH /api/v1/notifications/preferences` with `{ pushEnabled: false }` only. The browser's FCM push subscription token is **not** revoked via `PushSubscription.unsubscribe()`. Destroying the browser subscription causes Chrome's FCM daemon to enter a cooldown that prevents immediate re-subscription (`DOMException: Registration failed - push service error`). Production apps (Slack, GitHub, Twitter) follow the same pattern: account preferences gate delivery; the device token stays warm.
- **Single PATCH call per toggle:** The switch's `onChange` handler is the sole owner of `PATCH /notifications/preferences`. The push hook (`usePushNotifications`) manages only the browser's device token (`subscribePush` / `unsubscribePush`) and local `isSubscribed` state; it never independently fires a preferences update. This prevents the duplicate-call pattern where the UI and hook both issue a PATCH on the same toggle click.
- **Global Zustand store for push state:** `usePushStore` (a Zustand store inside the hook module) holds `isSubscribed`, `isLoading`, and `permission` as shared module-level state. This means `PushNotificationHost` (mounted at the root in `Provider.tsx`) and `NotificationPreferencesContent` (mounted on the settings page) share one unified state without double-syncing on mount.
- **VAPID key in memory:** `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is baked into `inMemoryVapidKey` at module load time (compile-time constant). The `GET /api/v1/notifications/push/vapid-key` HTTP request is only made as a fallback if the in-memory key is missing, and concurrent callers share one in-flight promise (`vapidFetchPromise`) to prevent duplicate requests.
- **60-second sync cooldown:** `syncDeviceState()` (the background hook that checks the existing browser subscription and registers it with the backend) is guarded by a module-level `globalSyncPromise` and a `60_000ms` cooldown window, ensuring it runs at most once per minute regardless of how many hook instances mount or remount.
- **Environment-gated Test Alert button:** The "Send Test Alert" button in the notification preferences UI is controlled by:
  ```ts
  const isDevelopmentEnv =
    process.env.NODE_ENV === "development" &&
    process.env.NEXT_PUBLIC_APP_ENV !== "staging" &&
    process.env.NEXT_PUBLIC_APP_ENV !== "production";
  ```
  `NEXT_PUBLIC_APP_ENV` is explicitly defined in each env file: `development` in `.env` / `.env.development`, `staging` in `.env.staging`, and `production` in `.env.production`. Next.js inlines these at build time, so the button code is dead-code eliminated in staging and production bundles entirely.

**Required environment variables:**

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | `apps/web/.env*` | VAPID public key served to the browser for push subscription. Must match the API's `VAPID_PUBLIC_KEY`. |
| `NEXT_PUBLIC_APP_ENV` | `apps/web/.env*` | Controls environment-gated UI features (e.g., Test Alert button). Set to `development`, `staging`, or `production`. |
| `VAPID_PUBLIC_KEY` | `apps/api/.env*` | VAPID public key used by the web-push engine for VAPID authentication. |
| `VAPID_PRIVATE_KEY` | `apps/api/.env*` | VAPID private key (keep secret). |
| `VAPID_SUBJECT` | `apps/api/.env*` | Contact URI (`mailto:`) for VAPID auth. |

## Category browsing and portal responsiveness

Category root pages retain the horizontal text-tab layout. **Top Picks** and each direct-subcategory section use hash anchors with scroll offsets; scroll position, URL hash, selected tab, and the breadcrumb stay aligned. Product previews are capped at 12 items per direct subcategory. **View all** opens that subcategory's own listing, which uses normal page-based results of 24 products per request. Shopper-facing category tabs and previews do not show product totals.

Vendor and admin dashboards share a responsive shell: desktop uses a fixed sidebar, while smaller screens open the navigation as a dismissible modal drawer with an overlay and Escape-key support. Content areas keep min-width constraints and scale padding across breakpoints so tables and charts fit narrower screens. This shell is presentation behavior; role access remains enforced by the API.

## Authentication and API calls

The API issues short-lived access and rotating refresh cookies with HttpOnly and environment-appropriate Secure settings. The browser keeps the access token in memory for bearer requests; cookie-authenticated writes use the CSRF cookie/header pair. Cookies are separate per role (customer, vendor, admin), and vendor/admin sessions are per device; see [Identity, Accounts, and Security](../../docs/domains/identity-and-account-security.md). `src/lib/session-keepalive.ts` refreshes tokens a minute before they expire and when a tab regains focus or the network returns, and `getServerSession(portal)` in `src/lib/server-auth.ts` reads the cookies of the portal being rendered.

The notification SSE client uses `fetch`, sends the access token in the `Authorization: Bearer` header, and includes cookies. The URL never contains the access token; only the non-secret `lastEventId` replay cursor may appear in the query string.

**Google Identity Services (GIS) Sign-In Architecture:**
Customer and vendor flows provide official Google Identity Services sign-in:
- **Zero Hydration Mismatch:** The `<GoogleSignInButton>` component always renders the official Google 4-color SVG icon and branded container immediately on first paint, avoiding React Error #418 hydration mismatches.
- **Gesture Overlay:** An invisible GIS iframe overlay (`opacity-[0.0001]`) sits over the branded button to capture native user gestures directly, satisfying Google's FedCM and pop-up policies without blocking.
- **Docker Build-Time Inlining:** Next.js embeds `NEXT_PUBLIC_*` variables at Docker build time. The `apps/web/Dockerfile` declares `ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID` and `ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID`, and the GitHub Actions deployment workflow (`deploy.yml`) passes this build argument from repo secrets/variables.
- **Graceful Unconfigured Fallback:** If `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is missing in a local or preview environment, clicking the button displays an informative, non-blocking toast rather than crashing the application.
- **Canonical API Integration:** The web client sends the ID token to the role-scoped API endpoint; the API cryptographically validates it and issues the session. Google sign-in links existing accounts, while Google registration creates new ones. Vendor sign-in requires an active, approved account. Configure `NEXT_PUBLIC_GOOGLE_CLIENT_ID` to match API `GOOGLE_CLIENT_ID`. The server-side web application verifies access cookies using `JWT_SECRET`, which must match the API's secret.

For Google sign-in origin errors, check the OAuth **Web application** credential whose client ID is in `NEXT_PUBLIC_GOOGLE_CLIENT_ID`. Under **Authorized JavaScript origins**, add the exact origin shown by the development-only `[Google Sign-In] origin=... client_id=...` browser log. Local development on the default port needs `http://localhost` and `http://localhost:5173`; `http://127.0.0.1:5173`, a different port, and an HTTPS origin are separate origins and must be added when used. Enter origins without a path. Compare the logged client ID with the credential being edited, and confirm API `GOOGLE_CLIENT_ID` matches it. Restart the web dev server after changing the public environment variable so Next.js rebuilds the client bundle. This origin error is separate from the FedCM prompt-status warning; the sign-in component does not inspect deprecated prompt display/skip status methods.

After customer sign-in, the client can claim anonymous recent product history for recommendation continuity. This does not merge anonymous analytics identities. `/account/following` manages followed stores; followed-store news and follower counts come from separate relationship and analytics endpoints.

Use public, vendor, or admin API clients from src/api/services based on the operation's authority. Server components should use src/api/server adapters and the configured INTERNAL_API_URL. Do not place private provider secrets in `NEXT_PUBLIC_` variables. Admin announcements are audience-specific in-app campaigns for customers or approved vendors. The admin UI supports drafts, scheduling, publishing, and archiving, with campaign status and recipient progress returned by the API. Platform settings and staff lifecycle changes are available in the admin portal and require admin authorization.

## Responsive and touch rules

These rules keep every screen from phones to large desktops usable; follow them when adding UI.

- **Breakpoints:** phones are below `sm` (640px), tablets `sm`-`lg`, laptops `lg`-`xl`, desktops `xl` and up. The storefront shows the bottom navigation below `xl`; vendor and admin panels show the sidebar from `lg` and a hamburger below it. Tables (`DataTable`) switch to stacked cards below `md`.
- **Dialogs:** Tailwind v4 centres dialogs with the individual `translate` property, and the CSS minifier rewrites a `translate: none` override into a `transform` shorthand that does not cancel it. So never undo centring in CSS: `components/ui/dialog.tsx` builds the phone sheet without any translate (`inset-0`, centring only from `sm:`). On phones a form dialog is a full-screen sheet with a pinned action bar (the `DialogFooter` sticks to the bottom); small confirmations use `<DialogContent mobile="center">` so they stay a centred card. The sheet fixes its single grid column to the screen width so one wide child cannot stretch it.
- **Inputs:** text fields are at least 16px on touch screens (stops iOS zooming on focus) and at least 44px tall in panels and dialogs; date and time inputs are forced to the container width.
- **Rows with actions:** `DataTable` ignores a row click that starts on a button, link or field inside the row, so pressing "Mark delivered" never also opens the row's details sheet. Long order numbers, ids and product names use `break-all`/`break-words` with `min-w-0` on their flex parents so they wrap instead of pushing prices off-screen.
- **Light/dark and the browser bar:** a phone's status/address bar takes its colour from `<meta name="theme-color">`, not from the page. The root layout renders it from the saved `nuts_theme` cookie (the OS-based pair only when the choice is "system"), and `src/lib/theme-color.ts` keeps it in step with the chosen theme live. **Never remove, move or edit the theme-color tags Next/React render:** React 19 hoists `<meta>` tags into `<head>` and removes them itself on navigation, so a script that already deleted one makes React throw "Cannot read properties of null (reading 'removeChild')" and the app freezes (this broke staging once). Instead the helper (and the inline theme script) owns ONE extra tag marked `data-nuts-theme-color`, placed first in `<head>`; the first matching theme-color tag in document order wins, so ours decides the colour and React's are left untouched. `html` also has the page background so the overscroll area matches. Keep the two colours in `THEME_COLORS` equal to `--background` in `globals.css`.
- **Heights:** use `dvh`/`svh` units (`min-h-dvh`, `max-h-[90dvh]`), never `vh`, so the mobile address bar does not cut content off.
- **Hover-only controls** (image remove/reorder, row actions) must also be reachable on touch: show them by default under `@media (hover: none)`.
- **Popups that use `position: fixed`** must not live inside an element with `backdrop-filter` (the bottom nav, sticky headers): that element becomes their containing block. Render them in a portal (the notification bell does).
- **Fonts:** the Next font variable is `--font-inter`, declared on `<html>` so `:root` can resolve it; Tailwind owns `--font-sans`. Never define one from the other (a cycle makes the whole stack invalid and the browser falls back to a serif default).
- **Back links:** use `BackLink` so Back returns to where the user came from. Its "Back to ..." wording comes from `describePath` in `src/lib/navigation-history.ts`, which names a single page (an order, a message) differently from its list and gives each portal page its own name; add a pattern there (with a test) when you add a route.

## My vouchers

`/vouchers` is a standalone page (not part of My Account) linked from the account dropdown and the account overview; `/account/vouchers` redirects to it. It lists the customer's claimed vouchers under **Available** and vouchers they have used up under **Used**.

## Automatic discounts in the UI

The vendor and admin discount forms share `AutomaticDiscountFields` (an "Apply automatically" switch and an optional minimum item count). Automatic discounts hide the code field, are named by the description, and appear in lists with an "Automatic" badge. In the cart, drawer and checkout, `useClaimedVoucherSync` asks the API for a preview with `automatic=1` even when the shopper holds no codes; automatic discounts are shown with an "Auto" tag and no Remove button, and are never sent as typed codes at checkout.

## Local development and builds

From the repository root, install with **npm ci** and create `apps/web/.env.development` from [`apps/web/.env.example`](.env.example). For the full stack, run **npm run dev:turbo**; the web dev command waits for the API health endpoint before Next.js starts. To run the apps separately, start **npm run dev:api** first, then **npm run dev:web**. The web startup check reads `INTERNAL_API_URL` or `NEXT_PUBLIC_BACKEND_URL` from the development environment and waits up to 120 seconds by default; set `WEB_API_STARTUP_TIMEOUT_MS` to change that limit. The local web app listens on port 5173. With Compose, the host port also defaults to 5173 while the container listens on 3000. The root [quickstart](../../README.md#quickstart) explains the matching API and local database setup.

- **npm run typecheck:web** runs web TypeScript checking.
- **npm run lint:web** runs web ESLint.
- **npm run build:web** creates the production build.
- **npm run --prefix apps/web test:unit** runs the web unit suite.

The production Docker image uses Next standalone output and runs as a non-root user. The app liveness endpoint is **/health**. Production/staging Compose selects apps/web/.env.production or apps/web/.env.staging based on the root APP_ENV setting.

See the [architecture diagrams](../../docs/architecture/README.md) for cross-app flows, [Performance and Capacity](../../docs/performance/README.md) for benchmark methodology/results, and [Scaling Strategy](../../docs/scaling/README.md) for future directions.
