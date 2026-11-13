"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  notificationsApiForRole,
  type NotificationPreferences,
  type UpdateNotificationPreferencesDto,
} from "@/api/notifications";
import { useAuthStore, normalizeRole } from "@/zustand/auth";
import { queryKey } from "@/lib/query-key";
import { toast } from "sonner";

export function useNotificationPreferences() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const role = useAuthStore((s) => s.role);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const activeRole = normalizeRole(role ?? user?.role) ?? "user";
  const userId = user?.id ?? "me";

  const {
    data: preferences = null,
    isLoading,
    refetch,
  } = useQuery<NotificationPreferences | null>({
    queryKey: queryKey.notification.preferences(userId),
    queryFn: async () => {
      const api = notificationsApiForRole(activeRole);
      const res = await api.getPreferences();
      return res.data ?? null;
    },
    enabled: Boolean(isAuthenticated),
    staleTime: 1000 * 60 * 5, // 5 minutes fresh
    gcTime: 1000 * 60 * 15,
  });

  const mutation = useMutation({
    mutationFn: async (updates: UpdateNotificationPreferencesDto) => {
      const api = notificationsApiForRole(activeRole);
      const res = await api.updatePreferences(updates);
      return res.data;
    },
    onMutate: async (updates) => {
      await qc.cancelQueries({ queryKey: queryKey.notification.preferences(userId) });
      const previous = qc.getQueryData<NotificationPreferences | null>(
        queryKey.notification.preferences(userId),
      );
      if (previous) {
        qc.setQueryData<NotificationPreferences>(
          queryKey.notification.preferences(userId),
          { ...previous, ...updates },
        );
      }
      return { previous };
    },
    onSuccess: (data) => {
      if (data) {
        qc.setQueryData(queryKey.notification.preferences(userId), data);
      }
      toast.success("Notification preferences updated");
    },
    onError: (err: unknown, _updates, context) => {
      if (context?.previous) {
        qc.setQueryData(queryKey.notification.preferences(userId), context.previous);
      }
      const msg = err instanceof Error ? err.message : "Failed updating preferences";
      toast.error(msg);
    },
  });

  return {
    preferences,
    isLoading,
    isUpdating: mutation.isPending,
    fetchPreferences: refetch,
    updatePreferences: mutation.mutate,
  };
}
