/** Reads the `exp` claim (seconds since epoch) from a JWT without verifying it. */
export function readTokenExpiry(token: string | null | undefined): number | null {
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const parsed = JSON.parse(atob(padded)) as { exp?: unknown };
    return typeof parsed.exp === "number" ? parsed.exp : null;
  } catch {
    return null;
  }
}

/**
 * How long to wait before refreshing so the new token is in place `leadMs` before
 * the old one expires (never negative; a token already inside the window refreshes now).
 */
export function msUntilRefresh(expSeconds: number, nowMs: number, leadMs: number): number {
  return Math.max(0, expSeconds * 1000 - nowMs - leadMs);
}
