"use client";

import { applyThemeColorMeta } from "@/lib/theme-color";
import { useThemeStore } from "@/zustand/theme";
import { useEffect,type ReactNode } from "react";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const initTheme = useThemeStore((state) => state.initTheme);

  useEffect(() => {
    initTheme();

    // Next re-renders <head> metadata on navigation and can restore the OS-based
    // theme-color tags; put the chosen theme's colour back (idempotent, so no loop).
    const observer = new MutationObserver(() => {
      applyThemeColorMeta(useThemeStore.getState().resolvedTheme);
    });
    observer.observe(document.head, { childList: true });
    return () => observer.disconnect();
  }, [initTheme]);

  return <>{children}</>;
}
