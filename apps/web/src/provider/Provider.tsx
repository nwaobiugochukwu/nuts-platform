"use client";

import { SessionHydrator } from "@/component/auth/SessionHydrator";
import { ThemeProvider } from "@/component/provider/ThemeProvider";
import { Toaster } from "@/component/ui/sonner";
import { MaintenanceModeHost } from "@/components/maintenance/MaintenanceModeHost";
import { NotificationStreamHost } from "@/hooks/use-notifications";
import { PushNotificationHost } from "@/hooks/use-push-notifications";
import { type ReactNode } from "react";
import { QueryProvider } from "./QueryProvider";

export function Provider({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <ThemeProvider>
        <SessionHydrator>
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
