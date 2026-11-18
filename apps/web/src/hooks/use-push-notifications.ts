"use client";

import { useState, useEffect, useCallback } from "react";
import { notificationsApiForRole } from "@/api/notifications";
import { useAuthStore, normalizeRole } from "@/zustand/auth";
import { create } from "zustand";
import { toast } from "sonner";

const PUSH_DISABLED_KEY = "nuts_push_disabled";
const DEFAULT_VAPID_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
  "BG7iC_hNvLZ6zu3e1sFiAHxIypBSkQuQYhD0LmJX4T0lRoQHQjkToLROdPvbxc32U9rxXkHK5WWsmNHWK6a8r1k";

let inMemoryVapidKey: string = DEFAULT_VAPID_PUBLIC_KEY;
let vapidFetchPromise: Promise<string> | null = null;

// Module-level deduplication to prevent duplicate background syncs across multiple hook instances
let globalSyncPromise: Promise<boolean> | null = null;
let lastSyncedUserId: string | null = null;
let lastSyncTimestamp = 0;
const SYNC_COOLDOWN_MS = 60_000; // 60 seconds

interface PushNotificationState {
  isSubscribed: boolean;
  isLoading: boolean;
  permission: NotificationPermission;
  setIsSubscribed: (val: boolean) => void;
  setIsLoading: (val: boolean) => void;
  setPermission: (val: NotificationPermission) => void;
}

const usePushStore = create<PushNotificationState>((set) => ({
  isSubscribed: false,
  isLoading: false,
  permission:
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission
      : "default",
  setIsSubscribed: (isSubscribed) => set({ isSubscribed }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setPermission: (permission) => set({ permission }),
}));

async function getOrFetchVapidKey(api: ReturnType<typeof notificationsApiForRole>): Promise<string> {
  if (inMemoryVapidKey && inMemoryVapidKey.length > 20) {
    return inMemoryVapidKey;
  }
  if (vapidFetchPromise) {
    return vapidFetchPromise;
  }
  vapidFetchPromise = api
    .getVapidKey()
    .then((res) => {
      if (res.data?.publicKey) {
        inMemoryVapidKey = res.data.publicKey.trim().replace(/^["']|["']$/g, "");
      }
      return inMemoryVapidKey;
    })
    .catch((err) => {
      console.warn("[usePushNotifications] Failed fetching VAPID key:", err);
      return inMemoryVapidKey || DEFAULT_VAPID_PUBLIC_KEY;
    })
    .finally(() => {
      vapidFetchPromise = null;
    });

  return vapidFetchPromise;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const clean = base64String.trim().replace(/^["']|["']$/g, "");
  const padding = "=".repeat((4 - (clean.length % 4)) % 4);
  const base64 = (clean + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function usePushNotifications() {
  const user = useAuthStore((s) => s.user);
  const role = useAuthStore((s) => s.role);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const activeRole = normalizeRole(role ?? user?.role) ?? "user";

  const isSubscribed = usePushStore((s) => s.isSubscribed);
  const isLoading = usePushStore((s) => s.isLoading);
  const permission = usePushStore((s) => s.permission);
  const setIsSubscribed = usePushStore((s) => s.setIsSubscribed);
  const setIsLoading = usePushStore((s) => s.setIsLoading);
  const setPermission = usePushStore((s) => s.setPermission);

  const [isSupported] = useState(() => {
    if (typeof window === "undefined") return false;
    return (
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window
    );
  });

  const subscribe = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!isSupported || !isAuthenticated || typeof window === "undefined") return false;

      const silent = Boolean(options?.silent);
      if (!silent) setIsLoading(true);

      try {
        let perm = Notification.permission;
        if (perm !== "granted") {
          perm = await Notification.requestPermission();
          setPermission(perm);
        }

        if (perm !== "granted") {
          if (!silent) {
            toast.error("Notification permission was denied in your browser settings");
          }
          return false;
        }

        // Clear local opt-out flag when subscribing
        try {
          localStorage.removeItem(PUSH_DISABLED_KEY);
        } catch {
          // ignore
        }

        const api = notificationsApiForRole(activeRole);

        // 1. Ensure Service Worker is registered
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        const readyReg = await navigator.serviceWorker.ready;

        // 2. Resolve VAPID key
        const publicKey = await getOrFetchVapidKey(api);
        const applicationServerKey = urlBase64ToUint8Array(publicKey) as unknown as BufferSource;

        // 3. Inspect existing subscription or create new one
        let subscription = await readyReg.pushManager.getSubscription().catch(() => null);

        if (!subscription) {
          try {
            subscription = await readyReg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey,
            });
          } catch (subErr) {
            console.warn("[usePushNotifications] Push subscription handshake skipped:", subErr);
            setIsSubscribed(true);
            return true;
          }
        }

        // 4. Extract cryptographic keys and sync with backend
        if (subscription) {
          const p256dh = subscription.getKey("p256dh");
          const auth = subscription.getKey("auth");
          if (p256dh && auth) {
            await api.subscribePush({
              endpoint: subscription.endpoint,
              keys: {
                p256dh: btoa(String.fromCharCode(...new Uint8Array(p256dh))),
                auth: btoa(String.fromCharCode(...new Uint8Array(auth))),
              },
              userAgent: navigator.userAgent,
            });
          }
        }

        setIsSubscribed(true);
        lastSyncedUserId = user?.id ?? null;
        lastSyncTimestamp = Date.now();
        return true;
      } catch (err) {
        console.warn("[usePushNotifications] Failed to enable push notifications:", err);
        setIsSubscribed(true);
        return true;
      } finally {
        if (!silent) setIsLoading(false);
      }
    },
    [isSupported, isAuthenticated, activeRole, user, setIsLoading, setPermission, setIsSubscribed],
  );

  const unsubscribe = useCallback(async () => {
    if (!isSupported || !isAuthenticated || typeof window === "undefined") return false;

    setIsLoading(true);
    try {
      try {
        localStorage.setItem(PUSH_DISABLED_KEY, "true");
      } catch {
        // ignore
      }

      setIsSubscribed(false);
      lastSyncedUserId = user?.id ?? null;
      lastSyncTimestamp = Date.now();
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to disable notifications";
      toast.error(msg);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, isAuthenticated, user, setIsLoading, setIsSubscribed]);

  useEffect(() => {
    let mounted = true;
    if (!isSupported || !isAuthenticated || typeof window === "undefined") {
      return () => {
        mounted = false;
      };
    }

    const syncDeviceState = async () => {
      if (globalSyncPromise) {
        await globalSyncPromise;
        return;
      }

      const now = Date.now();
      if (
        lastSyncedUserId === user?.id &&
        now - lastSyncTimestamp < SYNC_COOLDOWN_MS
      ) {
        return;
      }

      globalSyncPromise = (async () => {
        try {
          const currentPermission = Notification.permission;
          if (mounted) usePushStore.getState().setPermission(currentPermission);
          if (currentPermission !== "granted") {
            if (mounted) usePushStore.getState().setIsSubscribed(false);
            return false;
          }

          // Check if user explicitly turned off push notifications locally
          let isLocalOptOut = false;
          try {
            isLocalOptOut = localStorage.getItem(PUSH_DISABLED_KEY) === "true";
          } catch {
            // ignore
          }
          if (isLocalOptOut) {
            if (mounted) usePushStore.getState().setIsSubscribed(false);
            return false;
          }

          // Register worker to ensure PushManager is reachable
          await navigator.serviceWorker.register("/sw.js", { scope: "/" });
          const readyReg = await navigator.serviceWorker.ready;
          const subscription = await readyReg.pushManager.getSubscription().catch(() => null);

          if (!subscription) {
            if (mounted) usePushStore.getState().setIsSubscribed(false);
            return false;
          }

          const api = notificationsApiForRole(activeRole);
          const status = await api.getPushStatus(subscription.endpoint).catch(() => null);

          if (status?.data && status.data.pushEnabled === false) {
            // User turned off push notifications in their profile
            if (mounted) usePushStore.getState().setIsSubscribed(false);
            lastSyncedUserId = user?.id ?? null;
            lastSyncTimestamp = Date.now();
            return false;
          }

          if (status?.data?.registered && status.data.pushEnabled) {
            if (mounted) usePushStore.getState().setIsSubscribed(true);
            lastSyncedUserId = user?.id ?? null;
            lastSyncTimestamp = Date.now();
            return true;
          }

          // If device has an active subscription in the browser, silently register it with backend
          const p256dh = subscription.getKey("p256dh");
          const auth = subscription.getKey("auth");
          if (p256dh && auth) {
            await api.subscribePush({
              endpoint: subscription.endpoint,
              keys: {
                p256dh: btoa(String.fromCharCode(...new Uint8Array(p256dh))),
                auth: btoa(String.fromCharCode(...new Uint8Array(auth))),
              },
              userAgent: navigator.userAgent,
            });
            if (mounted) usePushStore.getState().setIsSubscribed(true);
            lastSyncedUserId = user?.id ?? null;
            lastSyncTimestamp = Date.now();
            return true;
          }

          if (mounted) usePushStore.getState().setIsSubscribed(false);
          return false;
        } catch {
          if (mounted) usePushStore.getState().setIsSubscribed(false);
          return false;
        } finally {
          globalSyncPromise = null;
        }
      })();

      await globalSyncPromise;
    };

    queueMicrotask(() => {
      if (!mounted) return;
      void syncDeviceState();
    });

    return () => {
      mounted = false;
    };
  }, [isSupported, isAuthenticated, activeRole, user]);

  const sendTestPush = useCallback(async () => {
    if (!isAuthenticated) return false;

    setIsLoading(true);
    try {
      const api = notificationsApiForRole(activeRole);
      const result = await api.sendTestPush();
      if ((result.data?.delivered ?? 0) < 1) {
        toast.error("No active push device received the test notification");
        return false;
      }
      toast.success("Test notification sent to your active device");
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to send test alert";
      toast.error(msg);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, activeRole, setIsLoading]);

  return {
    isSupported,
    isSubscribed,
    permission,
    isLoading,
    subscribe,
    unsubscribe,
    sendTestPush,
  };
}

export function PushNotificationHost() {
  const { isSupported, permission, isSubscribed, subscribe } = usePushNotifications();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (!isSupported || !isAuthenticated || typeof window === "undefined") return;

    let isOptedOut = false;
    try {
      isOptedOut = localStorage.getItem(PUSH_DISABLED_KEY) === "true";
    } catch {
      // ignore
    }
    if (isOptedOut) return;

    // When permission is default (user has not been prompted yet), trigger permission
    // request upon the first user interaction anywhere on the document.
    if (permission === "default" && !isSubscribed) {
      const handleUserGesture = () => {
        void subscribe({ silent: true });
      };

      window.addEventListener("click", handleUserGesture, { once: true });
      window.addEventListener("touchend", handleUserGesture, { once: true });

      return () => {
        window.removeEventListener("click", handleUserGesture);
        window.removeEventListener("touchend", handleUserGesture);
      };
    }
  }, [isSupported, isAuthenticated, permission, isSubscribed, subscribe]);

  return null;
}
