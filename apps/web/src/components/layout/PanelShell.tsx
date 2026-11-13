"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import Link from "@/components/navigation/AppLink";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/util";
import { ChevronRight, X } from "lucide-react";

export interface PanelNavigationItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
}

export interface PanelNavigationGroup {
  group: string;
  items: PanelNavigationItem[];
}

interface PanelShellProps {
  kind: "Admin" | "Vendor";
  subtitle: string;
  homeHref: string;
  navigationLabel: string;
  groups: PanelNavigationGroup[];
  header: (openNavigation: () => void, isNavigationOpen: boolean) => ReactNode;
  children: ReactNode;
}

export function PanelShell({
  kind,
  subtitle,
  homeHref,
  navigationLabel,
  groups,
  header,
  children,
}: PanelShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!mobileOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileOpen]);

  const closeNavigation = () => setMobileOpen(false);

  return (
    <div className="flex min-h-svh min-w-0 bg-background font-sans text-foreground">
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation menu"
          onClick={closeNavigation}
          className="fixed inset-0 z-40 cursor-default bg-black/60 backdrop-blur-xs lg:hidden"
        />
      )}

      <aside
        id="panel-navigation"
        aria-label={`${kind} navigation`}
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[min(18rem,95vw)] flex-col border-r border-border bg-card text-card-foreground shadow-xl transition-transform duration-300 ease-in-out lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex min-h-[4.5rem] items-center justify-between border-b border-border px-5 sm:px-6">
          <Link href={homeHref} onClick={closeNavigation} className="group flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground shadow-xs transition-transform group-hover:scale-105">
              N
            </span>
            <span className="flex min-w-0 flex-col leading-none">
              <span className="flex items-center gap-1.5 text-sm font-bold tracking-tight text-foreground">
                NUTS <span className="rounded-md border border-border bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-foreground">{kind}</span>
              </span>
              <span className="mt-1 truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{subtitle}</span>
            </span>
          </Link>
          <button
            type="button"
            onClick={closeNavigation}
            aria-label="Close navigation menu"
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav aria-label={navigationLabel} className="flex-1 space-y-6 overflow-y-auto px-4 py-5">
          {groups.map((group) => (
            <section key={group.group} aria-label={group.group} className="space-y-1.5">
              <h2 className="px-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">{group.group}</h2>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={closeNavigation}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "group flex min-h-11 items-center justify-between rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
                          active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/80 hover:text-foreground",
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                          <span className="truncate">{item.label}</span>
                        </span>
                        <span className="flex items-center gap-1.5">
                          {item.badge && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">{item.badge}</span>}
                          <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", active ? "" : "opacity-0 group-hover:translate-x-0.5 group-hover:opacity-100")} aria-hidden="true" />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-[18rem]">
        {header(() => setMobileOpen(true), mobileOpen)}
        <main className="mx-auto min-w-0 w-full max-w-7xl flex-1 p-3 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
