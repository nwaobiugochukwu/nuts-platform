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
 *    with collapsed tag navigation, persistent authorization, latency indicators,
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

  // Only an explicit staging environment may opt out of the production gate.
  // Hostname/service-name heuristics can be misleading and must never expose
  // the API contract on a production deployment.
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
    .setTitle('NUTS Platform â€” Developer API Portal')
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

The API is a **modular monolith** with domain-oriented NestJS modules. Controllers validate HTTP input, application services coordinate use cases, and shared infrastructure owns persistence, caching, messaging, and external providers. Some workflows use a transactional outbox; the platform does not implement system-wide CQRS or event sourcing.

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

  const swaggerConfig = swaggerBuilder
    .addTag(
      'ADMIN - ANALYTICS',
      'Admin analytics â€” summary, revenue, top products/vendors/categories, funnel, activity audit',
    )
    .addTag(
      'ADMIN - AUTH',
      'Admin authentication â€” login, logout, token refresh, administrator provisioning',
    )
    .addTag(
      'ADMIN - CACHE',
      'Admin-only cache operations â€” inspect and flush shared Redis cache data',
    )
    .addTag(
      'ADMIN - CATEGORY',
      'Admin category management â€” create, update, activate/deactivate, delete',
    )
    .addTag(
      'ADMIN - VENDORS',
      'Admin vendor management â€” list, approve, verify, suspend, delete',
    )
    .addTag(
      'ADMIN - DISCOUNT CODES',
      'Admin discount code management â€” create platform-wide codes, list, deactivate, delete',
    )
    .addTag(
      'ADMIN - ORDERS',
      'Admin order management â€” list/filter all orders, update any order status',
    )
    .addTag(
      'ADMIN - PRODUCT VARIANTS',
      'Admin variant management â€” CRUD, stock, activate/deactivate for any variant',
    )
    .addTag(
      'ADMIN - PRODUCTS',
      'Admin product management â€” CRUD, stock, activate/deactivate for any product',
    )
    .addTag(
      'ADMIN - SEARCH',
      'Admin global search â€” search users, vendors, products, orders, and discount codes',
    )
    .addTag(
      'ADMIN - USERS',
      'Admin user management â€” list, view, deactivate/reactivate, delete users',
    )
    .addTag(
      'AUTH',
      'Customer authentication â€” register, login, logout, refresh, password reset, Google sign-in & registration',
    )
    .addTag(
      'CART',
      'Shopping cart management â€” add/update/remove items, clear cart (authenticated)',
    )
    .addTag(
      'CATEGORIES',
      'Public category tree â€” browse the nested category hierarchy and resolve slug paths',
    )
    .addTag(
      'VENDOR - ANALYTICS',
      'Vendor analytics â€” revenue, top products, performance metrics',
    )
    .addTag(
      'VENDOR - DISCOUNT CODES',
      'Vendor discount code management â€” create, list, deactivate, delete codes',
    )
    .addTag(
      'VENDOR - ORDERS',
      'Vendor order management â€” view orders containing your products, update fulfillment status',
    )
    .addTag(
      'VENDOR - PRODUCT VARIANTS',
      'Vendor variant management â€” CRUD, stock adjustments, activate/deactivate',
    )
    .addTag(
      'VENDOR - PRODUCTS',
      'Vendor product management â€” CRUD, stock adjustments, activate/deactivate',
    )
    .addTag(
      'VENDOR - SEARCH',
      'Vendor-scoped search and autocomplete for products, orders, and discount codes',
    )
    .addTag(
      'VENDOR - WALLET',
      'Vendor wallet â€” view balance, transaction history',
    )
    .addTag(
      'VENDORS - ACCOUNT',
      'Vendor account management â€” view/update profile, deactivate, reactivate, delete account',
    )
    .addTag(
      'VENDORS - AUTH',
      'Vendor authentication â€” register, login, logout, refresh, OTP, password reset, Google sign-in & registration',
    )
    .addTag(
      'HEALTH',
      'Application health and readiness checks â€” liveness probe, database connectivity',
    )
    .addTag(
      'IMAGES',
      'Authenticated image uploads for vendor and admin product management',
    )
    .addTag(
      'NOTIFICATIONS',
      'Authenticated notification inbox â€” list, read, and manage notifications',
    )
    .addTag(
      'NOTIFICATIONS - SSE',
      'Authenticated server-sent event stream for real-time notifications',
    )
    .addTag(
      'ORDERS',
      'Customer order management â€” checkout, view orders, cancel, update shipping',
    )
    .addTag(
      'PAYMENTS',
      'Payment processing via Paystack â€” initialize, verify, webhooks, refunds',
    )
    .addTag(
      'PRODUCT VARIANTS',
      'Public product variant information â€” sizes, colors, stock per variant',
    )
    .addTag(
      'PRODUCTS',
      'Public product catalog â€” browse, search, filter by category/price/stock',
    )
    .addTag(
      'REVIEWS',
      'Product reviews â€” create, view by product, delete your own reviews',
    )
    .addTag(
      'SEARCH',
      'Global storefront search â€” products, autocomplete suggestions',
    )
    .addTag(
      'SHIPPING ADDRESSES',
      'Saved shipping address management â€” create, list, set default, delete',
    )
    .addTag(
      'USER WALLET',
      'User wallet â€” view balance, transaction history (authenticated)',
    )
    .addTag(
      'USERS',
      'Current user profile management â€” view, update, change password, deactivate/delete account',
    )
    .addTag(
      'WISHLIST',
      'Customer wishlist â€” add/remove products and variants, view wishlist',
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
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
      docExpansion: 'none',
      filter: true,
      showRequestDuration: true,
      defaultModelsExpandDepth: 1,
      defaultModelExpandDepth: 1,
      tryItOutEnabled: true,
    },
    customSiteTitle: 'NUTS Platform â€” Staging & Development API Reference',
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

      /* Lists & Items â€” Permanently eliminate line collisions and text overlap */
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

      /* Inline Code Badges â€” Prevent line-box height expansion collisions */
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
    `ðŸš€ Swagger documentation available at /api/docs [${rawNodeEnv}] (JSON: /api/docs-json, YAML: /api/docs-yaml)`,
  );
}
