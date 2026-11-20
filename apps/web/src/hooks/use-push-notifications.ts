"use client";

import { useState, useEffect, useCallback } from "react";
import { notificationsApiForRole } from "@/api/notifications";
import { useAuthStore, normalizeRole } from "@/zustand/auth";
import { create } from "zustand";
import { toast } from "sonner";

export { PushNotificationHost } from "@/components/notification/PushNotificationHost";

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
const SYNC_COOLDOWN_MS = 30_000;

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
        // 1. Request notification permission from the browser
        let perm = Notification.permission;
        if (perm !== "granted") {
          perm = await Notification.requestPermission();
          setPermission(perm);
        }

        if (perm !== "granted") {
          setIsSubscribed(false);
          if (!silent) {
            toast.error(
              perm === "denied"
                ? "Notifications are blocked. Please allow notifications in your browser address bar."
                : "Notification permission was not granted.",
            );
          }
          return false;
        }

        // Clear local opt-out flag when user is actively subscribing
        try {
          localStorage.removeItem(PUSH_DISABLED_KEY);
        } catch {
          // ignore
        }

        const api = notificationsApiForRole(activeRole);

        // 2. Ensure Service Worker is registered and active
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        const readyReg = await navigator.serviceWorker.ready;

        // 3. Resolve VAPID server key
        const publicKey = await getOrFetchVapidKey(api);
        const applicationServerKey = urlBase64ToUint8Array(publicKey) as unknown as BufferSource;

        // 4. Inspect existing browser subscription or subscribe
        let subscription = await readyReg.pushManager.getSubscription().catch(() => null);

        if (subscription) {
          // Verify existing subscription against current VAPID key
          try {
            const rawKey = subscription.options.applicationServerKey;
            const currentSubKey = rawKey
              ? btoa(String.fromCharCode(...new Uint8Array(rawKey)))
              : "";
            const expectedKey = btoa(String.fromCharCode(...urlBase64ToUint8Array(publicKey)));
            if (currentSubKey && expectedKey && currentSubKey !== expectedKey) {
              await subscription.unsubscribe();
              subscription = null;
            }
          } catch {
            // Re-subscribe if inspection fails
            await subscription?.unsubscribe().catch(() => null);
            subscription = null;
          }
        }

        if (!subscription) {
          subscription = await readyReg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey,
          });
        }

        if (!subscription) {
          throw new Error("Unable to create browser push subscription");
        }

        // 5. Extract subscription keys and register with backend
        const p256dh = subscription.getKey("p256dh");
        const auth = subscription.getKey("auth");
        if (!p256dh || !auth) {
          throw new Error("Could not extract push encryption keys from browser");
        }

        await api.subscribePush({
          endpoint: subscription.endpoint,
          keys: {
            p256dh: btoa(String.fromCharCode(...new Uint8Array(p256dh))),
            auth: btoa(String.fromCharCode(...new Uint8Array(auth))),
          },
          userAgent: navigator.userAgent,
        });

        setIsSubscribed(true);
        lastSyncedUserId = user?.id ?? null;
        lastSyncTimestamp = Date.now();

        if (!silent) {
          toast.success("Push notifications enabled on this device");
        }
        return true;
      } catch (err: unknown) {
        console.error("[usePushNotifications] Failed to enable push notifications:", err);
        setIsSubscribed(false);
        if (!silent) {
          const msg =
            err instanceof Error ? err.message : "Failed to enable push notifications";
          toast.error(msg);
        }
        return false;
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

      const readyReg = await navigator.serviceWorker.ready.catch(() => null);
      const subscription = await readyReg?.pushManager.getSubscription().catch(() => null);
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe().catch(() => null);
        const api = notificationsApiForRole(activeRole);
        await api.unsubscribePush(endpoint).catch(() => null);
      }

      setIsSubscribed(false);
      lastSyncedUserId = user?.id ?? null;
      lastSyncTimestamp = Date.now();
      toast.info("Push notifications disabled on this device");
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to disable notifications";
      toast.error(msg);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, isAuthenticated, activeRole, user, setIsLoading, setIsSubscribed]);

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

          // Device has active browser subscription but backend doesn't know it yet: register it
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
    if (!isAuthenticated) {
      toast.error("Please log in to test push notifications");
      return false;
    }

    setIsLoading(true);
    try {
      // If the device is not registered yet, attempt subscription on this direct user gesture
      if (permission !== "granted" || !isSubscribed) {
        toast.info("Enabling notifications on this browser first...");
        const ok = await subscribe({ silent: false });
        if (!ok) {
          return false;
        }
      }

      const api = notificationsApiForRole(activeRole);
      const result = await api.sendTestPush();
      const count = result.data?.delivered ?? 0;
      if (count < 1) {
        toast.error("No active push device received the test notification. Try enabling push notifications again.");
        return false;
      }
      toast.success(`Test alert sent successfully to ${count} active device(s)!`);
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to send test alert";
      toast.error(msg);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, activeRole, permission, isSubscribed, subscribe, setIsLoading]);

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
