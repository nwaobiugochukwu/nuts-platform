"use client";

import { useState, useEffect, useCallback } from "react";
import { notificationsApiForRole } from "@/api/notifications";
import { useAuthStore, normalizeRole } from "@/zustand/auth";
import { toast } from "sonner";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
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

  const [isSupported] = useState(() => {
    if (typeof window === "undefined") return false;
    return (
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window
    );
  });
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return "default";
    }
    return Notification.permission;
  });
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    if (!isSupported || !isAuthenticated) {
      queueMicrotask(() => {
        if (mounted) setIsSubscribed(false);
      });
      return () => {
        mounted = false;
      };
    }

    const syncDeviceState = async () => {
      try {
        const currentPermission = Notification.permission;
        setPermission(currentPermission);
        if (currentPermission !== "granted") {
          setIsSubscribed(false);
          return;
        }
        const registration = await navigator.serviceWorker.getRegistration("/");
        const subscription = await registration?.pushManager.getSubscription();
        if (!mounted || !subscription) {
          if (mounted) setIsSubscribed(false);
          return;
        }
        const api = notificationsApiForRole(activeRole);
        const status = await api.getPushStatus(subscription.endpoint);
        if (mounted) {
          setIsSubscribed(Boolean(status.data.registered && status.data.pushEnabled));
        }
      } catch {
        if (mounted) setIsSubscribed(false);
      } finally {
        if (mounted) setIsLoading(false);
      }
    };
    queueMicrotask(() => {
      if (!mounted) return;
      setIsLoading(true);
      void syncDeviceState();
    });

    return () => {
      mounted = false;
    };
  }, [isSupported, isAuthenticated, activeRole, user?.id]);

  const subscribe = useCallback(async () => {
    if (!isSupported || !isAuthenticated) return false;

    setIsLoading(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);

      if (perm !== "granted") {
        toast.error("Notification permission was denied in your browser settings");
        return false;
      }

      // Try background WebPush via Service Worker and PushManager
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const readyReg = await navigator.serviceWorker.ready;
      const api = notificationsApiForRole(activeRole);
      const vapidRes = await api.getVapidKey();
      const publicKey = vapidRes.data?.publicKey;
      if (!publicKey) throw new Error("Push notifications are not configured on the server");

      let subscription = await readyReg.pushManager.getSubscription();
      if (!subscription) {
        const applicationServerKey = urlBase64ToUint8Array(publicKey) as unknown as BufferSource;
        subscription = await readyReg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });
      }

      const p256dh = subscription.getKey("p256dh");
      const auth = subscription.getKey("auth");
      if (!p256dh || !auth) throw new Error("The browser returned an invalid push subscription");
      await api.subscribePush({
        endpoint: subscription.endpoint,
        keys: {
          p256dh: btoa(String.fromCharCode(...new Uint8Array(p256dh))),
          auth: btoa(String.fromCharCode(...new Uint8Array(auth))),
        },
        userAgent: navigator.userAgent,
      });
      await api.updatePreferences({ pushEnabled: true });
      setIsSubscribed(true);
      toast.success("Push notifications enabled on this device");
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to enable notifications";
      toast.error(msg);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, isAuthenticated, activeRole]);

  const unsubscribe = useCallback(async () => {
    if (!isSupported || !isAuthenticated) return false;

    setIsLoading(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();

      const api = notificationsApiForRole(activeRole);
      await api.updatePreferences({ pushEnabled: false });
      if (subscription) {
        await api.unsubscribePush(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setIsSubscribed(false);
      toast.success("Notifications disabled on this device");
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to disable notifications";
      toast.error(msg);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, isAuthenticated, activeRole]);

  const sendTestPush = useCallback(async () => {
    if (!isAuthenticated || !isSubscribed) return false;

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
  }, [isAuthenticated, isSubscribed, activeRole]);

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
