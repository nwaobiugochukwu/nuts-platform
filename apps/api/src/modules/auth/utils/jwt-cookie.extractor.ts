import type { Request } from 'express';

/**
 * Passport-JWT extractor for an httpOnly cookie.
 *
 * Authentication credentials are deliberately read from a fixed cookie
 * name controlled by the server, not from a role supplied by the client.
 */
export function jwtFromCookie(cookieName: string) {
  return (req?: Request): string | null => {
    if (!req) {
      return null;
    }

    const cookies: unknown = req.cookies;
    const token =
      typeof cookies === 'object' && cookies !== null && cookieName in cookies
        ? (cookies as Record<string, unknown>)[cookieName]
        : undefined;

    return typeof token === 'string' ? token.trim() || null : null;
  };
}
