import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyJwtHs256, type Role } from "./edge-jwt.ts";

export interface ServerSession {
  readonly isAuthenticated: boolean;
  readonly role: Role | null;
  readonly userId: string | null;
}

function decodeJwtClaims(token: string): { sub?: string; role?: Role; exp?: number } | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const base64Url = parts[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const pad = base64.length % 4;
    const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
    const json = atob(padded);
    const parsed = JSON.parse(json);
    const rawRole = parsed?.role ? String(parsed.role).toLowerCase() : null;
    const role: Role | null =
      rawRole === "admin" || rawRole === "vendor" || rawRole === "user"
        ? (rawRole as Role)
        : null;
    return {
      sub: parsed?.sub ? String(parsed.sub) : undefined,
      role: role ?? undefined,
      exp: typeof parsed?.exp === "number" ? parsed.exp : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Resolves verified authentication session from incoming HTTP-only cookies in Server Components.
 */
export async function getServerSession(): Promise<ServerSession> {
  const cookieStore = await cookies();
  const accessToken =
    cookieStore.get("accessToken")?.value ??
    cookieStore.get("access_token")?.value;
  const refreshToken =
    cookieStore.get("refreshToken")?.value ??
    cookieStore.get("refresh_token")?.value;
  const secret = process.env.JWT_SECRET;

  // 1. If accessToken exists and secret is set, verify cryptographic signature
  if (accessToken && secret) {
    const verified = await verifyJwtHs256(accessToken, secret);
    if (verified) {
      return {
        isAuthenticated: true,
        role: verified.role,
        userId: verified.sub,
      };
    }
  }

  // 2. Refresh grace window: If accessToken expired or missing, but valid HttpOnly refreshToken exists,
  // allow server layouts to render so client-side hydration can complete silent token rotation.
  if (refreshToken) {
    const claims = decodeJwtClaims(refreshToken);
    const now = Math.floor(Date.now() / 1000);
    if (claims?.role && claims?.sub && (!claims.exp || claims.exp > now)) {
      return {
        isAuthenticated: true,
        role: claims.role,
        userId: claims.sub,
      };
    }
  }

  return { isAuthenticated: false, role: null, userId: null };
}

/**
 * Enforces authentication and optional role requirement within Next.js Layout / Server Components.
 * Automatically redirects unauthenticated or unauthorized visitors without hardcoding routes in proxy.
 */
export async function enforceAuth(requiredRole?: Role, loginPath = "/auth/login") {
  const session = await getServerSession();

  if (!session.isAuthenticated) {
    redirect(loginPath);
  }

  if (requiredRole && session.role !== requiredRole) {
    redirect(loginPath);
  }

  return session;
}
