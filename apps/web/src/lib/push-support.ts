/**
 * Why web push can or cannot work in this browser, and what to tell the user.
 *
 * "Unsupported" is rarely the whole story. Brave hides the Push API until the
 * user enables Google's push service, iOS Safari only allows push for web apps
 * added to the Home Screen, and every browser needs a secure context. Naming the
 * actual cause (and the fix) is what separates a dead toggle from a working one.
 */
export interface PushEnvironment {
  isSecureContext: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  userAgent: string;
  isBrave: boolean;
  /** Running as an installed web app (Home Screen / standalone window). */
  isStandalone: boolean;
}

export type PushUnsupportedReason =
  | "insecure-context"
  | "brave-push-disabled"
  | "ios-install-required"
  | "no-push-api";

export type PushSupport =
  | { status: "supported" }
  | {
      status: "unsupported";
      reason: PushUnsupportedReason;
      /** Short label for a status chip. */
      label: string;
      /** One-sentence explanation. */
      message: string;
      /** Ordered steps the user can take, when there is a fix. */
      steps: string[];
    };

const isIos = (ua: string) => /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua));

export const BRAVE_PUSH_SETTINGS_URL = "brave://settings/privacy";

export function detectPushSupport(env: PushEnvironment): PushSupport {
  if (!env.isSecureContext) {
    return {
      status: "unsupported",
      reason: "insecure-context",
      label: "Needs HTTPS",
      message: "Push notifications only work on secure (HTTPS) pages.",
      steps: [],
    };
  }

  const hasAll = env.hasServiceWorker && env.hasPushManager && env.hasNotification;
  if (hasAll) return { status: "supported" };

  if (env.isBrave) {
    return {
      status: "unsupported",
      reason: "brave-push-disabled",
      label: "Turned off in Brave",
      message:
        "Brave switches push notifications off by default because they route through Google's push service.",
      steps: [
        `Open ${BRAVE_PUSH_SETTINGS_URL} in a new tab.`,
        "Turn on “Use Google services for push messaging”.",
        "Restart Brave, then come back and enable notifications.",
      ],
    };
  }

  if (isIos(env.userAgent) && !env.isStandalone) {
    return {
      status: "unsupported",
      reason: "ios-install-required",
      label: "Add to Home Screen",
      message: "On iPhone and iPad, notifications work once this site is added to your Home Screen.",
      steps: [
        "Tap the Share button in Safari.",
        "Choose “Add to Home Screen”.",
        "Open NUTS from the Home Screen, then enable notifications.",
      ],
    };
  }

  return {
    status: "unsupported",
    reason: "no-push-api",
    label: "Not supported",
    message: "This browser does not support web push notifications. Try Chrome, Edge, Firefox or Safari.",
    steps: [],
  };
}

/**
 * Failures that come from the browser or network rather than from this app
 * (permission blocked, push service unreachable). They are shown to the user as
 * a toast and logged as warnings so they do not raise the development error overlay.
 */
export function isExpectedSubscribeError(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name ?? "";
  const message = error instanceof Error ? error.message : "";
  return name === "NotAllowedError" || name === "AbortError" || /push service/i.test(message);
}

/** A user-facing explanation for a failed `pushManager.subscribe()`. */
export function explainSubscribeError(error: unknown, env: Pick<PushEnvironment, "isBrave">): string {
  const name = (error as { name?: string } | null)?.name ?? "";
  const message = error instanceof Error ? error.message : "";

  if (name === "NotAllowedError") {
    return "Notifications are blocked for this site. Allow them from the lock icon in the address bar.";
  }
  // "Registration failed - push service error": the browser could not reach its push service.
  if (name === "AbortError" || /push service/i.test(message)) {
    return env.isBrave
      ? `Brave could not reach its push service. Turn on “Use Google services for push messaging” at ${BRAVE_PUSH_SETTINGS_URL}, restart Brave, and try again.`
      : "Your browser could not reach its push service. Check your connection, VPN or firewall, then try again.";
  }
  if (name === "InvalidStateError") {
    return "Push registration is out of date. Reload the page and try again.";
  }
  return message || "Failed to enable push notifications.";
}

/** Backoff for the in-app permission prompt: how long to wait after the n-th dismissal. */
export const PROMPT_SNOOZE_DAYS = [3, 14, 60] as const;

export function nextPromptDelayMs(dismissals: number): number | null {
  if (dismissals <= 0) return 0;
  const days = PROMPT_SNOOZE_DAYS[Math.min(dismissals, PROMPT_SNOOZE_DAYS.length) - 1] ?? 60;
  return days * 24 * 60 * 60 * 1000;
}
