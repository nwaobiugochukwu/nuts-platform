export const AUTH_ACCESS_COOKIE = 'accessToken';
export const AUTH_REFRESH_COOKIE = 'refreshToken';
export const AUTH_COOKIE_PATH = '/';

export type AuthCookieRole = 'user' | 'admin' | 'vendor';

/**
 * One cookie pair PER ROLE. With a single shared pair, signing in as a customer
 * (or as an admin) in the same browser overwrote the vendor's refresh token and
 * silently signed the vendor out. Customers keep the original names so existing
 * sessions survive the deploy.
 */
export const AUTH_COOKIE_NAMES: Record<
  AuthCookieRole,
  { access: string; refresh: string }
> = {
  user: { access: AUTH_ACCESS_COOKIE, refresh: AUTH_REFRESH_COOKIE },
  vendor: { access: 'vendorAccessToken', refresh: 'vendorRefreshToken' },
  admin: { access: 'adminAccessToken', refresh: 'adminRefreshToken' },
};

/** Which portal a request belongs to, from its URL path. */
export function authCookieRoleForPath(
  path: string | undefined,
): AuthCookieRole {
  const p = (path ?? '').toLowerCase();
  if (/^\/api\/v\d+\/admin(\/|$|\?)/.test(p) || /^\/admin(\/|$|\?)/.test(p)) {
    return 'admin';
  }
  if (
    /^\/api\/v\d+\/vendors?(\/|$|\?)/.test(p) ||
    /^\/vendors?(\/|$|\?)/.test(p)
  ) {
    return 'vendor';
  }
  return 'user';
}
