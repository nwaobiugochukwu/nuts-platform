"use client";

import { usePathname } from "next/navigation";
import { useAuthStore } from "@/zustand/auth";
import { useMaintenanceModeStore } from "@/zustand/maintenance-mode";

export function MaintenanceModeHost() {
  const pathname = usePathname();
  const role = useAuthStore((state) => state.role);
  const active = useMaintenanceModeStore((state) => state.active);
  const message = useMaintenanceModeStore((state) => state.message);

  if (!active || role === "admin" || pathname?.startsWith("/admin")) return null;

  return (
    <main
      aria-labelledby="maintenance-title"
      aria-modal="true"
      className="fixed inset-0 z-[10000] flex min-h-dvh items-center justify-center overflow-y-auto bg-background px-5 py-10 text-foreground"
      role="dialog"
    >
      <section className="w-full max-w-xl rounded-3xl border border-border bg-card p-7 shadow-2xl sm:p-10">
        <div className="mb-7 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <svg
            aria-hidden="true"
            className="h-7 w-7"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="1.7"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M11.42 3.84a6.5 6.5 0 0 0 8.74 8.74l-8.9 8.9a2.75 2.75 0 0 1-3.89-3.89l8.9-8.9a6.5 6.5 0 0 0-8.74-8.74l3.27 3.27-3.18 3.18-3.27-3.27a6.5 6.5 0 0 0 7.07 7.07"
            />
          </svg>
        </div>
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-400">
          NUTS is taking a short break
        </p>
        <h1 id="maintenance-title" className="text-3xl font-bold tracking-tight sm:text-4xl">
          We&apos;ll be back soon
        </h1>
        <p
          aria-live="polite"
          className="mt-5 whitespace-pre-wrap text-base leading-7 text-muted-foreground"
        >
          {message}
        </p>
        <button
          className="mt-8 inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onClick={() => window.location.reload()}
          type="button"
        >
          Check again
        </button>
      </section>
    </main>
  );
}
