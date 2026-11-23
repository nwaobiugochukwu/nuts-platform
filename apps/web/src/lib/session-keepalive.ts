import { performTokenRefresh } from "@/api/core/client";
import { getAuthToken, onTokenChange, type AuthRole } from "@/api/core/token-storage";
import { msUntilRefresh, readTokenExpiry } from "./token-expiry";

/**
 * Refreshes access tokens BEFORE they expire, the way long-lived dashboards do,
 * instead of waiting for a request to fail with 401:
 *
 *  - a timer per role fires one minute before the token's expiry;
 *  - when the tab becomes visible again (laptop woke up, user came back) or the
 *    network returns, any token that is expired or about to be is refreshed at once,
 *    because background timers are throttled or paused;
 *  - a transient failure (network) retries shortly; a real expiry is handled by the
 *    normal sign-out path.
 */
const LEAD_MS = 60_000;
const RETRY_MS = 30_000;
const ROLES: AuthRole[] = ["user", "vendor", "admin"];

const timers = new Map<AuthRole, ReturnType<typeof setTimeout>>();
let started = false;

function clearTimer(role: AuthRole) {
  const timer = timers.get(role);
  if (timer) clearTimeout(timer);
  timers.delete(role);
}

async function refreshNow(role: AuthRole) {
  const result = await performTokenRefresh(role);
  if (!result.success && result.reason === "unavailable") {
    clearTimer(role);
    timers.set(
      role,
      setTimeout(() => void refreshNow(role), RETRY_MS),
    );
  }
  // Success re-schedules through the token listener; "expired" signs the session out.
}

function schedule(role: AuthRole) {
  clearTimer(role);
  const exp = readTokenExpiry(getAuthToken(role));
  if (!exp) return;
  timers.set(
    role,
    setTimeout(() => void refreshNow(role), msUntilRefresh(exp, Date.now(), LEAD_MS)),
  );
}

function refreshStaleTokens() {
  for (const role of ROLES) {
    const exp = readTokenExpiry(getAuthToken(role));
    if (exp && msUntilRefresh(exp, Date.now(), LEAD_MS) === 0) void refreshNow(role);
  }
}

export function startSessionKeepAlive() {
  if (started || typeof window === "undefined") return;
  started = true;

  onTokenChange((token, role) => {
    const authRole = role as AuthRole;
    if (token) schedule(authRole);
    else clearTimer(authRole);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshStaleTokens();
  });
  window.addEventListener("online", refreshStaleTokens);

  // Tokens set before the listener was attached.
  for (const role of ROLES) if (getAuthToken(role)) schedule(role);
}
