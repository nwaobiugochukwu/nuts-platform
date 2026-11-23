"use client";

import { SessionHydrator } from "@/components/domain/auth/SessionHydrator";
import { ThemeProvider } from "@/provider/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import { MaintenanceModeHost } from "@/components/domain/maintenance/MaintenanceModeHost";
import { NotificationStreamHost } from "@/hooks/use-notifications";
import { PushNotificationHost } from "@/components/domain/notification/PushNotificationHost";
import { NavigationHistoryTracker } from "./NavigationHistoryTracker";
import { type ReactNode, Suspense } from "react";
import { QueryProvider } from "./QueryProvider";

export function Provider({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <ThemeProvider>
        <SessionHydrator>
          <Suspense fallback={null}>
            <NavigationHistoryTracker />
          </Suspense>
          <NotificationStreamHost />
          <PushNotificationHost />
          <MaintenanceModeHost />
          {children}
        </SessionHydrator>
        <Toaster />
      </ThemeProvider>
    </QueryProvider>
  );
}
