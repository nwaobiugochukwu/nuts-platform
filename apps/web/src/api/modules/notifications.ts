import {
  adminApi,
  userApi,
  vendorApi,
} from "@/api/core/client";
import type { AuthRole } from "../core/token-storage";

export type NotificationType =
  | "ORDER_PLACED"
  | "ORDER_CONFIRMED"
  | "ORDER_SHIPPED"
  | "ORDER_DELIVERED"
  | "ORDER_CANCELLED"
  | "PAYMENT_RECEIVED"
  | "PAYMENT_FAILED"
  | "PAYMENT_REFUNDED"
  | "PAYOUT_PROCESSED"
  | "LOW_STOCK_ALERT"
  | "VENDOR_FOLLOWED"
  | "SYSTEM_ANNOUNCEMENT";

export type NotificationPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export interface AppNotification {
  id: string;
  userId: string;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  message: string;
  actionUrl?: string | null;
  metadata?: Record<string, unknown> | null;
  isRead: boolean;
  readAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListNotificationsParams {
  cursor?: string;
  limit?: number;
  unreadOnly?: boolean;
  type?: NotificationType;
  category?: "orders" | "payments";
}

import type { CursorPaginationMeta } from "../core/types";

export interface NotificationsListResponse {
  data: AppNotification[];
  meta: CursorPaginationMeta;
}

export interface NotificationPreferences {
  id: string;
  userId: string;
  role: string;
  emailEnabled: boolean;
  inAppEnabled: boolean;
  pushEnabled: boolean;
  orderUpdates: boolean;
  paymentAlerts: boolean;
  inventoryAlerts: boolean;
  socialUpdates: boolean;
  marketingPromos: boolean;
  createdAt: string;
  updatedAt: string;
}

export type UpdateNotificationPreferencesDto = Partial<
  Pick<
    NotificationPreferences,
    | "emailEnabled"
    | "inAppEnabled"
    | "pushEnabled"
    | "orderUpdates"
    | "paymentAlerts"
    | "inventoryAlerts"
    | "socialUpdates"
    | "marketingPromos"
  >
>;

export interface PushSubscriptionDto {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent?: string;
}

function createNotificationsApi(client: typeof userApi) {
  return {
    list(params?: ListNotificationsParams, signal?: AbortSignal) {
      const cleanParams: Record<string, unknown> = {};
      if (params?.cursor) cleanParams.cursor = params.cursor;
      if (params?.limit !== undefined && params?.limit !== null) cleanParams.limit = params.limit;
      if (params?.unreadOnly !== undefined && params?.unreadOnly !== null) cleanParams.unreadOnly = params.unreadOnly;
      if (params?.type) cleanParams.type = params.type;
      if (params?.category) cleanParams.category = params.category;

      return client.get<AppNotification[], CursorPaginationMeta>("/notifications", {
        params: cleanParams,
        signal,
      });
    },

    getById(id: string, signal?: AbortSignal) {
      return client.get<AppNotification>(`/notifications/${encodeURIComponent(id)}`, {
        signal,
      });
    },

    getUnreadCount() {
      return client.get<{ count: number }>("/notifications/unread-count");
    },

    markAsRead(id: string) {
      return client.patch<AppNotification>(`/notifications/${id}/read`);
    },

    markAllAsRead() {
      return client.patch<{ count: number; updated?: number }>("/notifications/mark-all-read");
    },

    delete(id: string) {
      return client.delete<void>(`/notifications/${id}`);
    },

    clearAll() {
      return client.delete<{ count: number }>("/notifications/clear-all");
    },

    getVapidKey() {
      return client.get<{ publicKey: string }>("/notifications/push/vapid-key");
    },

    getPushStatus(endpoint?: string) {
      return client.get<{ registered: boolean; pushEnabled: boolean }>("/notifications/push/status", {
        params: endpoint ? { endpoint } : undefined,
      });
    },

    subscribePush(dto: PushSubscriptionDto) {
      return client.post<{ id: string; endpoint: string }>("/notifications/push/subscribe", dto);
    },

    unsubscribePush(endpoint: string) {
      return client.post<{ success: boolean }>("/notifications/push/unsubscribe", { endpoint });
    },

    sendTestPush() {
      return client.post<{ delivered: number; message: string }>("/notifications/push/test");
    },

    getPreferences() {
      return client.get<NotificationPreferences>("/notifications/preferences");
    },

    updatePreferences(dto: UpdateNotificationPreferencesDto) {
      return client.patch<NotificationPreferences>("/notifications/preferences", dto);
    },
  };
}

export function notificationsApiForRole(role?: AuthRole | string | null) {
  const normalized = String(role || "").toLowerCase();
  switch (normalized) {
    case "admin":
      return createNotificationsApi(adminApi);
    case "vendor":
      return createNotificationsApi(vendorApi);
    case "user":
    default:
      return createNotificationsApi(userApi);
  }
}
