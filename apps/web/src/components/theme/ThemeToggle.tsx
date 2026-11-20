"use client";

import { useThemeStore } from "@/zustand/theme";
import { useHydrated } from "@/hooks/use-hydrated";
import { Laptop, Moon, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const isMounted = useHydrated();
  const { theme, resolvedTheme, setTheme } = useThemeStore();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };
    if (dropdownOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
    }
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [dropdownOpen]);

  const cycleTheme = () => {
    if (theme === "system") {
      setTheme("light");
    } else if (theme === "light") {
      setTheme("dark");
    } else {
      setTheme("system");
    }
  };

  const getActiveIcon = () => {
    if (!isMounted) {
      return <Laptop className="h-4 w-4" />;
    }
    if (theme === "system") {
      return resolvedTheme === "dark" ? (
        <Moon className="h-4 w-4 text-primary" />
      ) : (
        <Sun className="h-4 w-4 text-primary" />
      );
    }
    return theme === "dark" ? (
      <Moon className="h-4 w-4 text-primary" />
    ) : (
      <Sun className="h-4 w-4 text-primary" />
    );
  };

  const currentLabel = !isMounted
    ? "System"
    : theme === "system"
    ? `System (${resolvedTheme})`
    : theme === "dark"
    ? "Dark"
    : "Light";

  return (
    <div ref={containerRef} className={`relative inline-flex ${className}`}>
      <button
        type="button"
        onClick={cycleTheme}
        onContextMenu={(e) => {
          e.preventDefault();
          setDropdownOpen((prev) => !prev);
        }}
        aria-label={`Toggle display theme (Currently ${currentLabel})`}
        title={`Theme: ${currentLabel}. Click to switch theme, right-click for menu.`}
        className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-all duration-200 hover:bg-secondary hover:text-foreground active:scale-95 cursor-pointer"
      >
        {getActiveIcon()}
      </button>

      {dropdownOpen && (
        <div className="absolute right-0 top-full mt-2 w-44 overflow-hidden rounded-2xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl z-50 animate-in fade-in zoom-in-95 duration-150">
          <div className="px-2.5 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            Appearance
          </div>

          <button
            type="button"
            onClick={() => {
              setTheme("system");
              setDropdownOpen(false);
            }}
            className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-xs font-medium transition-colors ${
              theme === "system"
                ? "bg-secondary text-foreground font-semibold"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            }`}
          >
            <Laptop className="h-3.5 w-3.5" />
            <span>System Match</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setTheme("light");
              setDropdownOpen(false);
            }}
            className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-xs font-medium transition-colors ${
              theme === "light"
                ? "bg-secondary text-foreground font-semibold"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            }`}
          >
            <Sun className="h-3.5 w-3.5" />
            <span>Light Mode</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setTheme("dark");
              setDropdownOpen(false);
            }}
            className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-xs font-medium transition-colors ${
              theme === "dark"
                ? "bg-secondary text-foreground font-semibold"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            }`}
          >
            <Moon className="h-3.5 w-3.5" />
            <span>Dark Mode</span>
          </button>
        </div>
      )}
    </div>
  );
}
