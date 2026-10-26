import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Express } from 'express';
import { Logger } from 'nestjs-pino';
import { removeDuplicateAdminCategoryPaths } from './modules/shared/utils/swagger-paths.util';

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

  const renderServiceName = (
    config.get<string>('RENDER_SERVICE_NAME') ||
    process.env.RENDER_SERVICE_NAME ||
    ''
  ).toLowerCase();

  const renderExternalUrl = (
    config.get<string>('RENDER_EXTERNAL_URL') ||
    config.get<string>('RENDER_EXTERNAL_HOSTNAME') ||
    config.get<string>('BASE_URL') ||
    process.env.RENDER_EXTERNAL_URL ||
    process.env.RENDER_EXTERNAL_HOSTNAME ||
    process.env.BASE_URL ||
    ''
  ).toLowerCase();

  const swaggerFlag =
    config.get<string | boolean>('SWAGGER_ENABLED') ??
    process.env.SWAGGER_ENABLED;

  const isExplicitlyEnabled =
    swaggerFlag === true || swaggerFlag === 'true' || swaggerFlag === '1';

  const isExplicitlyDisabled =
    swaggerFlag === false || swaggerFlag === 'false' || swaggerFlag === '0';

  // Staging detection:
  // 1. Explicit NODE_ENV=staging or APP_ENV=staging
  // 2. Render service name or hostname contains 'staging' (e.g. nuts-api-staging.onrender.com)
  const isStaging =
    rawNodeEnv === 'staging' ||
    rawAppEnv === 'staging' ||
    renderServiceName.includes('staging') ||
    renderExternalUrl.includes('staging');

  // Strict production: APP_ENV is explicitly production
  const isStrictProduction = rawAppEnv === 'production';

  // Production check: strict production OR (NODE_ENV=production and not staging and not explicitly enabled)
  const isProduction =
    isStrictProduction ||
    (rawNodeEnv === 'production' && !isStaging && !isExplicitlyEnabled);

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

Architected with **NestJS 11**, **TypeScript 5.8**, **PostgreSQL 16**, **Prisma 7**, **Redis Alpine**, and **RabbitMQ** following Domain-Driven Design (DDD) principles.

---

### Quick Authentication Guide
- **Web Clients:** Automatically receive and manage \`accessToken\` and \`refreshToken\` in \`HttpOnly\`, \`Secure\`, \`SameSite=Lax\` cookies.
- **Swagger / Mobile Testing:** Obtain an access token via \`POST /api/v1/auth/login\` (Customer), \`POST /api/v1/vendors/auth/login\` (Vendor), or \`POST /api/v1/admin/auth/login\` (Admin).
- Click the green **Authorize** button at the top right, paste your token in the \`Bearer <token>\` field, and click **Authorize**.

---

### Role Access & Capability Boundaries
- **Customer (\`user\`):** Storefront catalog, cart, checkout, customer orders, wallet, and wishlist.
- **Vendor (\`vendor\`):** Merchant catalog, product variants, inventory, store orders, and vendor wallet.
- **Admin (\`admin\`):** Platform governance, merchant approvals, user management, and category taxonomy.

All requests return a standard RFC envelope: \`{ success: boolean, message: string, data: any, timestamp: string }\`.`,
    )
    .setVersion('1.0.0');

  const serverUrls = new Set<string>();

  if (baseUrl) {
    swaggerBuilder.addServer(
      baseUrl,
      isStaging ? 'Active Staging Server' : 'Active Server',
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
      'Admin analytics — summary, revenue, top products/vendors/categories, funnel, activity audit',
    )
    .addTag(
      'ADMIN - AUTH',
      'Admin authentication — login, logout, token refresh, administrator provisioning',
    )
    .addTag(
      'ADMIN - CACHE',
      'Admin-only cache operations — inspect and flush shared Redis cache data',
    )
    .addTag(
      'ADMIN - CATEGORY',
      'Admin category management — create, update, activate/deactivate, delete',
    )
    .addTag(
      'ADMIN - VENDORS',
      'Admin vendor management — list, approve, verify, suspend, delete',
    )
    .addTag(
      'ADMIN - DISCOUNT CODES',
      'Admin discount code management — create platform-wide codes, list, deactivate, delete',
    )
    .addTag(
      'ADMIN - ORDERS',
      'Admin order management — list/filter all orders, update any order status',
    )
    .addTag(
      'ADMIN - PRODUCT VARIANTS',
      'Admin variant management — CRUD, stock, activate/deactivate for any variant',
    )
    .addTag(
      'ADMIN - PRODUCTS',
      'Admin product management — CRUD, stock, activate/deactivate for any product',
    )
    .addTag(
      'ADMIN - SEARCH',
      'Admin global search — search users, vendors, products, orders, and discount codes',
    )
    .addTag(
      'ADMIN - USERS',
      'Admin user management — list, view, deactivate/reactivate, delete users',
    )
    .addTag(
      'AUTH',
      'Customer authentication — register, login, logout, refresh, password reset',
    )
    .addTag(
      'CART',
      'Shopping cart management — add/update/remove items, clear cart (authenticated)',
    )
    .addTag(
      'CATEGORIES',
      'Public category tree — browse the nested category hierarchy and resolve slug paths',
    )
    .addTag(
      'VENDOR - ANALYTICS',
      'Vendor analytics — revenue, top products, performance metrics',
    )
    .addTag(
      'VENDOR - DISCOUNT CODES',
      'Vendor discount code management — create, list, deactivate, delete codes',
    )
    .addTag(
      'VENDOR - ORDERS',
      'Vendor order management — view orders containing your products, update fulfillment status',
    )
    .addTag(
      'VENDOR - PRODUCT VARIANTS',
      'Vendor variant management — CRUD, stock adjustments, activate/deactivate',
    )
    .addTag(
      'VENDOR - PRODUCTS',
      'Vendor product management — CRUD, stock adjustments, activate/deactivate',
    )
    .addTag(
      'VENDOR - SEARCH',
      'Vendor-scoped search and autocomplete for products, orders, and discount codes',
    )
    .addTag(
      'VENDOR - WALLET',
      'Vendor wallet — view balance, transaction history',
    )
    .addTag(
      'VENDORS - ACCOUNT',
      'Vendor account management — view/update profile, deactivate, reactivate, delete account',
    )
    .addTag(
      'VENDORS - AUTH',
      'Vendor authentication — register, login, logout, refresh, OTP, password reset',
    )
    .addTag(
      'HEALTH',
      'Application health and readiness checks — liveness probe, database connectivity',
    )
    .addTag(
      'IMAGES',
      'Authenticated image uploads for vendor and admin product management',
    )
    .addTag(
      'NOTIFICATIONS',
      'Authenticated notification inbox — list, read, and manage notifications',
    )
    .addTag(
      'NOTIFICATIONS - SSE',
      'Authenticated server-sent event stream for real-time notifications',
    )
    .addTag(
      'ORDERS',
      'Customer order management — checkout, view orders, cancel, update shipping',
    )
    .addTag(
      'PAYMENTS',
      'Payment processing via Paystack — initialize, verify, webhooks, refunds',
    )
    .addTag(
      'PRODUCT VARIANTS',
      'Public product variant information — sizes, colors, stock per variant',
    )
    .addTag(
      'PRODUCTS',
      'Public product catalog — browse, search, filter by category/price/stock',
    )
    .addTag(
      'REVIEWS',
      'Product reviews — create, view by product, delete your own reviews',
    )
    .addTag(
      'SEARCH',
      'Global storefront search — products, autocomplete suggestions',
    )
    .addTag(
      'SHIPPING ADDRESSES',
      'Saved shipping address management — create, list, set default, delete',
    )
    .addTag(
      'USER WALLET',
      'User wallet — view balance, transaction history (authenticated)',
    )
    .addTag(
      'USERS',
      'Current user profile management — view, update, change password, deactivate/delete account',
    )
    .addTag(
      'WISHLIST',
      'Customer wishlist — add/remove products and variants, view wishlist',
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

      /* Lists & Items — Permanently eliminate line collisions and text overlap */
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

      /* Inline Code Badges — Prevent line-box height expansion collisions */
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
    `🚀 Swagger documentation available at /api/docs [${rawNodeEnv}] (JSON: /api/docs-json, YAML: /api/docs-yaml)`,
  );
}
