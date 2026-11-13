import { create } from "zustand";

export type ThemeMode = "light" | "dark" | "system";

interface ThemeState {
  theme: ThemeMode;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: ThemeMode) => void;
  initTheme: () => void;
}

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyThemeToDOM(resolved: "light" | "dark") {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (resolved === "dark") {
    root.classList.add("dark");
    root.style.colorScheme = "dark";
  } else {
    root.classList.remove("dark");
    root.style.colorScheme = "light";
  }
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: "light",
  resolvedTheme: "light",

  setTheme: (newTheme: ThemeMode) => {
    const resolved = newTheme === "system" ? getSystemTheme() : newTheme;
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("nuts_theme", newTheme);
      } catch {
        // Ignore localStorage quota errors
      }
    }
    applyThemeToDOM(resolved);
    set({ theme: newTheme, resolvedTheme: resolved });
  },

  initTheme: () => {
    if (typeof window === "undefined") return;

    let savedTheme: ThemeMode = "light";
    try {
      const stored = localStorage.getItem("nuts_theme") as ThemeMode | null;
      if (stored && ["light", "dark", "system"].includes(stored)) {
        savedTheme = stored;
      }
    } catch {
      // Fallback
    }

    const resolved = savedTheme === "system" ? getSystemTheme() : savedTheme;
    applyThemeToDOM(resolved);
    set({ theme: savedTheme, resolvedTheme: resolved });

    // Listen to OS system theme changes if set to system
    try {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = (e: MediaQueryListEvent) => {
        if (get().theme === "system") {
          const sysResolved = e.matches ? "dark" : "light";
          applyThemeToDOM(sysResolved);
          set({ resolvedTheme: sysResolved });
        }
      };

      mediaQuery.addEventListener("change", handler);
    } catch {
      // Ignore
    }
  },
}));
