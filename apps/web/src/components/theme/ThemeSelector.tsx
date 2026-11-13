"use client";

import { useThemeStore,type ThemeMode } from "@/zustand/theme";
import { Check,Laptop,Moon,Sun } from "lucide-react";

interface ThemeSelectorProps {
  className?: string;
  showTitle?: boolean;
}

export function ThemeSelector({ className = "", showTitle = true }: ThemeSelectorProps) {
  const { theme, setTheme } = useThemeStore();

  const options: { mode: ThemeMode; label: string; description: string; icon: typeof Sun }[] = [
    {
      mode: "light",
      label: "Light Mode",
      description: "Clean luxury porcelain white aesthetics",
      icon: Sun,
    },
    {
      mode: "dark",
      label: "Dark Mode",
      description: "Sleek obsidian black with reduced eye strain",
      icon: Moon,
    },
    {
      mode: "system",
      label: "System Match",
      description: "Automatically synchronizes with your device settings",
      icon: Laptop,
    },
  ];

  return (
    <div className={`space-y-4 ${className}`}>
      {showTitle && (
        <div>
          <h4 className="text-sm font-bold text-foreground">Interface Appearance</h4>
          <p className="text-xs text-muted-foreground">
            Select your preferred display theme across the application.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {options.map((opt) => {
          const Icon = opt.icon;
          const isSelected = theme === opt.mode;

          return (
            <button
              key={opt.mode}
              type="button"
              onClick={() => setTheme(opt.mode)}
              className={`relative flex flex-col items-start p-4 rounded-2xl border text-left transition-all duration-200 ${
                isSelected
                  ? "border-neutral-900 bg-neutral-50/80 dark:border-white dark:bg-neutral-800/80 shadow-xs ring-1 ring-neutral-900 dark:ring-white"
                  : "border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700 bg-white dark:bg-neutral-900"
              }`}
            >
              <div className="flex items-center justify-between w-full mb-3">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${
                    isSelected
                      ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-950"
                      : "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </div>
                {isSelected && (
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-neutral-900 text-white dark:bg-white dark:text-neutral-950">
                    <Check className="h-3 w-3 stroke-[2.5]" />
                  </div>
                )}
              </div>

              <span className="text-sm font-semibold text-foreground">{opt.label}</span>
              <span className="text-xs text-muted-foreground mt-0.5 leading-snug">
                {opt.description}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
