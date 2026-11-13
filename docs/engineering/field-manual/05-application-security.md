# Part V: Application Security & Cyber Defense Shield

47. **Broken Object Level Authorization (BOLA / IDOR):**
    - **Concept & Foundation:** Insecure Direct Object References (IDOR/BOLA) occur when an API endpoint uses user-supplied IDs to retrieve database objects without verifying that the authenticated user owns that specific resource (e.g. User A accessing `GET /api/v1/orders/1234` belonging to User B).
    - **NUTS Production Implementation:**
      - NUTS enforces strict **Multi-Tenant Query Scoping** across all services:
        - Customer order queries: `prisma.orders.findFirst({ where: { id: orderId, userId: currentUser.id } })`.
        - Vendor product updates: `prisma.products.updateMany({ where: { id: productId, vendorId: currentVendor.id }, data: ... })`.
      - If an ID exists but belongs to another entity, the query returns `null`, prompting a standard `404 Not Found` rather than leaking resource existence.
    - **Architecture & Interview Takeaway:** *Never rely purely on resource IDs passed in request parameters. Always scope database queries with the authenticated user ID extracted from verified session claims.*

48. **Cross-Site Scripting (XSS) & Content Security Policy (CSP):**
    - **Concept & Foundation:** XSS allows attackers to inject malicious scripts into trusted web pages, stealing cookies, session tokens, or altering DOM contents.
    - **NUTS Production Implementation:**
      - The web client keeps the access token in memory and does not use browser persistent storage for it. The API also sets HttpOnly access and refresh cookies for browser/server-rendered requests; JavaScript cannot read those cookie values directly.
      - **Dynamic CSP Noncing:** Next.js edge middleware generates a unique cryptographic nonce per request using Web Crypto (`crypto.randomUUID()`), applied to inline scripts and style headers (`script-src 'self' 'nonce-...'`).
    - **Architecture & Interview Takeaway:** *HttpOnly cookies block direct JavaScript reads of cookie values, but an XSS payload can still issue authenticated actions. A carefully configured CSP reduces script-injection risk; neither control replaces output encoding and safe DOM handling.*

49. **Server-Side Request Forgery (SSRF) & Whitelist Egress Defense:**
    - **Concept & Foundation:** SSRF occurs when an attacker tricks the server into making HTTP requests to arbitrary URLs, potentially accessing internal cloud metadata endpoints (`http://169.254.169.254`), internal databases, or local intranet services.
    - **NUTS Production Implementation:**
      - Media uploads and remote image transformations validate target URLs against strict whitelists:
        - Protocols are restricted to `https:`.
        - Hostnames must match verified CDN endpoints (`res.cloudinary.com`).
        - Private IP ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.1`) are strictly rejected before outbound HTTP requests are dispatched.
    - **Architecture & Interview Takeaway:** *Never execute outbound HTTP requests to user-supplied URLs without verifying protocol schemes, validating domain whitelists, and resolving DNS to block private loopback and link-local IP addresses.*

50. **Replay Attacks & Cryptographic Signatures (HMAC-SHA512):**
    - **Concept & Foundation:** A replay attack occurs when an attacker intercepts a valid network transmission and re-transmits it to execute the action again (e.g. re-sending a payment confirmation webhook to receive duplicate credits).
    - **NUTS Production Implementation:**
      - Paystack payment webhooks require raw payload verification against an `x-paystack-signature` header:
        ```typescript
        const hash = crypto
          .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
          .update(rawBodyBuffer)
          .digest('hex');
        if (hash !== signature) throw new UnauthorizedException('Invalid signature');
        ```
      - Webhook events are processed idempotently based on event timestamps and unique transaction references. Duplicate webhook payloads are rejected.
    - **Architecture & Interview Takeaway:** *Always verify webhook signatures using raw, unparsed request body buffers. Parsing JSON before signature calculation can alter whitespace or key ordering, breaking cryptographic hashes.*

51. **Prototype Pollution & DTO Object Sanitization:**
    - **Concept & Foundation:** JavaScript objects inherit properties from `Object.prototype`. Prototype pollution occurs when unsanitized user inputs inject properties into `__proto__`, altering application behavior globally and leading to Denial of Service or Remote Code Execution.
    - **NUTS Production Implementation:**
      - Inbound JSON payloads are processed through NestJS `ValidationPipe` with `class-transformer`.
      - Payloads are instantiated into strictly typed class instances, automatically stripping `__proto__` and constructor properties before reaching application controllers.
    - **Architecture & Interview Takeaway:** *Enforce strict input serialization and whitelisting at the HTTP boundary. Never pass unvalidated raw JSON objects directly into deep object merge functions.*

---
