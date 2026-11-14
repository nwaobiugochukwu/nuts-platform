# NUTS Web

The web application uses Next.js App Router for the customer storefront, vendor portal, and platform admin portal. It combines server-rendered public pages with typed browser API clients and TanStack Query for interactive data. This README is the frontend contributor guide. The [backend module map](../../docs/reference/backend-module-map.md) follows the API folders and links each one to its domain and web surface. The [NUTS Engineering & Distributed Systems Field Manual](../../docs/engineering/field-manual/README.md) covers cross-cutting concepts.

## Route and component layout

- src/app/(storefront) — public shopping routes, including /, /discover, /product/[slug], /search, /category, /cart, /checkout, /order, /vendor, and /vendor/[handle]. The old /product catalog path redirects to /discover.
- src/app/(vendor) — authenticated merchant catalog, inventory, order, analytics, and settings routes.
- src/app/(admin) — platform governance and operations routes.
- src/app/(auth) — customer, vendor, and admin authentication flows.
- src/components/domain — product, cart, category, vendor, notification, and identity surfaces.
- src/components/home — homepage shelves for a featured store, personalized product activity, the cross-store feed, followed vendors, and vendor discovery.
- src/api/modules — typed browser API modules.
- src/api/server — server-side API adapters with Next.js cache and revalidation options.
- src/hooks and src/zustand — shared query hooks and client session/UI state.

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

The home shelves appear in this order: **A good place to start**; **Recently viewed / Continue where you left off**; **Based on your activity / Picked for you**; **Shop by interest**; **Your followed stores / New from vendors you follow**; and **Vendors to explore**. Personalized product shelves render only when real recommendations or recently viewed products are available, and show no more than 12 products. **Picked for you** waits for at least four unique recommendations after products already shown in earlier shelves are removed.

**Instant Homepage Pre-fetching & Loading Performance:**
The homepage (`src/app/page.tsx`) server-side pre-fetches trending products (`serverGetTrendingProducts({ limit: 12 })`) in parallel alongside categories and active promotions during initial SSR. Pre-fetched products hydrate directly into `<HomeProductShelves initialProducts={...}>`, completely eliminating client-side layout shifts and blank loading spinners on initial paint.

**Scroll Position Restoration:**
The homepage integrates `useScrollRestoration` (`src/hooks/use-scroll-restoration.ts`). Shopper scroll coordinates are throttled and persisted to `sessionStorage`. When shoppers navigate into a product page and hit the browser back button, the hook coordinates double `requestAnimationFrame` cycles to smoothly restore the exact scroll depth without jarring jumps.

**A good place to start** is a horizontal sampler of up to 12 purchasable products with an image, and at most one product per vendor. The homepage starts with up to eight activity based picks, then fills from a stable daily rotating marketplace mix; if that mix cannot fill the remaining slots, additional relevant products can fill the gap. Activity includes product views, clicks, searches, cart and wishlist actions, qualifying purchases, category views, and store follows. The mix favors fresh listings and balances vendors and categories; product rotation is stable per shopper or visitor identity for the UTC day. Product cards retain the plus-to-cart and wishlist actions; variant products open their detail page for option selection. **Shop by interest** links root categories to `/category/[slug]`, preserving the category hierarchy for further browsing. **Vendors to explore** remains a separate vendor focused section. The homepage does not duplicate the complete product feed.

Discover is titled **Good Finds Across the Market**, with the subtitle **Find your next favourite from vendors across NUTS.** It uses a server-rendered initial page followed by cursor-based requests to the sole discovery feed, GET /api/v1/discover. There is no retry against a second discovery URL. The filter drawer has underlined search inputs for stores and categories, plus suggested options shoppers can select directly; product search remains on /search. Price, in-stock, and sort controls are also in the drawer, and selected filters are kept in the URL. Shoppers see a personalized horizontal shelf when recommendations are available. Sort choices are newest, oldest, price low-to-high, and price high-to-low. The old /product catalog URL redirects to /discover.

Admin and vendor analytics default to a day view using Africa/Lagos calendar boundaries. While a dashboard is open and visible, summary queries refresh every 30 seconds and detail queries every 60 seconds; browser focus also triggers a refresh. This is periodic polling backed by short server caches, not instantaneous push. **Views** count product-view events and can repeat for the same person; **unique viewers** count distinct account or anonymous visitor/session identities in the selected period, without stitching them across login or devices. View-to-cart and view-to-paid-purchase use identified account/product pairs; cart-to-purchase matches distinct cart/product/variant lines. Each uses a seven-day attribution window, and recent cohorts can mature after the selected period. Revenue is gross before refunds. See [Analytics and Measurement](../../docs/domains/analytics-and-measurement.md) for full definitions and retention limits.

**High-Performance Telemetry & Batch Window Tuning:**
Product impression events in `src/api/modules/analytics.ts` are buffered with a 5,000ms window (`IMPRESSION_BATCH_WINDOW_MS = 5000`) and a maximum threshold of 25 events. Individual impressions are deduplicated using a composite `${sessionId}:${surface}:${entityId}` key to prevent repeated requests for visible products. In addition, an active `pagehide` browser event listener ensures any remaining queued telemetry events are flushed before the user navigates away or closes the tab.

## Category browsing and portal responsiveness

Category root pages retain the horizontal text-tab layout. **Top Picks** and each direct-subcategory section use hash anchors with scroll offsets; scroll position, URL hash, selected tab, and the breadcrumb stay aligned. Product previews are capped at 12 items per direct subcategory. **View all** opens that subcategory's own listing, which uses normal page-based results of 24 products per request. Shopper-facing category tabs and previews do not show product totals.

Vendor and admin dashboards share a responsive shell: desktop uses a fixed sidebar, while smaller screens open the navigation as a dismissible modal drawer with an overlay and Escape-key support. Content areas keep min-width constraints and scale padding across breakpoints so tables and charts fit narrower screens. This shell is presentation behavior; role access remains enforced by the API.

## Authentication and API calls

The API issues short-lived access and rotating refresh cookies with HttpOnly and environment-appropriate Secure settings. The browser keeps the access token in memory for bearer requests; cookie-authenticated writes use the CSRF cookie/header pair.

**Google Identity Services (GIS) Sign-In Architecture:**
Customer and vendor flows provide official Google Identity Services sign-in:
- **Zero Hydration Mismatch:** The `<GoogleSignInButton>` component always renders the official Google 4-color SVG icon and branded container immediately on first paint, avoiding React Error #418 hydration mismatches.
- **Gesture Overlay:** An invisible GIS iframe overlay (`opacity-[0.0001]`) sits over the branded button to capture native user gestures directly, satisfying Google's FedCM and pop-up policies without blocking.
- **Docker Build-Time Inlining:** Next.js embeds `NEXT_PUBLIC_*` variables at Docker build time. The `apps/web/Dockerfile` declares `ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID` and `ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID`, and the GitHub Actions deployment workflow (`deploy.yml`) passes this build argument from repo secrets/variables.
- **Graceful Unconfigured Fallback:** If `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is missing in a local or preview environment, clicking the button displays an informative, non-blocking toast rather than crashing the application.
- **Canonical API Integration:** The web client sends the ID token to the role-scoped API endpoint; the API cryptographically validates it and issues the session. Google sign-in links existing accounts, while Google registration creates new ones. Vendor sign-in requires an active, approved account. Configure `NEXT_PUBLIC_GOOGLE_CLIENT_ID` to match API `GOOGLE_CLIENT_ID`. The server-side web application verifies access cookies using `JWT_SECRET`, which must match the API's secret.

For Google sign-in origin errors, check the OAuth **Web application** credential whose client ID is in `NEXT_PUBLIC_GOOGLE_CLIENT_ID`. Under **Authorized JavaScript origins**, add the exact origin shown by the development-only `[Google Sign-In] origin=... client_id=...` browser log. Local development on the default port needs `http://localhost` and `http://localhost:5173`; `http://127.0.0.1:5173`, a different port, and an HTTPS origin are separate origins and must be added when used. Enter origins without a path. Compare the logged client ID with the credential being edited, and confirm API `GOOGLE_CLIENT_ID` matches it. Restart the web dev server after changing the public environment variable so Next.js rebuilds the client bundle. This origin error is separate from the FedCM prompt-status warning; the sign-in component does not inspect deprecated prompt display/skip status methods.

After customer sign-in, the client can claim anonymous recent product history for recommendation continuity. This does not merge anonymous analytics identities. `/account/following` manages followed stores; followed-store news and follower counts come from separate relationship and analytics endpoints.

Use public, vendor, or admin API clients from src/api/modules based on the operation's authority. Server components should use src/api/server adapters and the configured INTERNAL_API_URL. Do not place private provider secrets in `NEXT_PUBLIC_` variables. Admin announcements are audience-specific in-app campaigns for customers or approved vendors. The admin UI supports drafts, scheduling, publishing, and archiving, with campaign status and recipient progress returned by the API. Platform settings and staff lifecycle changes are available in the admin portal and require admin authorization.

## Local development and builds

From the repository root, install with **npm ci** and create `apps/web/.env.development` from [`apps/web/.env.example`](.env.example). For the full stack, run **npm run dev:turbo**; the web dev command waits for the API health endpoint before Next.js starts. To run the apps separately, start **npm run dev:api** first, then **npm run dev:web**. The web startup check reads `INTERNAL_API_URL` or `NEXT_PUBLIC_BACKEND_URL` from the development environment and waits up to 120 seconds by default; set `WEB_API_STARTUP_TIMEOUT_MS` to change that limit. The local web app listens on port 5173. With Compose, the host port also defaults to 5173 while the container listens on 3000. The root [quickstart](../../README.md#quickstart) explains the matching API and local database setup.

- **npm run typecheck:web** runs web TypeScript checking.
- **npm run lint:web** runs web ESLint.
- **npm run build:web** creates the production build.
- **npm run --prefix apps/web test:unit** runs the web unit suite.

The production Docker image uses Next standalone output and runs as a non-root user. The app liveness endpoint is **/health**. Production/staging Compose selects apps/web/.env.production or apps/web/.env.staging based on the root APP_ENV setting.

See the [architecture diagrams](../../docs/architecture/README.md) for cross-app flows, [Codebase audit](../../docs/audits/CODEBASE_AUDIT.md) for review findings, [Performance and Capacity](../../docs/performance/README.md) for benchmark methodology/results, and [Scaling Strategy](../../docs/scaling/README.md) for future directions.
