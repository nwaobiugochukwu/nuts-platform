"use client";

import { normalizeRole, useAuthStore } from "@/zustand/auth";
import { useNotificationsStore } from "@/zustand/notifications";
import { useEffect } from "react";

let activeSessionKey: string | null = null;

export function useNotifications() {
  const notifications = useNotificationsStore((s) => s.notifications);
  const unreadCount = useNotificationsStore((s) => s.unreadCount);
  const isLoading = useNotificationsStore((s) => s.isLoading);
  const sseConnected = useNotificationsStore((s) => s.sseConnected);
  const sseRetryExhausted = useNotificationsStore((s) => s.sseRetryExhausted);
  const hasNextPage = useNotificationsStore((s) => s.hasNextPage);
  const nextCursor = useNotificationsStore((s) => s.nextCursor);

  return {
    notifications,
    unreadCount,
    isLoading,
    sseConnected,
    sseRetryExhausted,
    hasNextPage,
    nextCursor,
    fetchNotifications: useNotificationsStore.getState().fetchNotifications,
    fetchUnreadCount: useNotificationsStore.getState().fetchUnreadCount,
    markAsRead: useNotificationsStore.getState().markAsRead,
    markAllAsRead: useNotificationsStore.getState().markAllAsRead,
    deleteNotification: useNotificationsStore.getState().deleteNotification,
    clearAll: useNotificationsStore.getState().clearAll,
    retryStream: useNotificationsStore.getState().retryStream,
  };
}

function useNotificationStreamLifecycle() {
  const user = useAuthStore((s) => s.user);
  const role = useAuthStore((s) => s.role);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const activeRole = normalizeRole(role ?? user?.role) ?? "user";
  const currentUserId = user?.id ?? null;
  const sessionKey =
    isAuthenticated && currentUserId
      ? `${activeRole}:${currentUserId}`
      : null;

  useEffect(() => {
    const store = useNotificationsStore.getState();
    if (!isAuthenticated || !sessionKey || !currentUserId) {
      if (
        activeSessionKey !== null ||
        store.notifications.length > 0 ||
        store.unreadCount > 0
      ) {
        activeSessionKey = null;
        store.reset();
      }
      return;
    }

    if (activeSessionKey !== sessionKey) {
      activeSessionKey = sessionKey;
      store.reset();
    }

    void store.fetchUnreadCount();
    const cleanupStream = store.initStream(activeRole, sessionKey);

    const handleReconnectionTrigger = () => {
      const currentStore = useNotificationsStore.getState();
      if (currentStore.sseRetryExhausted || !currentStore.sseConnected) {
        currentStore.retryStream();
      }
    };

    window.addEventListener("online", handleReconnectionTrigger);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        handleReconnectionTrigger();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("online", handleReconnectionTrigger);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      cleanupStream();
    };
  }, [activeRole, isAuthenticated, sessionKey, currentUserId]);
}

export function NotificationStreamHost() {
  useNotificationStreamLifecycle();
  return null;
}
