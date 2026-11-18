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
    root.classList.remove("light");
    root.style.colorScheme = "dark";
  } else {
    root.classList.remove("dark");
    root.classList.add("light");
    root.style.colorScheme = "light";
  }
}

function syncCookie(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  try {
    document.cookie = `nuts_theme=${encodeURIComponent(mode)}; path=/; max-age=31536000; SameSite=Lax`;
  } catch {
    // Ignore cookie errors
  }
}

function getInitialTheme(): { theme: ThemeMode; resolvedTheme: "light" | "dark" } {
  if (typeof window === "undefined") {
    return { theme: "system", resolvedTheme: "light" };
  }
  let savedTheme: ThemeMode = "system";
  try {
    const stored = localStorage.getItem("nuts_theme") as ThemeMode | null;
    if (stored && ["light", "dark", "system"].includes(stored)) {
      savedTheme = stored;
    }
  } catch {
    // Fallback
  }

  const isDark =
    document.documentElement.classList.contains("dark") ||
    savedTheme === "dark" ||
    (savedTheme === "system" && getSystemTheme() === "dark");

  return {
    theme: savedTheme,
    resolvedTheme: isDark ? "dark" : "light",
  };
}

const initial = getInitialTheme();

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: initial.theme,
  resolvedTheme: initial.resolvedTheme,

  setTheme: (newTheme: ThemeMode) => {
    const resolved = newTheme === "system" ? getSystemTheme() : newTheme;
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("nuts_theme", newTheme);
      } catch {
        // Ignore localStorage quota errors
      }
      syncCookie(newTheme);
    }
    applyThemeToDOM(resolved);
    set({ theme: newTheme, resolvedTheme: resolved });
  },

  initTheme: () => {
    if (typeof window === "undefined") return;

    let savedTheme: ThemeMode = "system";
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
    syncCookie(savedTheme);
    set({ theme: savedTheme, resolvedTheme: resolved });

    // Listen to OS system theme changes if set to system
    try {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = (e: MediaQueryListEvent | MediaQueryList) => {
        if (get().theme === "system") {
          const sysResolved = e.matches ? "dark" : "light";
          applyThemeToDOM(sysResolved);
          set({ resolvedTheme: sysResolved });
        }
      };

      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener("change", handler);
      } else if ("addListener" in mediaQuery) {
        // Legacy Safari/WebKit
        (mediaQuery as unknown as { addListener: (cb: typeof handler) => void }).addListener(handler);
      }
    } catch {
      // Ignore
    }
  },
}));
