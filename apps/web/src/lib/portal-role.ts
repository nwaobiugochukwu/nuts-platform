export type PortalRole = "user" | "vendor" | "admin";

/**
 * Derives the intended portal role based on the current URL pathname.
 */
export function getPortalRoleFromPath(pathname?: string | null): PortalRole {
  if (!pathname) return "user";
  if (pathname.startsWith("/auth/admin") || pathname.startsWith("/admin")) {
    return "admin";
  }
  if (pathname.startsWith("/auth/vendor") || pathname.startsWith("/vendor")) {
    return "vendor";
  }
  return "user";
}

export interface AuthPageRedirectEvaluation {
  shouldRedirect: boolean;
  targetPath: string | null;
  isCrossRoleAccess: boolean;
}

/**
 * Determines whether an auth page (login/register) should redirect an authenticated user.
 *
 * Rules:
 * - Unauthenticated users are NEVER redirected.
 * - Authenticated users are ONLY redirected if their active role MATCHES the portal auth page.
 * - Authenticated users visiting a DIFFERENT portal's auth page are NOT redirected, preventing
 *   infinite redirect loops and allowing them to sign into or switch their account.
 */
export function evaluateAuthPageRedirect(
  pathname: string | null | undefined,
  isAuthenticated: boolean,
  activeRole: PortalRole | null | undefined,
  redirectParam?: string | null,
): AuthPageRedirectEvaluation {
  if (!isAuthenticated || !activeRole) {
    return { shouldRedirect: false, targetPath: null, isCrossRoleAccess: false };
  }

  const targetPortalRole = getPortalRoleFromPath(pathname);
  const isMatch = activeRole === targetPortalRole;

  if (!isMatch) {
    return {
      shouldRedirect: false,
      targetPath: null,
      isCrossRoleAccess: true,
    };
  }

  let targetPath = "/";
  if (targetPortalRole === "admin") {
    targetPath = redirectParam || "/admin";
  } else if (targetPortalRole === "vendor") {
    targetPath = redirectParam || "/vendor/analytic";
  } else {
    targetPath = redirectParam || "/";
  }

  return {
    shouldRedirect: true,
    targetPath,
    isCrossRoleAccess: false,
  };
}
