"use client";

import { SessionHydrator } from "@/component/auth/SessionHydrator";
import { ThemeProvider } from "@/component/provider/ThemeProvider";
import { Toaster } from "@/component/ui/sonner";
import { NotificationStreamHost } from "@/hooks/use-notifications";
import { Suspense,type ReactNode } from "react";
import { QueryProvider } from "./QueryProvider";

export function Provider({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <ThemeProvider>
        <SessionHydrator>
          <NotificationStreamHost />
          {children}
        </SessionHydrator>
        <Suspense fallback={null}>
                  </Suspense>
        <Toaster />
      </ThemeProvider>
    </QueryProvider>
  );
}
