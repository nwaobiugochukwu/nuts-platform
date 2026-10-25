import { notificationsApiForRole } from "@/api/notifications";
import { getAuthToken } from "@/api/core/token-storage";
import { performTokenRefresh } from "@/api/core/client";
import type { AppNotification, ListNotificationsParams } from "@/api/notifications";
import { useAuthStore, type AuthRole, normalizeRole } from "@/zustand/auth";
import { notificationDetailPath } from "@/lib/notification-path";
import {
  shouldRetryNotificationHttpStatus,
  shouldRetryNotificationStream,
} from "@/lib/notification-stream-policy";
import { create } from "zustand";
import { toast } from "sonner";
import { getQueryClient } from "@/lib/query-client";
import { queryKey } from "@/lib/query-key";
import type { NotificationPreferences } from "@/api/notifications";

interface NotificationsState {
  notifications: AppNotification[];
  unreadCount: number;
  isLoading: boolean;
  sseConnected: boolean;
  sseRetryExhausted: boolean;
  hasNextPage: boolean;
  nextCursor: string | null;

  fetchNotifications: (
    cursor?: string,
    limit?: number,
    append?: boolean,
    filters?: Pick<ListNotificationsParams, "unreadOnly" | "category" | "type">,
  ) => Promise<void>;
  fetchUnreadCount: (force?: boolean) => Promise<void>;
  markAsRead: (id: string, unreadHint?: boolean) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteNotification: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
  addNotification: (notification: AppNotification) => boolean;
  reset: () => void;
  initStream: (role: AuthRole, sessionKey: string) => () => void;
  retryStream: () => void;
}

let globalStreamController: AbortController | null = null;
let globalStreamKey: string | null = null;
let globalStreamRole: AuthRole | null = null;
let streamRefCount = 0;
let streamGeneration = 0;
let listRequestSequence = 0;
let listRequestController: AbortController | null = null;
const unreadCountCache = new Map<string, number>();
const unreadCountRequests = new Map<string, Promise<void>>();
const receivedNotificationIds = new Set<string>();
const SSE_CONNECT_TIMEOUT_MS = 30_000;

function startNotificationStream(
  role: AuthRole,
  sessionKey: string,
  set: (state: Partial<NotificationsState>) => void,
  get: () => NotificationsState,
): void {
  globalStreamKey = sessionKey;
  globalStreamRole = role;
  const controller = new AbortController();
  globalStreamController = controller;
  const generation = ++streamGeneration;
  const isCurrent = () =>
    globalStreamController === controller &&
    globalStreamKey === sessionKey &&
    streamGeneration === generation;

  set({ sseConnected: false, sseRetryExhausted: false });
  void consumeNotificationStream(
    role,
    controller.signal,
    isCurrent,
    get,
    (notification) => {
      if (get().addNotification(notification)) {
        showIncomingNotification(notification);
      }
    },
    (connected) => {
      if (isCurrent()) {
        set({
          sseConnected: connected,
          ...(connected ? { sseRetryExhausted: false } : {}),
        });
        if (connected) {
          void get().fetchUnreadCount(false);
        }
      }
    },
    () => {
      if (isCurrent()) {
        set({ sseConnected: false, sseRetryExhausted: true });
      }
    },
  );
}

export function getActiveNotificationRole(): AuthRole {
  const auth = useAuthStore.getState();
  const rawRole = auth.role ?? auth.user?.role;
  return normalizeRole(rawRole) ?? "user";
}

function getNotificationSessionKey(): string {
  const auth = useAuthStore.getState();
  const role = getActiveNotificationRole();
  return `${role}:${auth.user?.id ?? ""}`;
}

function showIncomingNotification(notification: AppNotification): void {
  const role = getActiveNotificationRole();
  const auth = useAuthStore.getState();
  const userId = auth.user?.id ?? "me";

  // Real-time synchronization: Invalidate order queries when order or payment notifications arrive
  try {
    const qc = getQueryClient();
    const orderEvents: AppNotification["type"][] = [
      "ORDER_PLACED",
      "ORDER_CONFIRMED",
      "ORDER_SHIPPED",
      "ORDER_DELIVERED",
      "ORDER_CANCELLED",
      "PAYMENT_RECEIVED",
      "PAYMENT_FAILED",
    ];
    if (orderEvents.includes(notification.type)) {
      void qc.invalidateQueries({ queryKey: queryKey.order.all });
      const rawOrderId = notification.metadata?.orderId;
      if (typeof rawOrderId === "string" && rawOrderId) {
        void qc.invalidateQueries({ queryKey: queryKey.order.detail(rawOrderId) });
      }
    }
  } catch {
    // If query client cache is unavailable, ignore
  }

  let inAppEnabled = true;
  let pushEnabled = true;

  try {
    const qc = getQueryClient();
    const prefs = qc.getQueryData<NotificationPreferences>(
      queryKey.notification.preferences(userId),
    );
    if (prefs) {
      if (prefs.inAppEnabled === false) inAppEnabled = false;
      if (prefs.pushEnabled === false) pushEnabled = false;
    }
  } catch {
    // If cache lookup unavailable, use defaults
  }

  if (inAppEnabled) {
    toast(notification.title, {
      description: notification.message,
      action: {
        label: "View notifications",
        onClick: () =>
          window.location.assign(notificationDetailPath(role, notification.id)),
      },
    });
  }

  if (
    pushEnabled &&
    typeof window !== "undefined" &&
    "Notification" in window &&
    Notification.permission === "granted"
  ) {
    try {
      const desktopNotif = new Notification(notification.title || "NUTS Notification", {
        body: notification.message,
        icon: "/favicon.svg",
        tag: notification.id,
      });
      desktopNotif.onclick = () => {
        window.focus();
        window.location.assign(notificationDetailPath(role, notification.id));
      };
    } catch {
      // ignore
    }
  }
}

function notificationsApiForCurrentRole() {
  return notificationsApiForRole(getActiveNotificationRole());
}

function getSseUrl(role: AuthRole): string {
  const normalized = (role ? String(role).toLowerCase() : "user") as AuthRole;
  const routeByRole: Record<AuthRole, string> = {
    user: "notifications/sse/stream",
    admin: "admin/notifications/sse/stream",
    vendor: "vendors/notifications/sse/stream",
  };
  const targetRoute = routeByRole[normalized] || routeByRole.user;
  const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "/api/v1").replace(/\/+$/, "");
  const backend = process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/+$/, "") || "";

  if (typeof window !== "undefined") {
    // 1. Direct absolute API URL
    if (apiUrl.startsWith("http")) {
      return `${apiUrl}/${targetRoute}`;
    }
    // 2. Direct origin connection when backend URL is configured (Render/Cloud staging/production)
    // Bypasses Next.js node-proxy rewrites which drop or buffer long-lived SSE streams.
    if (backend.startsWith("http")) {
      const cleanPrefix = apiUrl.startsWith("/") ? apiUrl : `/${apiUrl}`;
      return `${backend}${cleanPrefix}/${targetRoute}`;
    }
    // 3. Fallback to same-origin relative path for local dev setups
    return `${apiUrl.startsWith("/") ? apiUrl : `/${apiUrl}`}/${targetRoute}`;
  }

  const base = apiUrl.startsWith("http")
    ? apiUrl
    : backend
      ? `${backend}${apiUrl.startsWith("/") ? apiUrl : `/${apiUrl}`}`
      : apiUrl;

  return `${base}/${targetRoute}`;
}

function waitForRetry(delay: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, delay);
    const cancel = () => {
      window.clearTimeout(timeout);
      signal.removeEventListener("abort", cancel);
      resolve();
    };
    signal.addEventListener("abort", cancel, { once: true });
  });
}

function getStreamRetryDelay(attempt: number): number {
  const backoff = Math.min(1000 * 2 ** Math.min(attempt, 6), 60_000);
  return Math.min(Math.round(backoff * (0.8 + Math.random() * 0.4)), 60_000);
}

function parseSseFrame(
  frame: string,
  onData: (data: string, id?: string) => void,
): void {
  let id: string | undefined;
  const dataLines: string[] = [];
  for (const line of frame.split(/\r\n|\r|\n/)) {
    if (line.startsWith("id:")) {
      id = line.slice(3).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  }
  const data = dataLines.join("\n");
  if (data) onData(data, id);
}

async function readSseResponse(
  response: Response,
  signal: AbortSignal,
  onData: (data: string, id?: string) => void,
): Promise<void> {
  if (!response.body) throw new Error("SSE response has no readable body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let separator: RegExpExecArray | null;
      while ((separator = /(?:\r\n|\r|\n){2}/.exec(buffer)) !== null) {
        parseSseFrame(buffer.slice(0, separator.index), onData);
        buffer = buffer.slice(separator.index + separator[0].length);
      }
    }
    if (buffer.trim()) parseSseFrame(buffer, onData);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

async function consumeNotificationStream(
  role: AuthRole,
  signal: AbortSignal,
  isCurrent: () => boolean,
  get: () => NotificationsState,
  onNotification: (notification: AppNotification) => void,
  onConnectionChange: (connected: boolean) => void,
  onRetryExhausted: () => void,
): Promise<void> {
  const url = getSseUrl(role);
  let retryAttempt = 0;
  let refreshedAfterUnauthorized = false;
  let lastSeenEventId: string | null = null;

  const retryAfterFailure = async (reason: string): Promise<boolean> => {
    retryAttempt++;
    onConnectionChange(false);
    if (!shouldRetryNotificationStream(retryAttempt)) {
      console.warn(
        `Notification stream paused after ${retryAttempt} consecutive connection attempts: ${reason}. Will reconnect automatically when online.`,
      );
      onRetryExhausted();
      return false;
    }
    await waitForRetry(getStreamRetryDelay(retryAttempt), signal);
    return !signal.aborted && isCurrent();
  };

  while (!signal.aborted && isCurrent()) {
    const headers = new Headers({ Accept: "text/event-stream" });
    const latestEventId = lastSeenEventId || get().notifications[0]?.id;
    if (latestEventId) {
      headers.set("Last-Event-ID", latestEventId);
    }

    let token = getAuthToken(role);
    if (!token && typeof window !== "undefined") {
      const refresh = await performTokenRefresh(role);
      if (refresh.success && refresh.accessToken) {
        token = refresh.accessToken;
      }
    }
    if (token) headers.set("Authorization", `Bearer ${token}`);

    let response: Response;
    let connectTimedOut = false;
    const connectController = new AbortController();
    const abortConnect = () => connectController.abort();
    signal.addEventListener("abort", abortConnect, { once: true });
    const connectTimeout = window.setTimeout(() => {
      connectTimedOut = true;
      connectController.abort();
    }, SSE_CONNECT_TIMEOUT_MS);
    try {
      response = await fetch(url, {
        method: "GET",
        headers,
        credentials: "include",
        cache: "no-store",
        signal: connectController.signal,
      });
    } catch (error) {
      window.clearTimeout(connectTimeout);
      signal.removeEventListener("abort", abortConnect);
      if (signal.aborted) return;
      const reason = connectTimedOut
        ? "connection timed out"
        : error instanceof Error
          ? error.message
          : "network request failed";
      if (connectTimedOut) {
        console.warn(
          `Notification stream timed out after a ${SSE_CONNECT_TIMEOUT_MS / 1000}s connection timeout; retrying with backoff...`,
        );
        if (!(await retryAfterFailure("connection timed out"))) return;
        continue;
      }
      if (!(await retryAfterFailure(reason))) return;
      continue;
    }
    window.clearTimeout(connectTimeout);
    signal.removeEventListener("abort", abortConnect);

    if (response.status === 401 && !refreshedAfterUnauthorized) {
      await response.body?.cancel().catch(() => undefined);
      refreshedAfterUnauthorized = true;
      const refresh = await performTokenRefresh(role);
      if (refresh.success) continue;
      if (refresh.reason === "unavailable") {
        refreshedAfterUnauthorized = false;
        if (!(await retryAfterFailure("authentication service unavailable"))) return;
        continue;
      }
      console.error("Notification stream unauthorized; session refresh failed");
      onConnectionChange(false);
      onRetryExhausted();
      return;
    }

    if ([401, 403, 404].includes(response.status)) {
      console.error(
        `Notification stream stopped with HTTP ${response.status}; check the session and deployed API route`,
      );
      onConnectionChange(false);
      onRetryExhausted();
      return;
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 502) {
        console.warn(
          "Notification stream received HTTP 502; retrying with backoff...",
        );
        if (!(await retryAfterFailure("HTTP 502"))) return;
        continue;
      }
      if (shouldRetryNotificationHttpStatus(response.status)) {
        if (!(await retryAfterFailure(`HTTP ${response.status}`))) return;
        continue;
      }
      console.error(`Notification stream stopped with HTTP ${response.status}`);
      onConnectionChange(false);
      onRetryExhausted();
      return;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream")) {
      console.error("Notification stream returned an unexpected content type", contentType);
      onConnectionChange(false);
      onRetryExhausted();
      return;
    }

    refreshedAfterUnauthorized = false;
    onConnectionChange(true);
    const connectedAt = Date.now();
    try {
      await readSseResponse(response, signal, (data, eventId) => {
        try {
          const parsed: unknown = JSON.parse(data);
          if (!parsed || typeof parsed !== "object") return;
          const value = parsed as Record<string, unknown>;

          // Heartbeat ping and connection handshake frames have no notification body
          if (value.type === "ping" || value.type === "connected") return;

          const notification = (value.notification ?? value) as Partial<AppNotification> & {
            link?: string | null;
          };
          if (typeof notification.id !== "string") return;

          if (eventId) {
            lastSeenEventId = eventId;
          } else if (notification.id) {
            lastSeenEventId = notification.id;
          }

          onNotification({
            ...notification,
            actionUrl: notification.actionUrl ?? notification.link ?? null,
          } as AppNotification);
        } catch {
          console.warn("Ignoring malformed notification stream event");
        }
      });
    } catch (error) {
      if (signal.aborted) return;
      const reason = error instanceof Error ? error.message : "stream closed unexpectedly";
      if (!(await retryAfterFailure(reason))) return;
      continue;
    }

    onConnectionChange(false);
    retryAttempt = Date.now() - connectedAt >= 30_000 ? 0 : retryAttempt + 1;
    if (!shouldRetryNotificationStream(retryAttempt)) {
      console.error(
        `Notification stream stopped after ${retryAttempt} consecutive failures: connection closed`,
      );
      onRetryExhausted();
      return;
    }
    await waitForRetry(getStreamRetryDelay(retryAttempt), signal);
  }
}

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  isLoading: false,
  sseConnected: false,
  sseRetryExhausted: false,
  hasNextPage: false,
  nextCursor: null,

  fetchNotifications: async (cursor, limit = 20, append = false, filters) => {
    const auth = useAuthStore.getState();
    const userId = auth.user?.id;
    if (!auth.isAuthenticated || !userId) return;

    const activeRole = getActiveNotificationRole();
    const cacheKey = `${activeRole}:${userId}`;
    if (!append) {
      listRequestController?.abort();
      listRequestController = new AbortController();
    }
    const requestController = listRequestController;
    const requestSequence = append ? listRequestSequence : ++listRequestSequence;
    set({ isLoading: true });
    try {
      const res = await notificationsApiForRole(activeRole).list(
        { cursor, limit, ...filters },
        requestController?.signal,
      );
      const items = res.data ?? [];
      const meta = res.meta;
      const activeAuth = useAuthStore.getState();
      const activeUserId = activeAuth.user?.id;
      const activeCacheKey = activeUserId
        ? `${getActiveNotificationRole()}:${activeUserId}`
        : null;

      if (activeCacheKey === cacheKey && requestSequence === listRequestSequence) {
        set({
          notifications: append
            ? [
                ...get().notifications,
                ...items.filter(
                  (item) => !get().notifications.some((existing) => existing.id === item.id),
                ),
              ]
            : items,
          hasNextPage: meta?.hasNextPage ?? false,
          nextCursor: meta?.nextCursor ?? null,
        });
      }
    } catch (error) {
      if (
        requestSequence === listRequestSequence &&
        !(error instanceof Error && (error.name === "CanceledError" || error.name === "AbortError"))
      ) {
        console.warn("Failed to load notifications in background", error);
      }
    } finally {
      const activeAuth = useAuthStore.getState();
      const activeUserId = activeAuth.user?.id;
      const activeCacheKey = activeUserId
        ? `${getActiveNotificationRole()}:${activeUserId}`
        : null;
      if (
        activeCacheKey === cacheKey &&
        requestSequence === listRequestSequence
      ) {
        set({ isLoading: false });
      }
    }
  },

  fetchUnreadCount: async (force = false) => {
    const auth = useAuthStore.getState();
    const userId = auth.user?.id;
    if (!auth.isAuthenticated || !userId) return;

    const activeRole = getActiveNotificationRole();
    const cacheKey = `${activeRole}:${userId}`;
    const fetchedAt = unreadCountCache.get(cacheKey) ?? 0;
    const elapsed = Date.now() - fetchedAt;
    if (!force && elapsed < 60_000) return;
    if (force && elapsed < 5_000) return;

    const pending = unreadCountRequests.get(cacheKey);
    if (pending) return pending;

    const request = (async () => {
      try {
        const res = await notificationsApiForRole(activeRole).getUnreadCount();
        if (res.data) {
          const activeAuth = useAuthStore.getState();
          const activeUserId = activeAuth.user?.id;
          const activeCacheKey = activeUserId
            ? `${getActiveNotificationRole()}:${activeUserId}`
            : null;
          if (activeCacheKey === cacheKey) {
            set({ unreadCount: res.data.count || 0 });
            unreadCountCache.set(cacheKey, Date.now());
          }
        }
      } catch (error) {
        console.error("Failed to load notification unread count", error);
      }
    })();

    unreadCountRequests.set(cacheKey, request);
    try {
      await request;
    } finally {
      if (unreadCountRequests.get(cacheKey) === request) {
        unreadCountRequests.delete(cacheKey);
      }
    }
  },

  markAsRead: async (id: string, unreadHint = false) => {
    const prevList = get().notifications;
    const prevCount = get().unreadCount;
    const wasUnread =
      prevList.some((notification) => notification.id === id && !notification.isRead) ||
      unreadHint;

    // Optimistic update
    set({
      notifications: prevList.map((n) =>
        n.id === id ? { ...n, isRead: true, readAt: new Date().toISOString() } : n
      ),
      unreadCount: wasUnread ? Math.max(0, prevCount - 1) : prevCount,
    });

    try {
      await notificationsApiForCurrentRole().markAsRead(id);
    } catch {
      // Rollback on failure
      set({ notifications: prevList, unreadCount: prevCount });
    }
  },

  markAllAsRead: async () => {
    const prevList = get().notifications;
    const prevCount = get().unreadCount;

    set({
      notifications: prevList.map((n) => ({
        ...n,
        isRead: true,
        readAt: new Date().toISOString(),
      })),
      unreadCount: 0,
    });

    try {
      await notificationsApiForCurrentRole().markAllAsRead();
    } catch {
      set({ notifications: prevList, unreadCount: prevCount });
    }
  },

  deleteNotification: async (id: string) => {
    const target = get().notifications.find((n) => n.id === id);
    const wasUnread = target && !target.isRead;

    set({
      notifications: get().notifications.filter((n) => n.id !== id),
      unreadCount: wasUnread ? Math.max(0, get().unreadCount - 1) : get().unreadCount,
    });

    try {
      await notificationsApiForCurrentRole().delete(id);
    } catch {
      get().fetchNotifications();
    }
  },

  clearAll: async () => {
    try {
      await notificationsApiForCurrentRole().clearAll();
      set({
        notifications: get().notifications.filter((n) => !n.isRead),
      });
    } catch {
      get().fetchNotifications();
    }
  },

  addNotification: (notification: AppNotification) => {
    let isNew = false;
    set((state) => {
      const existing = state.notifications.find((item) => item.id === notification.id);
      const wasUnread = existing ? !existing.isRead : false;
      const isUnread = !notification.isRead;
      isNew = !receivedNotificationIds.has(notification.id);
      receivedNotificationIds.add(notification.id);
      if (receivedNotificationIds.size > 500) {
        const oldestId = receivedNotificationIds.values().next().value;
        if (oldestId) receivedNotificationIds.delete(oldestId);
      }

      return {
        notifications: [
          notification,
          ...state.notifications.filter((item) => item.id !== notification.id),
        ],
        unreadCount: Math.max(
          0,
          state.unreadCount +
            (existing
              ? Number(isUnread) - Number(wasUnread)
              : Number(isUnread && isNew)),
        ),
      };
    });

    if (isNew) {
      unreadCountCache.delete(getNotificationSessionKey());
    }
    return isNew;
  },

  reset: () =>
    {
      listRequestSequence++;
      listRequestController?.abort();
      listRequestController = null;
      unreadCountCache.clear();
      unreadCountRequests.clear();
      receivedNotificationIds.clear();
      set({
        notifications: [],
        unreadCount: 0,
        isLoading: false,
        sseConnected: false,
        sseRetryExhausted: false,
        hasNextPage: false,
        nextCursor: null,
      });
    },

  initStream: (role, sessionKey) => {
    if (typeof window === "undefined") return () => {};

    if (globalStreamKey !== null && globalStreamKey !== sessionKey) {
      globalStreamController?.abort();
      globalStreamController = null;
      globalStreamKey = null;
      globalStreamRole = null;
      streamRefCount = 0;
      set({ sseConnected: false, sseRetryExhausted: false });
    }

    streamRefCount++;
    if (globalStreamController) {
      return createStreamCleanup(sessionKey, set);
    }

    startNotificationStream(role, sessionKey, set, get);

    return createStreamCleanup(sessionKey, set);
  },

  retryStream: () => {
    if (!globalStreamKey || !globalStreamRole || streamRefCount === 0) return;
    globalStreamController?.abort();
    globalStreamController = null;
    streamGeneration++;
    startNotificationStream(globalStreamRole, globalStreamKey, set, get);
  },
}));

function createStreamCleanup(
  sessionKey: string,
  set: (state: Partial<NotificationsState>) => void,
): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (globalStreamKey !== sessionKey) return;
    streamRefCount = Math.max(0, streamRefCount - 1);
    if (streamRefCount === 0) {
      globalStreamController?.abort();
      globalStreamController = null;
      globalStreamKey = null;
      globalStreamRole = null;
      streamGeneration++;
      set({ sseConnected: false, sseRetryExhausted: false });
    }
  };
}
