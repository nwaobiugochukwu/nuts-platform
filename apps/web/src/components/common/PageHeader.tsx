"use client";

import { cn } from "@/lib/util";
import { Minus,TrendingDown,TrendingUp } from "lucide-react";
import { type ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn("flex min-h-[300px] flex-col items-center justify-center gap-4 text-center rounded-2xl border border-dashed border-border/80 bg-card/40 p-8 backdrop-blur-xs", className)}>
      {icon && (
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary/80 text-muted-foreground/70 shadow-xs border border-border/50">
          {icon}
        </div>
      )}
      <div className="space-y-1.5 max-w-sm">
        <h3 className="text-base sm:text-lg font-semibold tracking-tight text-foreground">{title}</h3>
        {description && (
          <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
        )}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  badge,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  badge?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between", className)}>
      <div className="space-y-1">
        <div className="flex items-center gap-2.5">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">{title}</h1>
          {badge}
        </div>
        {description && (
          <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">{description}</p>
        )}
      </div>
      {(action || children) && (
        <div className="flex flex-wrap items-center gap-2.5 sm:self-center">
          {action}
          {children}
        </div>
      )}
    </div>
  );
}

interface StatCardProps {
  title: string;
  value: string | number;
  change?: string | number;
  trendValue?: string | number;
  trend?: "up" | "down" | "neutral";
  subtitle?: string;
  icon?: ReactNode;
  colorScheme?: "default" | "emerald" | "amber" | "indigo" | "rose";
  className?: string;
}

export function StatCard({
  title,
  value,
  change,
  trendValue,
  trend = "neutral",
  subtitle,
  icon,
  colorScheme = "default",
  className,
}: StatCardProps) {
  const effectiveChange = change !== undefined ? change : trendValue;
  const isPositive = trend === "up" || (typeof effectiveChange === "number" && effectiveChange > 0);
  const isNegative = trend === "down" || (typeof effectiveChange === "number" && effectiveChange < 0);

  const schemeStyles = {
    default: "from-card to-card/90 border-border/80 text-foreground",
    emerald: "from-emerald-500/5 to-emerald-500/0 border-emerald-500/20 text-emerald-950 dark:text-emerald-50",
    amber: "from-amber-500/5 to-amber-500/0 border-amber-500/20 text-amber-950 dark:text-amber-50",
    indigo: "from-indigo-500/5 to-indigo-500/0 border-indigo-500/20 text-indigo-950 dark:text-indigo-50",
    rose: "from-rose-500/5 to-rose-500/0 border-rose-500/20 text-rose-950 dark:text-rose-50",
  };

  return (
    <div className={cn(
      "group relative overflow-hidden rounded-2xl border bg-gradient-to-b p-5 sm:p-6 shadow-xs transition-all duration-300 hover:shadow-md hover:border-foreground/20 hover:-translate-y-0.5 min-w-0",
      schemeStyles[colorScheme],
      className
    )}>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1.5 flex-1 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground truncate">{title}</p>
          <div className="flex items-baseline gap-2 min-w-0 py-0.5">
            <h2 className="text-xl sm:text-2xl lg:text-[26px] xl:text-[28px] font-extrabold tracking-tight text-foreground whitespace-normal break-words sm:break-normal">
              {value}
            </h2>
          </div>
          
          {(effectiveChange !== undefined || subtitle) && (
            <div className="flex items-center gap-1.5 pt-0.5">
              {effectiveChange !== undefined && (
                <span className={cn(
                  "inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-full",
                  isPositive && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                  isNegative && "bg-rose-500/10 text-rose-600 dark:text-rose-400",
                  !isPositive && !isNegative && "bg-secondary text-muted-foreground"
                )}>
                  {isPositive && <TrendingUp className="h-3 w-3" />}
                  {isNegative && <TrendingDown className="h-3 w-3" />}
                  {!isPositive && !isNegative && <Minus className="h-3 w-3" />}
                  {typeof effectiveChange === "number" ? `${effectiveChange > 0 ? "+" : ""}${effectiveChange}%` : effectiveChange}
                </span>
              )}
              {subtitle && (
                <span className="text-xs text-muted-foreground truncate">{subtitle}</span>
              )}
            </div>
          )}
        </div>

        {icon && (
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-secondary/80 text-foreground/80 shadow-xs border border-border/50 group-hover:scale-105 group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300">
            {icon}
          </div>
        )}
      </div>

      {/* Decorative accent blur in corner */}
      <div className="pointer-events-none absolute -right-6 -bottom-6 h-24 w-24 rounded-full bg-primary/5 blur-2xl transition-all group-hover:bg-primary/10" />
    </div>
  );
}
