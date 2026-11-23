"use client";

import { usePushNotifications } from "@/hooks/use-push-notifications";
import { nextPromptDelayMs } from "@/lib/push-support";
import { useAuthStore } from "@/zustand/auth";
import { Bell, X } from "lucide-react";
import { useEffect, useState } from "react";

const PROMPT_STATE_KEY = "nuts_push_prompt_v2";
const PUSH_DISABLED_KEY = "nuts_push_disabled";
/** Let the page settle first: asking the instant it loads is how sites get blocked. */
const SHOW_DELAY_MS = 6000;

interface PromptState {
  dismissals: number;
  lastDismissedAt: number;
}

function readPromptState(): PromptState {
  try {
    const raw = window.localStorage.getItem(PROMPT_STATE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<PromptState>) : null;
    return {
      dismissals: Number(parsed?.dismissals) || 0,
      lastDismissedAt: Number(parsed?.lastDismissedAt) || 0,
    };
  } catch {
    return { dismissals: 0, lastDismissedAt: 0 };
  }
}

function writePromptState(state: PromptState) {
  try {
    window.localStorage.setItem(PROMPT_STATE_KEY, JSON.stringify(state));
  } catch {
    // Storage blocked: the prompt simply reappears next visit.
  }
}

function snoozeActive(): boolean {
  const { dismissals, lastDismissedAt } = readPromptState();
  const delay = nextPromptDelayMs(dismissals);
  return delay !== null && delay > 0 && Date.now() - lastDismissedAt < delay;
}

function optedOutOnThisDevice(): boolean {
  try {
    return window.localStorage.getItem(PUSH_DISABLED_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Asks signed-in users to turn on push notifications, the way production apps do:
 *
 *  - a friendly in-app prompt FIRST; the browser's one-shot permission dialog is
 *    only triggered when the user taps "Turn on" (a denied browser prompt is
 *    permanent, so it is never spent on a cold page load);
 *  - shown after a short delay, only while permission is still undecided;
 *  - "Not now" snoozes it with backoff (3 days, then 2 weeks, then 2 months)
 *    instead of nagging every session;
 *  - never shown where push cannot work (the preferences page explains why).
 */
export function PushNotificationHost() {
  const { isSupported, permission, isSubscribed, subscribe, isLoading } = usePushNotifications();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const eligible =
    isSupported && isAuthenticated && permission === "default" && !isSubscribed && !dismissed;

  useEffect(() => {
    if (!eligible) return;
    if (snoozeActive() || optedOutOnThisDevice()) return;
    const timer = window.setTimeout(() => setReady(true), SHOW_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      setReady(false);
    };
  }, [eligible]);

  if (!eligible || !ready) return null;

  const snooze = () => {
    const { dismissals } = readPromptState();
    writePromptState({ dismissals: dismissals + 1, lastDismissedAt: Date.now() });
    setDismissed(true);
  };

  const enable = async () => {
    const ok = await subscribe({ silent: false });
    // Granted, or answered "Block" in the browser dialog: either way we are done asking.
    if (ok || (typeof Notification !== "undefined" && Notification.permission !== "default")) {
      setDismissed(true);
    }
  };

  return (
    <aside
      role="dialog"
      aria-label="Turn on notifications"
      className="fixed inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-2xl animate-in fade-in slide-in-from-bottom-3 duration-300 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-96"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Bell className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">Stay in the loop</h2>
            <button
              type="button"
              onClick={snooze}
              className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Not now"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Get instant alerts for orders, deliveries, payments and offers, even when NUTS isn’t open.
            You can change this anytime in notification preferences.
          </p>
          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              disabled={isLoading}
              onClick={() => void enable()}
              className="h-10 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {isLoading ? "Turning on…" : "Turn on"}
            </button>
            <button
              type="button"
              onClick={snooze}
              className="h-10 rounded-xl px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
