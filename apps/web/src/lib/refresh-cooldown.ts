/**
 * A pause after the server says "too many requests" to a session refresh.
 *
 * Several places refresh the login on their own (the page's first load, the keep-alive timer, the
 * notification stream, the request interceptor). When the server refused one with a 429, none of
 * them knew the others had been refused, so each tried again at once and kept the limit full. All
 * of them go through one function, which now asks this before calling the API: during a cool-down
 * it answers "unavailable" immediately and sends nothing.
 */
export const DEFAULT_COOLDOWN_MS = 30_000;
export const MIN_COOLDOWN_MS = 1_000;
export const MAX_COOLDOWN_MS = 120_000;

function seconds(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value.trim()) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * How long to wait, from the `Retry-After` header (seconds) or the `retryAfter` field of the error
 * body, whichever is there. Clamped: a missing, zero or absurd value never means "retry now" or
 * "wait an hour".
 */
export function cooldownMsFromRateLimit(
  retryAfterHeader?: unknown,
  bodyRetryAfter?: unknown,
): number {
  const fromHeader = seconds(retryAfterHeader);
  const fromBody = seconds(bodyRetryAfter);
  const chosen = fromHeader !== null && fromHeader > 0 ? fromHeader : fromBody;
  if (chosen === null || chosen <= 0) return DEFAULT_COOLDOWN_MS;
  return Math.min(MAX_COOLDOWN_MS, Math.max(MIN_COOLDOWN_MS, Math.round(chosen * 1000)));
}

export function createRefreshCooldown(now: () => number = Date.now) {
  const until = new Map<string, number>();
  return {
    /** Starts (or extends, never shortens) a pause for this role. */
    start(role: string, ms: number): void {
      const end = now() + ms;
      if (end > (until.get(role) ?? 0)) until.set(role, end);
    },
    isActive(role: string): boolean {
      return now() < (until.get(role) ?? 0);
    },
    remainingMs(role: string): number {
      return Math.max(0, (until.get(role) ?? 0) - now());
    },
  };
}
