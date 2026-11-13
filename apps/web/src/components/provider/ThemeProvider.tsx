"use client";

import { useThemeStore } from "@/zustand/theme";
import { useEffect,type ReactNode } from "react";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const initTheme = useThemeStore((state) => state.initTheme);

  useEffect(() => {
    initTheme();
  }, [initTheme]);

  return <>{children}</>;
}
