import { NextResponse, type NextRequest } from "next/server.js";

// ── Environment Detection ───────────────────────────────────────────────────
const nodeEnv = process.env.NODE_ENV as string | undefined;
const isProduction = nodeEnv === "production";
const isStaging =
  nodeEnv === "staging" ||
  process.env.NEXT_PUBLIC_APP_ENV === "staging" ||
  process.env.APP_ENV === "staging";
const isSecureContext = isProduction || isStaging;

// ── Content Security Policy & Security Headers ──────────────────────────────
function safeOrigin(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (isSecureContext && url.protocol !== "https:") {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function generateNonce(): string {
  const buffer = new Uint8Array(16);
  crypto.getRandomValues(buffer);
  let binary = "";
  for (let i = 0; i < buffer.length; i++) {
    binary += String.fromCharCode(buffer[i]!);
  }
  return btoa(binary);
}

export function buildContentSecurityPolicy(nonce: string): string {
  const connectSources = new Set<string>([
    "'self'",
    "https://api.paystack.co",
    "https://standard.paystack.co",
    "https://accounts.google.com/gsi/",
  ]);

  for (const rawUrl of [
    process.env.NEXT_PUBLIC_API_URL,
    process.env.NEXT_PUBLIC_BACKEND_URL,
    process.env.NEXT_PUBLIC_WS_URL,
  ]) {
    const origin = safeOrigin(rawUrl);
    if (origin) connectSources.add(origin);
  }

  const scriptSources = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    "https://js.paystack.co",
    "https://accounts.google.com/gsi/client",
  ];

  if (!isSecureContext) {
    scriptSources.push("'unsafe-eval'");
  }

  const imageSources = new Set<string>([
    "'self'",
    "data:",
    "blob:",
    "https://res.cloudinary.com",
    "https://images.unsplash.com",
    "https://lh3.googleusercontent.com",
  ]);

  if (process.env.NEXT_PUBLIC_IMAGE_DOMAINS) {
    for (const domain of process.env.NEXT_PUBLIC_IMAGE_DOMAINS.split(",")) {
      const trimmed = domain.trim();
      if (trimmed) {
        imageSources.add(
          trimmed.startsWith("http") ? trimmed : `https://${trimmed}`,
        );
      }
    }
  }

  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
    "style-src-elem 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
    "style-src-attr 'unsafe-inline'",
    `img-src ${Array.from(imageSources).join(" ")}`,
    "font-src 'self' data:",
    `connect-src ${Array.from(connectSources).join(" ")}`,
    "frame-src https://checkout.paystack.com https://standard.paystack.co https://accounts.google.com/gsi/",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    ...(isSecureContext ? ["upgrade-insecure-requests"] : []),
  ];

  return directives.join("; ");
}

export function applySecurityHeaders(
  response: NextResponse,
  nonce: string,
): NextResponse {
  const csp = buildContentSecurityPolicy(nonce);
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  );

  if (isSecureContext) {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }

  return response;
}

// ── Next.js 16 Network Boundary Proxy ───────────────────────────────────────
/**
 * Lightweight network boundary proxy.
 * Responsibilities:
 * 1. Generates and propagates CSP nonces to Server Components via request header `x-nonce`.
 * 2. Applies enterprise browser security headers & CSP on all incoming web requests.
 * 3. Strips untrusted client-supplied identity headers (`x-user-id`, `x-user-role`, `x-authenticated`).
 *
 * Route-level authorization is handled by Server Component layouts and the NestJS API kernel,
 * avoiding brittle hardcoded routes at the proxy layer.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const nonce = generateNonce();
  const requestHeaders = new Headers(request.headers);

  // CRITICAL SECURITY: Strip any client-supplied spoofed identity headers
  requestHeaders.delete("x-user-id");
  requestHeaders.delete("x-user-role");
  requestHeaders.delete("x-authenticated");

  // Propagate CSP nonce to React Server Components (headers().get('x-nonce'))
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(
    "Content-Security-Policy",
    buildContentSecurityPolicy(nonce),
  );

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  return applySecurityHeaders(response, nonce);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - /api and /api/* (handled by NestJS API / rewrites)
     * - _next/static, _next/image, favicon, sitemap, robots
     * - static file assets (.png, .jpg, .svg, .css, .js, etc.)
     */
    "/((?!api(?:/|$)|_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|woff|woff2)$).*)",
  ],
};
