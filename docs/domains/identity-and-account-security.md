# Identity, Accounts, and Security

> **Scope:** Customer, vendor, and admin identity flows, account lifecycle, session security, and shared access controls. The [domain index](README.md) maps this guide to its owning API modules; the [backend module map](../reference/backend-module-map.md) provides source and frontend navigation. Current behavior and proposed scale work are labeled separately.

## Domain boundary and outcomes

Customer, vendor, and admin identity flows, account lifecycle, session security, and shared access controls.

<a id="identity-and-account-security-design"></a>
## Identity, Accounts, and Security: end-to-end design

### Domain model and actors
Manages identities across Customers, Vendors, and Admins. Issues short-lived access credentials, rotating session refresh tokens, verifies emails via numeric OTPs, and enforces zero-trust role isolation.

### Problems and controls
- **Multi-Tab Session Destruction & False Token Theft:**
  - *The Failure Mode:* When a user has multiple browser tabs open and access tokens expire simultaneously, tabs may send refresh requests using the same refresh ID. If one request rotates it first, a later request with the old ID can look like token reuse.
  - *How NUTS Solves It:* The client serializes refreshes per role with an in-process promise and, where supported, the Web Locks API (`navigator.locks.request(...)`). The database conditionally rotates the refresh ID once; after commit, the resulting session is cached in Redis for 15 seconds so overlapping requests can reuse it. This is a best-effort mitigation: a request in the commit-to-cache gap or during Redis failure can still be rejected by reuse detection (see the backend timing details below).
- **Stateless Token Invalidation Delay:**
  - *The Failure Mode:* Standard stateless JWTs remain valid until their expiration timestamp even after a user changes their password, logs out, or is suspended by an administrator.
  - *How NUTS Solved It:* Access tokens carry a `tokenVersion`. Account state and that version are cached in Redis under `auth:stamp:{role}:{userId}` for **60 seconds**, with a database lookup on cache misses; password/session changes attempt to evict the cache. User refresh-session validity is also cached separately. This reduces repeated account reads, but it is not a database-free check and the cache's TTL is the fallback revocation delay if invalidation cannot reach Redis.
- **User Enumeration via Latency Timing Attacks:**
  - *The Failure Mode:* Attackers discovering registered emails by timing the difference between existing accounts (slow bcrypt compare ~80ms) and non-existent accounts (fast 404 reject ~2ms).
  - *How NUTS Solved It:* When an email does not exist, `AuthService` still runs `bcrypt.compare` against `UNKNOWN_ACCOUNT_PASSWORD_HASH`. This makes the missing-account path perform password-hash work comparable to a normal login and reduces timing differences; it does not make the full request constant-time or guarantee identical response latency.

### Current backend mechanism
- **Access Token TTL (`JWT_ACCESS_EXPIRES_IN`):** Defaults to **15 minutes**; production validation caps it at 15 minutes. The token carries identity, role, version, and session claims.
- **Refresh Token TTL (`JWT_REFRESH_EXPIRES_IN`):** Defaults to **7 days** and production validation caps it at 30 days. Refresh sessions are stored server-side with a token hash and expiry; customer sessions are device/session scoped.
- **The 15-Second Grace Window:** After a refresh rotation commits, the resulting session is cached under the previous refresh ID in Redis for **15 seconds**. A concurrent request can reuse that result only after the cache write has completed and while Redis is available. The database conditional update is the rotation compare-and-set; Redis is a short-lived replay cache, not an atomic lock. A request in the gap between the database commit and cache write (or during a Redis outage) can still be rejected by the reuse defense, so this reduces multi-tab races but does not eliminate every timing edge case.
- **Security Stamp Invalidation (`auth:stamp:{role}:{userId}`):** Cached in Redis for **60 seconds**. Account changes evict the cached stamp when Redis is available; the database is the cache-miss source of truth.
- **OTP Lifecycle (`OTP_TTL_MIN`):** Defaults to **10 minutes**. A numeric 6-digit code is stored in Redis. The resend cooldown defaults to **60 seconds** (`OTP_RESEND_COOLDOWN_SEC`), and the attempt limit defaults to **5** (`OTP_MAX_ATTEMPTS`) before invalidation; configured values can differ by environment.

### Frontend experience and flow
- **Web Locks API:** Refreshes are serialized per role across tabs on browsers that support Web Locks, with an in-process promise as the same-tab fallback. Rotated cookies are set by the server; there is no cross-tab JavaScript token memory.
- **Zustand Auth Store (`useAuthStore`):** The web client keeps the access token in memory and does not persist it in `localStorage` or `sessionStorage`. This reduces token persistence after a page closes, but active XSS can still act as the user or access in-memory state; it is not XSS immunity.
- **Public-Only Auth Layout (`PublicOnlyLayout`):** Client-side boundary that redirects already-authenticated users away from login/register screens directly to their role-specific dashboard (`/` for customer, `/vendor/dashboard` for vendor, `/admin/dashboard` for admin).

### Domain terminology
- **Refresh-token reuse detection:** The server rotates refresh IDs and detects reuse of an old ID. NUTS uses a database conditional update as the rotation authority and a short-lived Redis replay cache to help concurrent browser requests.
- **CAS (Compare-and-Swap):** An atomic database instruction updating a row only if its current version matches the expected value, preventing race conditions.
- **Timing Attack:** An attack where response time leaks data. Running bcrypt against a dummy hash for missing accounts reduces one obvious timing difference, but other request work and network variance mean this is not a constant-time endpoint.

### Failure scenarios and edge cases
- Multi-tab refresh overlap is reduced by Web Locks and a short-lived Redis replay cache where available; the database remains authoritative and a narrow cache-write race remains possible.
- Expired or manipulated OTP codes.
- Rapid successive login failures triggering exponential backoff delays.
- Account self-deactivation with a **60-day recovery grace period** (`ACCOUNT_DELETION_GRACE_DAYS`).

### Trade-offs and design considerations
- *Stateless JWTs are made statefully revocable by verifying a Redis security stamp on every request.*
- *Reduce multi-tab token reuse false positives using client-side Web Locks and a 15-second backend grace cache; the database conditional update remains the rotation authority.*
- *Use dummy password-hash work on missing-account paths to reduce account-enumeration timing signals; avoid claiming an entire network request is constant-time.*

---

## Cross-application behavior and integration contracts

### Identity and browser security

The API supports customer, vendor, and admin roles. Authentication uses short-lived access and rotating refresh tokens delivered in HttpOnly cookies; the web client also holds the access token in memory for bearer requests. Cookie-authenticated mutations use an origin check and a double-submit CSRF cookie/header pair. Server-side web session verification needs a `JWT_SECRET` matching the API's signing secret. Customer and vendor sign-in also accept Google Identity Services ID tokens at role-scoped endpoints; the API validates the token and verified email before account lookup/linking. Vendor sessions still require an active, approved vendor. `GOOGLE_CLIENT_ID` should be configured on the API and matched by the public web client ID.

Refresh rotation is guarded by a conditional database update, so only one request can rotate a given refresh ID. After that transaction commits, Redis caches the new session under the previous ID for 15 seconds to help overlapping browser requests reuse the rotation result. This cache is written after the database change and is not a lock: a stale-token request in the commit-to-cache gap, or while Redis is unavailable, can still reach the reuse-revocation path. Client-side Web Locks reduce browser-side overlap where supported but do not replace the database check.

After customer sign-in, the web client can call `POST /api/v1/recommendations/recently-viewed/claim` to associate anonymous recent browsing with that account for recommendation continuity. This operation does not merge historical anonymous `ProductView` identities into account analytics. Vendor follow/unfollow writes the follow relationship, recommendation event, and outbox event in one transaction. Current follower totals query active relationships; period growth uses retained follow/unfollow events.

The admin portal exposes platform config/maintenance controls, staff status and audit-log management, and customer/vendor announcement campaigns. Announcement delivery is keyset-paginated in batches of 200, with per-recipient dedupe keys, a `PUBLISHING` state and 15-minute processing lease. A one-minute scheduler starts due campaigns and recovers stale claims. The lifecycle distinguishes draft, scheduled, publishing, published, failed, and archived states; audience-specific in-app links are validated before delivery.

The vendor and admin portal shells share a responsive layout: desktop navigation is a fixed sidebar, while narrow layouts use an overlay-backed modal drawer that closes on Escape or navigation. This changes presentation only; authorization remains in API role guards.

The security boundary also includes role guards, DTO validation, response serialization, rate limits, security headers/CSP, and provider-specific webhook verification. Paystack webhooks use HMAC verification over the raw request body. Do not trust forwarded client IP headers unless the reverse proxy chain is configured as trusted. Redis-backed throttling switches to a bounded per-process counter during an outage, and account-lock reads fail closed; the audit documents the multi-replica limit of that emergency fallback.

- Google sign-in is available for customer and vendor accounts through Google Identity Services ID tokens. Sign-in verifies and links an existing same-role account by verified email or Google subject, and rejects identities without an account. Separate Google signup routes handle account creation. Vendor sessions still require an active, approved vendor. The browser client ID and API `GOOGLE_CLIENT_ID` must refer to the same Google OAuth client.

### Current session and CSRF behavior

Browser authentication uses short-lived access and rotating refresh cookies with CSRF protection on cookie-authenticated writes. The web client also keeps an access token in memory for bearer requests. The web server needs the API's matching JWT verification secret for server-side session checks. Google sign-in uses verified ID tokens; it does not replace the role-specific session and approval checks.

### Portal role boundary

A valid token for a `vendor` or `admin` receives an immediate `403 Forbidden` on customer shopping endpoints (`/cart`, `/checkout`, `/orders/my-orders`). Role capabilities are strictly verified on both the backend guards and database queries.

## Implementation details by capability

The sections below describe each capability’s problem, current API mechanism, failure cases, and trade-offs. The [backend module map](../reference/backend-module-map.md) provides folder and source navigation.

### Identity and session lifecycle

Customers, vendors, and admins need role-specific registration and authentication while sessions remain revocable and browser requests remain protected.

#### Current backend mechanism

Nest controllers and services implement role-specific login flows, OTP, Google ID-token verification, access/refresh cookies, refresh-session persistence, and session revocation. The browser also uses an in-memory access token for bearer requests.

#### Failure scenarios and trade-offs

Vendor sessions require active approval; cookie-authenticated writes require CSRF protection; server-rendered session checks need the API's matching JWT secret. Refresh-token concurrency and Redis-outage behavior are documented as a security trade-off in the audit and should remain covered by targeted tests.

### Customer account lifecycle

Customers need self-service profile/account operations while admin moderation remains privileged and auditable.

#### Current backend mechanism

User controllers separate self-service actions from administrator operations; account/auth state interacts with sessions, orders, referrals, and recommendations.

#### Failure scenarios and trade-offs

Deactivation/deletion affects order, payment, audit, and recommendation records differently. A written retention, anonymization, export, and backup-erasure policy is still needed before claiming complete account erasure.

### Shared security controls

Authentication alone does not prevent cross-role access, account abuse, CSRF, unsafe proxy trust, or sensitive audit gaps.

#### Current backend mechanism

Shared guards, account-lock and token services, CSRF/origin middleware, rate limiting, and audit utilities apply across controllers. See [Domain 1](identity-and-account-security.md#identity-and-account-security-design) and [Field Manual: Application Security](../engineering/field-manual/05-application-security.md).

#### Failure scenarios and trade-offs

Redis-backed throttling falls back to volatile per-process counters during outages, so cross-replica limits weaken. Trusted forwarded headers must match the actual proxy chain. Alert on fallback and keep privacy-sensitive data out of logs.

## Scaling and traffic direction

The [Scaling Strategy](../scaling/README.md#identity-and-security-traffic) contains the staged concurrency, traffic, and growth recommendations for this domain. Scale identity and security traffic through shared rate limits, safe session concurrency, and explicit Redis-outage behavior.
