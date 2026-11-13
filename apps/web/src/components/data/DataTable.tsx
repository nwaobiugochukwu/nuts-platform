"use client";

import { Button } from "@/component/ui/button";
import { cn } from "@/lib/util";
import { ChevronLeft,ChevronRight,Inbox } from "lucide-react";
import { type ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: ReactNode;
  render?: (row: T, index: number) => ReactNode;
  className?: string;
  headerClassName?: string;
}

export interface DataTablePagination {
  page?: number;
  limit?: number;
  total?: number;
  totalItems?: number;
  totalPages?: number;
  onPageChange?: (newPage: number) => void;
  cursor?: string | null;
  nextCursor?: string | null;
  prevCursor?: string | null;
  hasNextPage?: boolean;
  hasPrevPage?: boolean;
  hasPreviousPage?: boolean;
  onNextPage?: () => void;
  onPrevPage?: () => void;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[] | { data: T[]; meta?: unknown } | null | undefined;
  keyField?: keyof T | string;
  isLoading?: boolean;
  isFetching?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
  pagination?: DataTablePagination;
  onRowClick?: (row: T) => void;
  className?: string;
}

export function DataTable<T extends object>({
  columns,
  data,
  keyField = "id",
  isLoading,
  isFetching,
  emptyMessage = "No records found matching your filters.",
  emptyIcon,
  pagination,
  onRowClick,
  className,
}: DataTableProps<T>) {
  const safeData: T[] = Array.isArray(data)
    ? data
    : data && typeof data === "object" && "data" in data && Array.isArray(data.data)
      ? data.data
      : [];

  if (isLoading) {
    return (
      <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xs">
        <div className="p-4 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 animate-pulse">
              <div className="h-10 w-10 rounded-xl bg-muted/70 shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-1/3 rounded bg-muted/80" />
                <div className="h-2.5 w-1/5 rounded bg-muted/50" />
              </div>
              <div className="h-7 w-20 rounded-lg bg-muted/60" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (safeData.length === 0) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-card/50 p-8 text-center backdrop-blur-xs">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-muted-foreground/60 shadow-xs mb-3 border border-border/40">
          {emptyIcon || <Inbox className="h-6 w-6" />}
        </div>
        <p className="text-base font-semibold text-foreground">{emptyMessage}</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
          Try adjusting your search criteria, clearing active filters, or check back later.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("relative overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xs transition-all", className)}>
      {isFetching && (
        <div className="absolute top-0 left-0 right-0 z-20 h-0.5 bg-primary/20 overflow-hidden">
          <div className="h-full bg-primary w-1/3 animate-[pulse_1s_infinite] transition-all" />
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm border-collapse">
          <thead>
            <tr className="border-b border-border/70 bg-muted/30 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn("py-3.5 px-4 font-semibold select-none", col.headerClassName, col.className)}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={cn("divide-y divide-border/50 transition-opacity duration-150", isFetching && "opacity-50 pointer-events-none")}>
            {safeData.map((row, i) => {
              const rowValues = row as Record<string, unknown>;
              const rowKey = String(rowValues[String(keyField)] ?? i);
              return (
                <tr
                  key={rowKey}
                  onClick={() => onRowClick?.(row)}
                  className={cn(
                    "group transition-colors duration-150 hover:bg-muted/30",
                    onRowClick && "cursor-pointer"
                  )}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={cn("py-3.5 px-4 align-middle text-foreground", col.className)}>
                      {col.render
                        ? col.render(row, i)
                        : (rowValues[col.key] !== undefined && rowValues[col.key] !== null
                            ? String(rowValues[col.key])
                            : "—")}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {pagination && (() => {
        const totalCount = pagination.total ?? pagination.totalItems;
        const computedTotalPages =
          pagination.totalPages ??
          (totalCount !== undefined && pagination.limit && pagination.limit > 0
            ? Math.ceil(totalCount / pagination.limit)
            : undefined);
        const currentPage = pagination.page ?? 1;

        return (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-border/70 px-4 py-3 bg-muted/15 text-xs text-muted-foreground">
            <div>
              <span>
                {pagination.page !== undefined ? (
                  <>
                    Showing Page <strong className="text-foreground font-bold">{currentPage}</strong>
                    {computedTotalPages ? (
                      <> of <strong className="text-foreground font-bold">{computedTotalPages}</strong></>
                    ) : null}
                  </>
                ) : (
                  <>Showing <strong className="text-foreground font-bold">{safeData.length}</strong> items</>
                )}
                {totalCount !== undefined ? (
                  <> ({totalCount} total {totalCount === 1 ? "item" : "items"})</>
                ) : null}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-lg px-2.5 text-xs font-semibold gap-1 disabled:opacity-40"
                disabled={
                  pagination.hasPreviousPage !== undefined
                    ? !pagination.hasPreviousPage
                    : pagination.hasPrevPage !== undefined
                    ? !pagination.hasPrevPage
                    : currentPage <= 1
                }
                onClick={() => {
                  if (pagination.onPrevPage) {
                    pagination.onPrevPage();
                  } else if (pagination.onPageChange) {
                    pagination.onPageChange(currentPage - 1);
                  }
                }}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-lg px-2.5 text-xs font-semibold gap-1 disabled:opacity-40"
                disabled={
                  pagination.hasNextPage !== undefined
                    ? !pagination.hasNextPage
                    : computedTotalPages !== undefined
                    ? currentPage >= computedTotalPages
                    : false
                }
                onClick={() => {
                  if (pagination.onNextPage) {
                    pagination.onNextPage();
                  } else if (pagination.onPageChange) {
                    pagination.onPageChange(currentPage + 1);
                  }
                }}
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
