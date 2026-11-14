import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Express } from 'express';
import { Logger } from 'nestjs-pino';
import { removeDuplicateAdminCategoryPaths } from './common/utils/swagger-paths.util';

/**
 * Enterprise OpenAPI 3.0 / Swagger Setup for NUTS Platform.
 *
 * ARCHITECTURAL & SECURITY RULES:
 * 1. Swagger UI and specifications are STRICTLY prohibited in production environments.
 *    Exposing OpenAPI contracts in production introduces reconnaissance attack surfaces,
 *    internal schema leakage, and endpoint enumeration risks.
 * 2. Swagger is strictly restricted to DEVELOPMENT and STAGING environments.
 * 3. In staging and development, Swagger provides an interactive developer portal
 *    with structured domain tag navigation, persistent authorization, latency indicators,
 *    and raw JSON / YAML exports.
 */
export function setupSwagger(
  app: INestApplication,
  config: ConfigService,
): void {
  const rawNodeEnv = (
    config.get<string>('NODE_ENV') ||
    process.env.NODE_ENV ||
    'development'
  )
    .toLowerCase()
    .trim();

  const rawAppEnv = (config.get<string>('APP_ENV') || process.env.APP_ENV || '')
    .toLowerCase()
    .trim();

  const swaggerFlag =
    config.get<string | boolean>('SWAGGER_ENABLED') ??
    process.env.SWAGGER_ENABLED;

  const isExplicitlyDisabled =
    swaggerFlag === false || swaggerFlag === 'false' || swaggerFlag === '0';

  const isExplicitStaging = rawNodeEnv === 'staging' || rawAppEnv === 'staging';
  const isProduction =
    rawAppEnv === 'production' ||
    (rawNodeEnv === 'production' && !isExplicitStaging);

  // Physical security gate: NEVER register Swagger in production under any circumstance.
  if (isProduction) {
    return;
  }

  // Allow optional explicit opt-out in staging or development
  if (isExplicitlyDisabled) {
    return;
  }

  const expressApp = app.getHttpAdapter().getInstance() as Express;

  // Enterprise API Documentation Redirects (registered ONLY when Swagger is enabled)
  expressApp.get(['/docs', '/documentation', '/api/docs.json'], (req, res) => {
    if (req.path === '/api/docs.json') {
      return res.redirect('/api/docs-json');
    }
    return res.redirect('/api/docs');
  });

  const port = config.get<number>('PORT', 3001);
  const baseUrl = config.get<string>('BASE_URL');

  const swaggerBuilder = new DocumentBuilder()
    .setTitle('NUTS Platform — Developer API Portal')
    .setDescription(
      `REST API documentation and interactive test portal for the **NUTS Multi-Vendor Marketplace Platform**.

Built as a **NestJS 11 modular monolith** with **PostgreSQL 16**, **Prisma 7**, **Redis**, and **RabbitMQ**. Feature modules use domain-oriented boundaries; selected workflows use a transactional outbox.

---

### Quick Authentication Guide
- **Web Clients:** Receive \`accessToken\` and \`refreshToken\` in \`HttpOnly\` cookies. The access token is also held in memory for Bearer requests; cookie-authenticated writes use the CSRF token.
- **Swagger / Mobile Testing:** Obtain an access token via \`POST /api/v1/auth/login\` (Customer), \`POST /api/v1/vendors/auth/login\` (Vendor), or \`POST /api/v1/admin/auth/login\` (Admin).
- Click the green **Authorize** button at the top right, paste your token in the \`Bearer <token>\` field, and click **Authorize**.

---

### Google Sign-In (Customer & Vendor)
- Customer sign-in: \`POST /api/v1/auth/google\` — Links an existing customer account by verified Google email/subject.
- Customer registration: \`POST /api/v1/auth/google/register\` — Creates a new customer account via Google Identity Services.
- Vendor sign-in: \`POST /api/v1/vendors/auth/google\` — Links an existing, active, approved vendor account.
- Vendor registration: \`POST /api/v1/vendors/auth/google/register\` — Creates a new vendor account via Google Identity Services.
- All Google routes accept a \`{ idToken: string }\` body. The API verifies the token against Google's public JWKS keys (issuer, audience, expiry, \`email_verified\`) before issuing the standard platform session.

---

### Role Access & Capability Boundaries
- **Customer (\`user\`):** Storefront catalog, cart, checkout, customer orders, wallet, and wishlist.
- **Vendor (\`vendor\`):** Merchant catalog, product variants, inventory, store orders, and vendor wallet.
- **Admin (\`admin\`):** Platform governance, merchant approvals, user management, and category taxonomy.

Successful responses use the application's JSON envelope: \`{ success, message, data, meta?, timestamp }\`. Paginated endpoints include endpoint-specific metadata. Error responses use the global exception format and appropriate HTTP status codes.`,
    )
    .setVersion('1.0.0');

  const serverUrls = new Set<string>();

  if (baseUrl) {
    swaggerBuilder.addServer(
      baseUrl,
      isExplicitStaging ? 'Active Staging Server' : 'Active Server',
    );
    serverUrls.add(baseUrl.replace(/\/$/, ''));
  }

  const renderExternalUrlEnv =
    config.get<string>('RENDER_EXTERNAL_URL') ||
    process.env.RENDER_EXTERNAL_URL;

  if (renderExternalUrlEnv) {
    const formattedRenderUrl = renderExternalUrlEnv.startsWith('http')
      ? renderExternalUrlEnv
      : `https://${renderExternalUrlEnv}`;
    if (!serverUrls.has(formattedRenderUrl.replace(/\/$/, ''))) {
      swaggerBuilder.addServer(
        formattedRenderUrl,
        'Render Staging Environment',
      );
      serverUrls.add(formattedRenderUrl.replace(/\/$/, ''));
    }
  }

  const localhostUrl = `http://localhost:${port}`;
  if (!serverUrls.has(localhostUrl)) {
    swaggerBuilder.addServer(localhostUrl, 'Local Development Server');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ENTERPRISE DOMAIN-GROUPED TAG HIERARCHY
  // ───────────────────────────────────────────────────────────────────────────
  const swaggerConfig = swaggerBuilder
    // ── 1. Storefront & Customer Operations ──
    .addTag(
      'PRODUCTS',
      'Public product catalog — browse, search, filter by category/price/stock, and fetch detail by slug',
    )
    .addTag(
      'CATEGORIES',
      'Public category tree — browse the nested category hierarchy and resolve slug paths',
    )
    .addTag(
      'CART',
      'Shopping cart management — add/update/remove items, clear cart (authenticated customer)',
    )
    .addTag(
      'ORDERS',
      'Customer order management — checkout, view orders, cancel, and update shipping details',
    )
    .addTag(
      'WISHLIST',
      'Customer wishlist — add/remove products and variants, view customer wishlist',
    )
    .addTag(
      'REVIEWS',
      'Product reviews — create verified purchase reviews, view summary by product, delete reviews',
    )
    .addTag(
      'RECOMMENDATIONS',
      'Marketplace recommendations — personalized for-you picks, daily marketplace mix, recently viewed, and store discovery',
    )
    .addTag(
      'SEARCH',
      'Global storefront search — fuzzy search, category filters, and autocomplete suggestions',
    )
    .addTag(
      'USER WALLET',
      'Customer wallet — view in-app balance, transaction ledgers, and credit history',
    )
    .addTag(
      'USERS',
      'Customer profile management — view profile, update personal information, change password, and account deletion',
    )
    .addTag(
      'SHIPPING ADDRESSES',
      'Customer address book — create, list, set default, and manage delivery addresses',
    )

    // ── 2. Merchant & Vendor Operations ──
    .addTag(
      'VENDORS - AUTH',
      'Vendor authentication — register, login, logout, refresh, OTP verification, and Google merchant sign-in',
    )
    .addTag(
      'VENDORS - ACCOUNT',
      'Vendor store profile — store settings, branding, public profile, and store deactivation',
    )
    .addTag(
      'VENDOR - PRODUCTS',
      'Vendor catalog management — create products, update details, stock adjustments, and soft deletion',
    )
    .addTag(
      'VENDOR - PRODUCT VARIANTS',
      'Vendor variant management — manage SKUs, sizes, colors, and variant stock per product',
    )
    .addTag(
      'VENDOR - ORDERS',
      'Vendor order fulfillment — view store line items, update shipment dispatch and tracking status',
    )
    .addTag(
      'VENDOR - DISCOUNT CODES',
      'Vendor promotions — create merchant discount codes, view usage, activate, and deactivate',
    )
    .addTag(
      'VENDOR - WALLET',
      'Vendor financial wallet — view available store balance, escrow payouts, and transaction history',
    )
    .addTag(
      'VENDOR - ANALYTICS',
      'Vendor store analytics — sales revenue, order volumes, top products, and conversion metrics',
    )
    .addTag(
      'VENDOR - SEARCH',
      'Vendor merchant search — scoped search across store products, orders, and promo codes',
    )
    .addTag(
      'VENDOR FOLLOWS',
      'Store followers — customer store follow management and follower metrics',
    )

    // ── 3. Platform Administration & Governance ──
    .addTag(
      'ADMIN - AUTH',
      'Admin authentication — secure staff login, administrator provisioning, and token rotation',
    )
    .addTag(
      'ADMIN - PLATFORM',
      'Platform configuration — global maintenance mode, operational toggles, and system parameters',
    )
    .addTag(
      'ADMIN - USERS',
      'Admin user governance — list, inspect, deactivate, reactivate, and manage user accounts with 2FA verification',
    )
    .addTag(
      'ADMIN - VENDORS',
      'Admin merchant governance — approve applications, verify stores, review compliance, and handle suspensions',
    )
    .addTag(
      'ADMIN - CATEGORIES',
      'Admin category taxonomy — create, update, reorder, move, archive, and manage product taxonomy',
    )
    .addTag(
      'ADMIN - PRODUCTS',
      'Admin catalog management — global product oversight, stock audits, and administrative deactivations',
    )
    .addTag(
      'ADMIN - PRODUCT VARIANTS',
      'Admin variant management — platform-wide variant inspections and adjustments',
    )
    .addTag(
      'ADMIN - ORDERS',
      'Admin order management — platform-wide order lookup, dispute overrides, and status audits',
    )
    .addTag(
      'ADMIN - DISCOUNT CODES',
      'Admin platform discounts — create marketplace-wide promotions, monitor redemptions, and deactivate codes',
    )
    .addTag(
      'ADMIN - ANALYTICS',
      'Admin platform analytics — revenue summaries, top vendors/categories, user funnels, and audit log inspection',
    )
    .addTag(
      'ADMIN - SEARCH',
      'Admin global search — cross-entity lookup across users, merchants, products, orders, and codes',
    )
    .addTag(
      'ADMIN - CACHE',
      'Admin Redis cache operations — inspect cache keys and flush shared memory stores',
    )

    // ── 4. Identity, Security & Telemetry ──
    .addTag(
      'AUTH',
      'Customer authentication — register, login, logout, refresh session, password recovery, and Google sign-in',
    )
    .addTag(
      'SECURITY',
      'Security services — CSRF token issuance, bot verification, and rate limiting controls',
    )
    .addTag(
      'ANALYTICS EVENTS',
      'Client telemetry — user behavior tracking, search query metrics, and recommendation interaction batching',
    )

    // ── 5. Platform Services & Infrastructure ──
    .addTag(
      'PAYMENTS',
      'Paystack payment processing — initialize checkout transactions, reference verification, webhooks, and refunds',
    )
    .addTag(
      'NOTIFICATIONS',
      'Notification center — authenticated in-app notification inbox, mark as read, and delete',
    )
    .addTag(
      'NOTIFICATIONS - SSE',
      'Real-time streaming — Server-Sent Events (SSE) stream for instant notification delivery',
    )
    .addTag(
      'IMAGES',
      'Asset uploads — secure, authenticated image upload service with Cloudinary CDN integration',
    )
    .addTag(
      'HEALTH',
      'Service health probes — liveness probe, database connectivity check, and Redis latency verification',
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Standard JWT Access Token. Enter your token here to test protected endpoints in Swagger UI or for external mobile clients.',
        in: 'header',
      },
      'JWT-auth',
    )
    .addCookieAuth('accessToken', {
      type: 'apiKey',
      in: 'cookie',
      name: 'accessToken',
      description:
        'HttpOnly accessToken cookie automatically dispatched on login/register for browser-based clients.',
    })
    .addCookieAuth('refreshToken', {
      type: 'apiKey',
      in: 'cookie',
      name: 'refreshToken',
      description:
        'HttpOnly refreshToken cookie automatically dispatched for session rotation.',
    })
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig, {
    deepScanRoutes: true,
  });
  removeDuplicateAdminCategoryPaths(document.paths);
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs-json',
    yamlDocumentUrl: 'api/docs-yaml',
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'none',
      filter: true,
      showRequestDuration: true,
      defaultModelsExpandDepth: 1,
      defaultModelExpandDepth: 1,
      tryItOutEnabled: true,
    },
    customSiteTitle: 'NUTS Platform — Staging & Development API Reference',
    customCss: `
      /* Global Layout & Font */
      .swagger-ui { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important; }
      .swagger-ui .topbar { display: none !important; }
      .swagger-ui .info { margin: 28px 0 36px 0 !important; max-width: 1200px !important; }
      .swagger-ui .info .title { font-weight: 800 !important; letter-spacing: -0.025em !important; font-size: 32px !important; margin-bottom: 16px !important; }
      .swagger-ui .info .description { margin-top: 20px !important; line-height: 1.8 !important; }

      /* Headings with clear breathing room */
      .swagger-ui .markdown h2, .swagger-ui .info h2 { font-size: 22px !important; font-weight: 700 !important; margin: 38px 0 16px 0 !important; padding-bottom: 8px !important; border-bottom: 2px solid #e2e8f0 !important; }
      .swagger-ui .markdown h3, .swagger-ui .info h3 { font-size: 18px !important; font-weight: 700 !important; margin: 30px 0 14px 0 !important; }
      .swagger-ui .markdown h4, .swagger-ui .info h4 { font-size: 15px !important; font-weight: 700 !important; margin: 24px 0 10px 0 !important; }

      /* Paragraphs & Text */
      .swagger-ui .markdown p, .swagger-ui .info p { font-size: 14.5px !important; line-height: 1.8 !important; margin: 0 0 16px 0 !important; }

      /* Lists & Items — Clean line-box spacing */
      .swagger-ui .markdown ul, .swagger-ui .info ul,
      .swagger-ui .markdown ol, .swagger-ui .info ol {
        margin: 10px 0 20px 0 !important;
        padding-left: 28px !important;
        list-style-position: outside !important;
        overflow: visible !important;
      }
      .swagger-ui .markdown li, .swagger-ui .info li, .swagger-ui li {
        font-size: 14px !important;
        line-height: 1.85 !important;
        margin-top: 6px !important;
        margin-bottom: 10px !important;
        padding: 0 !important;
        overflow: visible !important;
        display: list-item !important;
      }

      /* Nested Sub-lists */
      .swagger-ui .markdown li > ul, .swagger-ui .info li > ul,
      .swagger-ui .markdown li > ol, .swagger-ui .info li > ol {
        margin-top: 8px !important;
        margin-bottom: 12px !important;
        padding-left: 22px !important;
      }

      /* Inline Code Badges */
      .swagger-ui .markdown code, .swagger-ui .info code, .swagger-ui code {
        font-size: 12.5px !important;
        line-height: 1.3 !important;
        padding: 2px 6px !important;
        border-radius: 4px !important;
        display: inline-block !important;
        vertical-align: baseline !important;
        margin: 0 2px !important;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
      }
      .swagger-ui .markdown pre, .swagger-ui .info pre {
        padding: 16px 20px !important;
        border-radius: 8px !important;
        overflow-x: auto !important;
        margin: 20px 0 !important;
        line-height: 1.6 !important;
      }
      .swagger-ui .markdown pre code, .swagger-ui .info pre code {
        background: none !important;
        padding: 0 !important;
        display: block !important;
      }

      /* Tables with generous cell padding and borders */
      .swagger-ui .markdown table, .swagger-ui .info table {
        width: 100% !important;
        border-collapse: separate !important;
        border-spacing: 0 !important;
        margin: 24px 0 30px 0 !important;
        border: 1px solid #e2e8f0 !important;
        border-radius: 8px !important;
        overflow: hidden !important;
      }
      .swagger-ui .markdown th, .swagger-ui .info th {
        font-weight: 700 !important;
        font-size: 13px !important;
        text-transform: uppercase !important;
        letter-spacing: 0.05em !important;
        padding: 14px 18px !important;
        border-bottom: 1px solid #e2e8f0 !important;
        text-align: left !important;
      }
      .swagger-ui .markdown td, .swagger-ui .info td {
        padding: 14px 18px !important;
        border-bottom: 1px solid #f1f5f9 !important;
        font-size: 13.5px !important;
        vertical-align: top !important;
        line-height: 1.7 !important;
      }
      .swagger-ui .markdown tr:last-child td, .swagger-ui .info tr:last-child td { border-bottom: none !important; }

      /* Blockquotes */
      .swagger-ui .markdown blockquote, .swagger-ui .info blockquote {
        margin: 20px 0 !important;
        padding: 14px 20px !important;
        border-left: 4px solid #0284c7 !important;
        border-radius: 0 8px 8px 0 !important;
        font-size: 14px !important;
        line-height: 1.7 !important;
      }
      .swagger-ui .markdown blockquote p, .swagger-ui .info blockquote p {
        margin: 0 !important;
        line-height: 1.7 !important;
      }

      /* Horizontal Dividers */
      .swagger-ui .markdown hr, .swagger-ui .info hr { border: none !important; border-top: 1px solid #e2e8f0 !important; margin: 34px 0 !important; }

      /* Scheme Container & Authorize Button */
      .swagger-ui .scheme-container { padding: 18px 24px !important; border: 1px solid #e2e8f0 !important; border-radius: 8px !important; margin-bottom: 28px !important; box-shadow: none !important; }
      .swagger-ui .btn.authorize { font-weight: 600 !important; border-radius: 8px !important; padding: 8px 22px !important; transition: all 0.2s !important; }

      /* Endpoint Cards & Summaries */
      .swagger-ui .opblock { border-radius: 8px !important; box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.05) !important; margin: 0 0 12px 0 !important; }
      .swagger-ui .opblock .opblock-summary { padding: 12px 18px !important; }
      .swagger-ui .opblock-tag { font-size: 16px !important; font-weight: 700 !important; border-bottom: 2px solid #e2e8f0 !important; margin: 34px 0 16px 0 !important; padding-bottom: 10px !important; }
      .swagger-ui .opblock-description-wrapper p, .swagger-ui .renderedMarkdown p { font-size: 13.5px !important; line-height: 1.7 !important; margin: 6px 0 !important; }
    `,
  });

  const logger = app.get(Logger);
  logger.log(
    `Swagger documentation available at /api/docs [${rawNodeEnv}] (JSON: /api/docs-json, YAML: /api/docs-yaml)`,
  );
}
