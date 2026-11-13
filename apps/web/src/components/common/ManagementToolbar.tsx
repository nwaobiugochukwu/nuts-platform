"use client";

import { Button } from "@/component/ui/button";
import { Input } from "@/component/ui/input";
import { cn } from "@/lib/util";
import { RefreshCw,Search,X } from "lucide-react";
import { type ReactNode } from "react";

export type ManagementFilter = { value: string; label: string };

export function ManagementToolbar({
  value,
  onChange,
  placeholder = "Search…",
  filterValue,
  onFilterChange,
  filters = [],
  filterPlaceholder = "All statuses",
  secondaryFilterValue,
  onSecondaryFilterChange,
  secondaryFilters = [],
  secondaryFilterPlaceholder = "All categories",
  onRefresh,
  isLoading,
  actions,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  filterValue?: string;
  onFilterChange?: (value: string) => void;
  filters?: ManagementFilter[];
  filterPlaceholder?: string;
  secondaryFilterValue?: string;
  onSecondaryFilterChange?: (value: string) => void;
  secondaryFilters?: ManagementFilter[];
  secondaryFilterPlaceholder?: string;
  onRefresh?: () => void;
  isLoading?: boolean;
  actions?: ReactNode;
  className?: string;
}) {
  const hasActiveFilters = Boolean(value || filterValue || secondaryFilterValue);

  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between", className)}>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
        {/* Search input with icons */}
        <div className="relative min-w-0 w-full flex-1 max-w-md sm:min-w-[240px]">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
          <Input
            id="management-search-input"
            name="managementSearch"
            aria-label={placeholder}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            className="h-10 w-full pl-9 pr-9 rounded-xl bg-card border-border/80 text-xs shadow-2xs focus-visible:ring-1 focus-visible:ring-primary"
          />
          {value && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onChange("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Primary Filter */}
        {onFilterChange && filters.length > 0 && (
          <div className="relative w-full min-w-0 sm:w-auto">
            <select
              id="management-filter-select"
              name="filter"
              aria-label={filterPlaceholder}
              value={filterValue ?? ""}
              onChange={(event) => onFilterChange(event.target.value)}
              className="h-10 w-full rounded-xl border border-border/80 bg-card px-3 text-xs font-medium text-foreground shadow-2xs focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer hover:bg-secondary/40 transition-colors sm:w-auto"
            >
              <option value="">{filterPlaceholder}</option>
              {filters.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Secondary Filter (optional) */}
        {onSecondaryFilterChange && secondaryFilters.length > 0 && (
          <div className="relative w-full min-w-0 sm:w-auto">
            <select
              id="management-secondary-filter-select"
              name="secondaryFilter"
              aria-label={secondaryFilterPlaceholder}
              value={secondaryFilterValue ?? ""}
              onChange={(event) => onSecondaryFilterChange(event.target.value)}
              className="h-10 w-full rounded-xl border border-border/80 bg-card px-3 text-xs font-medium text-foreground shadow-2xs focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer hover:bg-secondary/40 transition-colors sm:w-auto"
            >
              <option value="">{secondaryFilterPlaceholder}</option>
              {secondaryFilters.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Clear all filters button */}
        {hasActiveFilters && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange("");
              onFilterChange?.("");
              onSecondaryFilterChange?.("");
            }}
            className="h-10 rounded-xl px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Reset
          </Button>
        )}
      </div>

      {/* Right Actions */}
      <div className="flex w-full items-center justify-end gap-2 sm:w-auto sm:self-center">
        {onRefresh && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isLoading}
            className="h-10 w-10 p-0 rounded-xl border-border/80 bg-card hover:bg-secondary"
            title="Refresh Data"
          >
            <RefreshCw className={cn("h-3.5 w-3.5 text-muted-foreground", isLoading && "animate-spin text-primary")} />
          </Button>
        )}
        {actions}
      </div>
    </div>
  );
}
