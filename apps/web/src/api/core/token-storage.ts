/**
 * In-Memory Token Manager
 *
 * Implements OWASP token storage guidelines:
 * - Short-lived access tokens are stored exclusively in memory (private closure), immune to XSS theft via localStorage / sessionStorage.
 * - Long-lived refresh tokens are handled exclusively via HttpOnly Secure SameSite cookies.
 * - State is cleanly wiped on logout or expiration.
 */
export type AuthRole = "user" | "admin" | "vendor";

export interface StoredTokens {
  accessToken?: string | null;
}

const accessTokens: Record<AuthRole, string | null> = {
  user: null,
  admin: null,
  vendor: null,
};

const knownUnauthenticatedRoles = new Set<string>();

export const isSessionKnownUnauthenticated = (role: string): boolean => {
  return knownUnauthenticatedRoles.has(role.toLowerCase());
};

export const markSessionUnauthenticated = (role?: string) => {
  if (role) {
    knownUnauthenticatedRoles.add(role.toLowerCase());
  } else {
    ["user", "admin", "vendor"].forEach((r) =>
      knownUnauthenticatedRoles.add(r),
    );
  }
};

export const markSessionAuthenticated = (role?: string) => {
  if (role) {
    knownUnauthenticatedRoles.delete(role.toLowerCase());
  } else {
    knownUnauthenticatedRoles.clear();
  }
};

type TokenListener = (token: string | null, role: string) => void;
const tokenListeners = new Set<TokenListener>();

export const getAuthToken = (role: AuthRole): string | null => {
  return accessTokens[role];
};

export const getRefreshToken = (): string | null => {
  // Refresh tokens are strictly HttpOnly cookies and inaccessible to JavaScript.
  return null;
};

export const setAuthTokens = (role: AuthRole, tokens: StoredTokens | null) => {
  const tokenValue = tokens?.accessToken ?? null;
  accessTokens[role] = tokenValue;

  if (tokenValue) {
    markSessionAuthenticated(role);
  }

  tokenListeners.forEach((listener) => {
    try {
      listener(tokenValue, role);
    } catch {
      // Ignore listener errors
    }
  });
};

export const setAuthToken = (role: AuthRole, token: string | null) => {
  setAuthTokens(role, { accessToken: token });
};

export const clearAuthTokens = (role?: AuthRole | string) => {
  const roles: AuthRole[] = role
    ? [role.toLowerCase() as AuthRole]
    : (Object.keys(accessTokens) as AuthRole[]);

  roles.forEach((tokenRole) => {
    accessTokens[tokenRole] = null;
    markSessionUnauthenticated(tokenRole);
    tokenListeners.forEach((listener) => {
      try {
        listener(null, tokenRole);
      } catch {
        // Ignore listener errors
      }
    });
  });
};

export const onTokenChange = (listener: TokenListener): (() => void) => {
  tokenListeners.add(listener);
  return () => {
    tokenListeners.delete(listener);
  };
};

export const decodeRoleFromToken = (token?: string | null): AuthRole | null => {
  if (!token || typeof token !== "string") return null;
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const base64Url = parts[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    const parsed = JSON.parse(jsonPayload);
    const rawRole = parsed?.role ? String(parsed.role).toLowerCase() : null;
    if (rawRole === "admin" || rawRole === "vendor" || rawRole === "user") {
      return rawRole as AuthRole;
    }
  } catch {
    // Malformed token payload
  }
  return null;
};

export const getAuthSessionRole = (): AuthRole | null => {
  if (typeof window === "undefined") return null;

  for (const role of ["admin", "vendor", "user"] as const) {
    const token = accessTokens[role];
    if (token) {
      const decoded = decodeRoleFromToken(token);
      if (decoded) return decoded;
      return role;
    }
  }

  return null;
};


