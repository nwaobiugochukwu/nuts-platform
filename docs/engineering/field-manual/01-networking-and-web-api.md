# Part I: Networking, Protocols & Web API Architecture

1. **HTTP Methods & Semantic Verbs:**
   - **Concept & Foundation:** HTTP methods have safety and idempotency semantics. `GET` and `HEAD` are safe and idempotent; `PUT` and `DELETE` are defined as idempotent. `POST` is generally non-idempotent unless the application adds an idempotency contract. `PATCH` can be idempotent or non-idempotent depending on the patch operation.
   - **NUTS Production Implementation:** Representative contracts include `PATCH /api/v1/cart/items/:id` for a cart-line update, `POST /api/v1/orders/checkout` for order creation and stock reservation, `DELETE /api/v1/cart` to clear the active cart, and `GET /api/v1/products` for a read-only catalog query. Actual cache headers are endpoint and deployment specific.
   - **Architecture & Interview Takeaway:** *Never use `POST` for safe reads or `GET` for state mutations. Use `PUT` when the client provides the full replacement entity; use `PATCH` when sending partial delta mutations to conserve bandwidth and prevent clobbering concurrent field updates.*

2. **HTTP Status Codes & Semantic Error Mapping:**
   - **Concept & Foundation:** Standard 3-digit status codes communicate the exact outcome of a request across 5 classes: 2xx (Success), 3xx (Redirection), 4xx (Client Errors), and 5xx (Server/Upstream Errors). Precise status codes allow clients, proxies, and monitoring agents to make automated retry, alerting, and error-handling decisions.
   - **NUTS Production Implementation:** NUTS uses semantic codes with high precision:
     - `200 OK`: Standard read / synchronous mutation success.
     - `201 Created`: Used by resource-creation operations; check the individual route contract for response headers and response body.
     - `400 Bad Request`: Validation failure on malformed DTO payloads.
     - `401 Unauthorized`: Missing, expired, or cryptographically invalid access token.
     - `403 Forbidden`: Authenticated identity lacks permission (e.g. Vendors attempting Customer shopping routes).
     - `404 Not Found`: Resource does not exist or user does not own it (scoping defense).
     - `409 Conflict`: Business invariant violation, specifically `INSUFFICIENT_STOCK` during checkout or duplicate unique fields.
     - `422 Unprocessable Entity`: Available for semantic validation where a route uses it; many current business-rule failures use `400` or `409`, so consult Swagger for the endpoint.
     - `429 Too Many Requests`: Returned when a configured throttle limit is exceeded.
     - `503 Service Unavailable`: The readiness endpoint reports database and Redis checks; RabbitMQ health is monitored separately by broker/outbox diagnostics.
   - **Architecture & Interview Takeaway:** *A production API must never return `200 OK` with an `{ error: true }` body. This breaks HTTP caching, monitoring alerts, and circuit breakers. Return accurate 4xx/5xx codes to trigger automated resilience behaviors.*

3. **HTTP Headers & Content Negotiation:**
   - **Concept & Foundation:** Headers are protocol-level metadata key-value pairs governing caching (`Cache-Control`, `ETag`), security (`Content-Security-Policy`), negotiation (`Accept`, `Content-Type`), authorization (`Authorization`), and tracing (`X-Request-Id`). Content negotiation allows a client to declare acceptable representation formats (`Accept: application/json`).
   - **NUTS Production Implementation:**
     - `Authorization: Bearer <token>`: Transmits short-lived access JWTs on Axios requests.
     - `x-csrf-token`: Header holding the double-submit token compared in constant time against the browser-readable `csrf_token` cookie on cookie-authenticated state changes.
     - `x-paystack-signature`: Webhook header holding the HMAC-SHA512 signature computed over the raw payload buffer.
     - `Content-Type: text/event-stream`: Declares long-lived Server-Sent Event channels.
   - **Architecture & Interview Takeaway:** *Headers provide out-of-band operational context without polluting entity payloads. Never pass authorization tokens or cryptographic signatures inside JSON request bodies.*

4. **Cookies vs. Sessions vs. Tokens:**
   - **Concept & Foundation:**
     - *Cookies:* Browser-managed key-value storage automatically transmitted in the `Cookie` header on every HTTP request to matching domains.
     - *Sessions:* Server-managed state stored in a fast datastore (e.g. Redis), referenced by a random Session ID cookie.
     - *Tokens (JWT):* Self-contained, stateless, cryptographically signed JSON documents encoding claims (`sub`, `roles`, `exp`).
   - **NUTS Production Implementation:** NUTS uses a hybrid **Defense-in-Depth Session/Token Architecture**:
      - The **Access Token** defaults to a 15-minute signed JWT, held in client memory and sent via `Authorization: Bearer` for bearer requests. It is also issued as an HttpOnly cookie for server-rendered requests. Production configuration caps access-token lifetime at 15 minutes.
      - The **Refresh Token** defaults to a 7-day signed JWT with a 256-bit random rotation ID. Its HttpOnly cookie uses `Path=/`; `Secure` and `SameSite` follow environment/configuration (production and staging default to Secure and `SameSite=None`). Production permits a configured refresh lifetime up to 30 days.
     - Customer refresh-session records and token hashes are stored in PostgreSQL, with Redis used for session/stamp caching and a 15-second concurrent-refresh grace window. Logout and account changes revoke sessions; cache invalidation is attempted, with the 60-second stamp TTL as the fallback if Redis invalidation is unavailable.
    - **Architecture & Interview Takeaway:** *Avoid persistent browser storage for bearer tokens, but do not treat in-memory storage as protection from active XSS. HttpOnly cookies prevent JavaScript from reading cookie values; they do not prevent injected scripts from issuing authenticated actions. Cookie-authenticated mutations also need CSRF protection, and server-side session checks provide revocation control.*

5. **Authentication vs. Authorization & Zero-Trust Governance:**
   - **Concept & Foundation:**
     - *Authentication (AuthN):* Verifying *who* you are (identity verification via passwords, OTPs, biometric signatures).
     - *Authorization (AuthZ):* Verifying *what* you are allowed to do (permissions, role-based access control [RBAC], attribute-based access control [ABAC]).
   - **NUTS Production Implementation:**
     - **AuthN:** Multi-step registration, bcrypt password hashing with dummy-hash work on missing-account logins to reduce timing differences, and Redis-backed 6-digit OTP verification.
     - **AuthZ:** Zero-Trust capability isolation using NestJS `@Roles('USER' | 'VENDOR' | 'ADMIN')` decorators, `RolesGuard`, and database tenant scoping (`where: { userId }`). A vendor attempting to call customer checkout receives `403 Forbidden` at the guard layer before any database query executes.
   - **Architecture & Interview Takeaway:** *Authentication establishes identity; Authorization enforces boundaries. Always enforce authorization at both the API gateway/guard layer and the database query layer (tenant isolation).*

6. **Request & Response Lifecycle in NestJS:**
   - **Concept & Foundation:** The sequence of processing phases an HTTP request traverses: Middleware $\rightarrow$ Guards $\rightarrow$ Interceptors (pre) $\rightarrow$ Pipes $\rightarrow$ Controller Handler $\rightarrow$ Service Layer $\rightarrow$ Interceptors (post) $\rightarrow$ Exception Filters.
   - **NUTS Production Implementation:**
     1. Express JSON parsing retains the unmodified request bytes for Paystack HMAC verification.
     2. `CsrfProtectionMiddleware`: Validates `x-csrf-token` against cookie.
     3. `JwtAuthGuard`: Resolves Bearer header or cookie into `req.user`.
     4. `RolesGuard`: Verifies role metadata.
     5. Request logging/instrumentation records request context and duration.
     6. `ValidationPipe`: Validates and transforms payload into typed DTO.
     7. `Controller & Service`: Executes business logic and database transaction.
     8. `ResponseInterceptor`: Wraps successful responses in the shared API envelope.
     9. `GlobalExceptionFilter`: Maps known exceptions and Prisma errors into the API's JSON error envelope. The envelope is project-specific, not an RFC 7807 Problem Details document.
   - **Architecture & Interview Takeaway:** *Strict separation of concerns across lifecycle hooks prevents code pollution. Security lives in Middlewares and Guards; transformation lives in Pipes and Interceptors; failure translation lives in Exception Filters.*

7. **Content Types & Serialization:**
   - **Concept & Foundation:** MIME types declare payload serialization format via `Content-Type` headers (`application/json`, `multipart/form-data`, `text/event-stream`, `application/x-www-form-urlencoded`).
   - **NUTS Production Implementation:**
     - `application/json`: Standard REST endpoint communication format.
     - `multipart/form-data`: Multer buffers image uploads in process memory, validates format/signature and enforces a 5 MB per-image limit, then passes the buffer to Cloudinary. Direct-to-Cloudinary signed uploads are a future option if upload volume makes API memory pressure material.
     - `text/event-stream`: Long-lived unbuffered streaming for Server-Sent Events.
   - **Architecture & Interview Takeaway:** *Memory-buffered uploads are simple at bounded file sizes, but their memory cost scales with concurrent uploads. For larger files or higher concurrency, move the browser-to-storage data path to signed direct uploads and keep the API responsible for authorization and metadata.*

8. **CORS (Cross-Origin Resource Sharing) & Origin Sandboxing:**
   - **Concept & Foundation:** A browser security standard preventing scripts on `origin-a.com` from making requests to `origin-b.com` and reading responses unless `origin-b.com` explicitly issues `Access-Control-Allow-Origin` headers. Preflight `OPTIONS` requests verify permissions before mutating requests execute.
   - **NUTS Production Implementation:** NestJS CORS uses an exact-origin allowlist from `ALLOWED_ORIGINS` with credentials enabled. Production configuration validation requires exact HTTPS origins and rejects localhost/path entries; requests with no Origin (such as server-to-server calls) are allowed by the CORS callback.
   - **Architecture & Interview Takeaway:** *Setting `Access-Control-Allow-Origin: *` while enabling `Access-Control-Allow-Credentials: true` is rejected by modern browsers. Always whitelist explicit origins and ensure reverse proxies pass origin headers accurately.*

9. **CSRF (Cross-Site Request Forgery) & Double-Submit Protection:**
   - **Concept & Foundation:** CSRF attacks exploit ambient browser credential transmission (cookies sent automatically with cross-site requests). A malicious site tricks an authenticated user's browser into executing unwanted state changes on the target application.
   - **NUTS Production Implementation:**
     - NUTS uses a **signed-origin check plus a double-submit CSRF cookie/header pair** for cookie-authenticated state changes:
       1. The server generates a 32-byte random token and sets it in the browser-readable `csrf_token` cookie; it also returns the token in the `x-csrf-token` response header.
       2. The web client echoes the token in the `x-csrf-token` request header.
       3. The API validates the request origin and compares the cookie/header tokens with `crypto.timingSafeEqual`. Bearer-authenticated writes do not depend on ambient cookies.
     - Third-party webhooks bypass browser CSRF checks and use provider signature verification; Paystack uses HMAC-SHA512 over the raw request body.
   - **Architecture & Interview Takeaway:** *Modern `SameSite=Lax` cookies provide baseline defense against standard cross-site POSTs, but defense-in-depth requires explicit CSRF noncing or custom authorization headers for all state-mutating requests.*

10. **HTTPS, TLS/SSL & Origin Encryption:**
    - **Concept & Foundation:** TLS (Transport Layer Security) encrypts communication between client and server, preventing eavesdropping, tampering, and Man-in-the-Middle (MITM) packet sniffing. It combines asymmetric cryptography (RSA/ECC for key exchange) with high-speed symmetric encryption (AES-256-GCM) for data transfer.
    - **NUTS Production Implementation:** The repository's Nginx deployment template terminates TLS and redirects HTTP to HTTPS. Other hosting environments must provide their own TLS termination and trusted proxy configuration. Cookie `Secure` behavior is controlled by `AUTH_COOKIE_SECURE` and environment-aware defaults; local development can use HTTP.
    - **Architecture & Interview Takeaway:** *Never run production applications over unencrypted HTTP. Enforce HTTP Strict Transport Security (HSTS) and ensure all authentication cookies have the `Secure` attribute to eliminate plaintext credential transmission.*

11. **HTTP/1.1 vs. HTTP/2 vs. HTTP/3:**
    - **Concept & Foundation:**
      - *HTTP/1.1:* Text-based protocol suffering from Head-of-Line (HOL) blocking at the application layer (only 1 request per TCP socket at a time, prompting browsers to open 6 parallel TCP connections).
      - *HTTP/2:* Binary protocol with single-TCP multiplexing (multiple bidirectional streams interleaved over one connection) and HPACK header compression.
      - *HTTP/3:* Runs over QUIC (UDP), eliminating transport-layer HOL blocking caused by TCP packet loss.
    - **NUTS Production Implementation:** The repository's Nginx TLS template enables HTTP/2. Other edge providers may also support it, depending on deployment configuration; HTTP/2 behavior is not guaranteed by the application process itself.
    - **Architecture & Interview Takeaway:** *HTTP/2 multiplexing makes persistent Server-Sent Events (SSE) practical alongside normal API traffic without exhausting the browser's 6-connection per-origin limit.*

12. **Keep-Alive, TCP Handshakes & Connection Reuse:**
    - **Concept & Foundation:** Establishing a TCP connection requires a 3-way handshake (`SYN`, `SYN-ACK`, `ACK`), plus additional round-trips for TLS negotiation. Reusing existing TCP connections via `Connection: keep-alive` eliminates this latency on subsequent requests.
    - **NUTS Production Implementation:**
      - The Next.js upstream fetcher (`server-fetcher.ts`) uses an `http.Agent` with keep-alive and a bounded request timeout so server-side calls can reuse upstream connections.
      - The API PostgreSQL adapter enables TCP keepalive; `DB_KEEPALIVE_MS` is not a current application setting. Pool size and idle/acquisition timeouts are configurable per process.
    - **Architecture & Interview Takeaway:** *Connection reuse avoids repeated handshakes, but the latency effect depends on request mix, network distance, TLS configuration, and pool behavior; measure it rather than promising a fixed P99 improvement.*

13. **Payload Compression (Gzip / Brotli) & Streaming Disablement:**
    - **Concept & Foundation:** HTTP compression algorithms (Brotli `br`, Gzip `gzip`) can reduce text response size, with actual savings depending on content. Some proxy or compression configurations buffer chunks and increase latency for streaming responses, so streaming paths need explicit configuration.
    - **NUTS Production Implementation:** The repository's Nginx config enables Gzip, and the API uses Express compression above its threshold. Compression is explicitly skipped for SSE in the API; the Nginx SSE location disables proxy buffering and the response uses `no-transform` cache control.
    - **Architecture & Interview Takeaway:** *Compression and streaming can coexist when the stack supports it, but proxy buffering and compression settings must be checked for each streaming route.*

14. **Real-Time Streaming & Server-Sent Events (SSE):**
    - **Concept & Foundation:** SSE is a unidirectional streaming protocol over standard HTTP where the server pushes UTF-8 formatted text events (`text/event-stream`) to the client without the overhead, handshake complexity, or binary framing of WebSockets.
    - **NUTS Production Implementation:**
      - Controller endpoint `/api/v1/notifications/sse/stream` uses NestJS `@Sse()` and returns an RxJS `Observable<MessageEvent>`.
      - When domain events occur (e.g. order placed, payment confirmed), Redis Pub/Sub broadcasts the event to all API cluster nodes.
      - Active SSE streams push the event to connected user clients.
      - A heartbeat is emitted every 15 seconds. The web client consumes the stream with `fetch`, performs jittered reconnects, and requests replay with `Last-Event-ID`; it does not rely on native `EventSource` reconnection.
      - This SSE channel carries notifications. Analytics dashboards use periodic HTTP polling rather than this stream.
    - **Architecture & Interview Takeaway:** *SSE fits unidirectional notification delivery when reconnect and replay behavior are designed explicitly. Network, proxy, and hosting behavior still need validation in the deployed environment.*

15. **Idempotency & Idempotent API Design:**
    - **Concept & Foundation:** An idempotent operation can be applied multiple times without changing the result beyond the initial application. In distributed networks, clients often retry requests upon network timeouts; without idempotency, retried payments or checkouts cause double-charges or duplicate orders.
    - **NUTS Production Implementation:**
      - Payment webhooks use the unique provider transaction reference as a stable idempotency key; the reference itself is not a cryptographic digest.
      - `PaymentsService` checks payment/order state and applies the successful transition transactionally. A repeated paid webhook does not repeat vendor credits or notification publication.
      - Order checkout verifies candidate cart item state to ensure re-submissions do not double-decrement inventory.
    - **Architecture & Interview Takeaway:** *Network calls will fail and clients will retry. Design all financial mutations, inventory operations, and webhook handlers to be strictly idempotent using unique deduplication keys.*

16. **API Versioning Strategies:**
    - **Concept & Foundation:** As business requirements evolve, APIs must change without breaking existing mobile apps, external integrations, or legacy web clients. Strategies include: URI Path (`/v1`), Request Header (`Accept-Version: v1`), or Query Parameter (`?v=1`).
    - **NUTS Production Implementation:** The current API uses the global `/api/v1` prefix. Swagger and web API clients follow that prefix. A future breaking `/api/v2` rollout would require an explicit compatibility and migration plan; parallel version support is not implemented by the prefix alone.
    - **Architecture & Interview Takeaway:** *URI path versioning provides the highest visibility in access logs, reverse proxy routing rules, and browser debugging tools compared to header-based versioning.*

17. **Pagination, Filtering, Sorting & Search Query Contracts:**
    - **Concept & Foundation:** Unbounded database queries (`SELECT * FROM products`) exhaust server RAM and crash production databases under scale. Standard query contracts enforce controlled pagination (Offset/Limit or Cursor-based), safe column filtering, and whitelisted sorting.
    - **NUTS Production Implementation:**
      - Shared page-based DTOs provide bounded page/limit values, but endpoints may use their own page-size defaults or cursor pagination; follow the route's Swagger schema.
      - Page-based services commonly calculate `skip: (page - 1) * limit`; query/count consistency and sort choices are endpoint-specific.
      - Sort inputs are validated or normalized by each route; raw user-supplied sort expressions must never reach SQL.
    - **Architecture & Interview Takeaway:** *Never allow unlimited query limits. Always enforce maximum page sizes and validate sort fields against an explicit whitelist of indexed database columns.*

18. **Rate Limiting, Fixed Windows & Throttling Algorithms:**
    - **Concept & Foundation:** Protects APIs against brute-force attacks, credential stuffing, scraping, and Denial of Service (DoS). Algorithms include: Fixed Window, Token Bucket, Leaky Bucket, and Sliding Window Counter.
    - **NUTS Production Implementation:**
      - NUTS uses a Redis-backed atomic **fixed-window counter** for `@nestjs/throttler`; if Redis is unavailable, a bounded per-process fallback is used, so outage limits are no longer shared across replicas.
        - Global default: 100 requests per 60-second window.
        - Strict auth endpoints: 5 requests per 60-second window.
        - Refresh endpoints: 10 requests per 60-second window.
        - Password-reset endpoints: 5 requests per hour.
      - Throttled requests return `429 Too Many Requests`; use the route response contract rather than assuming a `Retry-After` header.
    - **Architecture & Interview Takeaway:** *Fixed-window counters are simple and atomic but allow boundary bursts. Choose a token bucket or sliding-window algorithm if measured traffic needs smoother limits; retain an explicit degraded-mode policy when shared Redis state is unavailable.*

19. **API Contracts, DTO Validation & Schema Whitelisting:**
    - **Concept & Foundation:** An API contract defines the exact structure, types, and constraints of incoming and outgoing data. Runtime validation ensures malformed or malicious payloads are rejected before reaching business logic.
    - **NUTS Production Implementation:**
      - NestJS `ValidationPipe` configured with:
        - `whitelist: true`: Strips undeclared properties from incoming request bodies.
        - `forbidNonWhitelisted: true`: Immediately rejects payloads containing unknown attributes with `400 Bad Request`.
        - `transform: true`: Automatically coerces primitives and instantiates typed DTO classes.
    - **Architecture & Interview Takeaway:** *Whitelisting protects systems against Mass Assignment vulnerabilities where attackers attempt to inject fields like `{ "role": "ADMIN", "isApproved": true }` into standard user profile updates.*

20. **Standardized Error Handling, Problem Details & Exception Translation:**
    - **Concept & Foundation:** Uniform error formatting allows client applications to parse errors consistently and display meaningful user messages. RFC 7807 defines one standard Problem Details format for HTTP APIs.
    - **NUTS Production Implementation:**
      - `GlobalExceptionFilter` intercepts all thrown exceptions.
      - Internal Prisma database errors are intercepted and translated:
        - `P2002` (Unique constraint violation) $\rightarrow$ `409 Conflict` with the conflicting field name.
        - `P2025` (Record not found) $\rightarrow$ `404 Not Found`.
      - Responses use the NUTS project-specific error envelope (not the RFC 7807 `application/problem+json` format):
        ```json
        {
          "success": false,
          "statusCode": 409,
          "timestamp": "2026-10-25T21:00:00.000Z",
          "path": "/api/v1/vendors/register",
          "error": "Conflict",
          "message": "A store with this name already exists"
        }
        ```
    - **Architecture & Interview Takeaway:** *Never leak raw database stack traces or SQL syntax errors to clients. Exception translation sanitizes internal infrastructure details while providing actionable client errors.*

21. **Synchronous vs. Asynchronous Communication:**
    - **Concept & Foundation:**
      - *Synchronous (Blocking):* Client waits for server to complete all work before receiving an HTTP response (tight coupling, high latency, cascade failure risk).
      - *Asynchronous (Non-Blocking):* Server accepts the request, persists an event or queues a job, and returns an immediate response (`202 Accepted` or `201 Created`), while background workers complete the processing.
    - **NUTS Production Implementation:**
      - **Synchronous:** Cart validation, payment charge verification, and order row locking (must be consistent before returning to user).
      - **Asynchronous:** Brevo transactional email, notification and vendor events through RabbitMQ/outbox, buffered product-view analytics, and SSE fanout to connected notification clients.
    - **Architecture & Interview Takeaway:** *Keep the HTTP request-response cycle as fast as possible. Any work that can tolerate eventual consistency (emails, analytics, push notifications) must be offloaded to asynchronous background queues.*

22. **REST Route Canonization & Anti-Drift Architecture:**
    - **Concept & Foundation:** Allowing controllers to bind multiple path aliases (`@Controller(['account', 'users'])`, `@Post(['otp/request', 'register/otp'])`) creates API drift, duplicates OpenAPI documentation, causes cache fragmentation across CDNs/proxies, and creates ambiguity in client SDK generation.
    - **NUTS Production Implementation:**
      - Replaced all multi-route controller arrays with single canonical REST endpoints:
        - `/auth/otp/request`, `/auth/otp/verify`, `/auth/forgot-password/otp/request`, `/auth/reset-password`
        - `/account`, `/account/otp/request`, `/account/wallet`, `/account/wallet/transactions`
        - `/admin/categories`, `/admin/users/request-otp`, `/admin/users/:id/suspend`, `/admin/users/:id/unsuspend`
        - `/vendors/auth`, `/vendors/analytics`, `/vendors/wallet`, `/vendors/discounts`, `/vendors/orders`, `/vendors/products`, `/vendors/products/variants`
        - `/payments`, `/payments/callback`, `/payments/webhook`, `/payments/initialize`, `/payments/order/:orderId`
        - `/notifications/mark-all-read`, `/notifications/clear-all`, `/notifications/preferences`, `/notifications/push`, `/notifications/sse/stream`
      - Aligned frontend API service modules (`auth.ts`, `payment.ts`, `user.ts`, `notifications.ts`) to communicate strictly through these unified contracts.
    - **Architecture & Interview Takeaway:** *One resource, one canonical URI. Deprecate and remove redundant route aliases to keep API surfaces clean, observable, and cache-friendly.*

---
