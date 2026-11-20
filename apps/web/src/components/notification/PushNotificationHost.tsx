"use client";

import { useEffect, useState } from "react";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { useAuthStore } from "@/zustand/auth";
import { Bell, X } from "lucide-react";

const PUSH_PROMPT_DISMISSED_KEY = "nuts_push_prompt_dismissed";

/**
 * Production-grade Push Notification Banner Host.
 * Surfaces a clean, dismissible, non-intrusive permission prompt for authenticated
 * users whose browser notification permission is still 'default'.
 */
export function PushNotificationHost() {
  const { isSupported, permission, isSubscribed, subscribe, isLoading } = usePushNotifications();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    if (!isSupported || !isAuthenticated || typeof window === "undefined") return;

    if (permission !== "default" || isSubscribed) return;

    let dismissed = false;
    try {
      dismissed = sessionStorage.getItem(PUSH_PROMPT_DISMISSED_KEY) === "true";
    } catch {
      // ignore
    }
    if (dismissed) return;

    const timer = setTimeout(() => {
      setShowPrompt(true);
    }, 3500);
    return () => clearTimeout(timer);
  }, [isSupported, isAuthenticated, permission, isSubscribed]);

  const shouldShowPrompt =
    showPrompt &&
    isSupported &&
    isAuthenticated &&
    permission === "default" &&
    !isSubscribed;

  const handleDismiss = () => {
    setShowPrompt(false);
    try {
      sessionStorage.setItem(PUSH_PROMPT_DISMISSED_KEY, "true");
    } catch {
      // ignore
    }
  };

  const handleEnable = async () => {
    const ok = await subscribe({ silent: false });
    if (ok || (typeof window !== "undefined" && "Notification" in window && Notification.permission !== "default")) {
      setShowPrompt(false);
    }
  };

  if (!shouldShowPrompt) return null;

  return (
    <aside
      aria-label="Push notification permission prompt"
      className="fixed bottom-4 right-4 z-50 max-w-sm rounded-2xl border border-border bg-card/95 p-4 text-card-foreground shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-3 duration-300 sm:bottom-6 sm:right-6"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Bell className="h-5 w-5" />
        </div>
        <div className="flex-1 space-y-1">
          <div className="flex items-center justify-between">
            <h4 className="text-xs sm:text-sm font-semibold text-foreground">
              Enable Push Notifications
            </h4>
            <button
              type="button"
              onClick={handleDismiss}
              className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
              aria-label="Dismiss notification prompt"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed">
            Get instant updates on your orders, delivery status, discounts, and payments.
          </p>
          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              disabled={isLoading}
              onClick={handleEnable}
              className="rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer"
            >
              {isLoading ? "Enabling..." : "Allow Notifications"}
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              className="rounded-xl px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
