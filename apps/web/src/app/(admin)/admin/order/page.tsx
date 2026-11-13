"use client";

import { adminOrderService } from "@/api";
import { getApiErrorMessage } from "@/api/core/error";
import type { AdminOrderResponseDto } from "@/api/dto/order";
import type { OrderStatus } from "@/api/core/types";
import { ManagementToolbar } from "@/component/common/ManagementToolbar";
import { PageHeader } from "@/component/common/PageHeader";
import { DataTable,type Column } from "@/component/data/DataTable";
import { ConfirmDialog } from "@/component/modal/ConfirmDialog";
import { OrderDetailsModal } from "@/component/order/OrderDetailsModal";
import { OrderStatusBadge } from "@/component/order/OrderItemSnapshot";
import { Button } from "@/component/ui/button";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { queryKey } from "@/lib/query-key";
import { formatPrice } from "@/lib/util";
import { useMutation,useQuery,useQueryClient } from "@tanstack/react-query";
import {
Eye,
ShoppingBag,
Truck
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type AdminOrder = AdminOrderResponseDto;

const nextStatus = (status: OrderStatus): OrderStatus | null => {
  switch (status) {
    case "PENDING":
      return "PROCESSING";
    case "PROCESSING":
      return "SHIPPED";
    case "SHIPPED":
      return "DELIVERED";
    default:
      return null;
  }
};

export default function AdminOrderPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [selectedOrder, setSelectedOrder] = useState<AdminOrder | null>(null);
  const [statusAdvanceTarget, setStatusAdvanceTarget] = useState<{
    order: AdminOrder;
    next: OrderStatus;
  } | null>(null);

  const qc = useQueryClient();
  const debouncedSearch = useDebouncedValue(search.trim());

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [...queryKey.admin.order, debouncedSearch, status, page],
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
    placeholderData: (previousData) => previousData,
    queryFn: async () => {
      const res = await adminOrderService.list({
        page,
        limit: 25,
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        ...(status ? { status } : {}),
      });
      return res;
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: OrderStatus }) =>
      adminOrderService.updateStatus(id, { status }),
    onSuccess: (_, variables) => {
      toast.success(`Order advanced to ${variables.status}`);
      qc.invalidateQueries({ queryKey: queryKey.admin.order });
      setStatusAdvanceTarget(null);
      if (selectedOrder && selectedOrder.id === variables.id) {
        setSelectedOrder((prev) =>
          prev ? { ...prev, status: variables.status } : null
        );
      }
    },
    onError: (e: unknown) =>
      toast.error(getApiErrorMessage(e, "Unable to advance order fulfillment status")),
  });

  const columns: Column<AdminOrder>[] = [
    {
      key: "orderNumber",
      header: "Order & Reference",
      render: (r) => (
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400">
            <ShoppingBag className="h-4 w-4" />
          </div>
          <div className="flex flex-col">
            <span className="font-mono font-semibold text-xs text-neutral-900 dark:text-white">
              #{r.orderNumber}
            </span>
            <span className="text-xs text-neutral-400">
              {r.items?.length ?? 1} {(r.items?.length ?? 1) === 1 ? "item" : "items"}
            </span>
          </div>
        </div>
      ),
    },
    {
      key: "user",
      header: "Customer",
      render: (r) => (
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-neutral-900 dark:text-white">
            {r.customer
              ? `${r.customer.firstName ?? ""} ${r.customer.lastName ?? ""}`.trim() ||
                r.customer.email
              : "Customer"}
          </span>
          <span className="text-xs text-neutral-400 truncate max-w-[180px]">
            {r.customer?.email ?? "—"}
          </span>
        </div>
      ),
    },
    {
      key: "status",
      header: "Fulfillment Status",
      render: (r) => <OrderStatusBadge status={r.status} />,
    },
    {
      key: "totalAmount",
      header: "Gross Total",
      render: (r) => (
        <span className="font-semibold text-sm text-neutral-900 dark:text-white">
          {formatPrice(r.finalAmount ?? r.totalAmount)}
        </span>
      ),
    },
    {
      key: "platformFee",
      header: "Platform Cut (15%)",
      render: (r) => {
        const gross = Number(r.finalAmount ?? r.totalAmount ?? 0);
        const fee =
          r.platformFee && r.platformFee > 0
            ? r.platformFee
            : Math.round(gross * 0.15 * 100) / 100;
        return (
          <div className="flex flex-col">
            <span className="font-semibold text-sm text-emerald-600 dark:text-emerald-400 font-mono">
              +{formatPrice(fee)}
            </span>
            <span className="text-[10px] text-muted-foreground font-medium">
              15% fee
            </span>
          </div>
        );
      },
    },
    {
      key: "createdAt",
      header: "Placed At",
      render: (r) => (
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          {new Date(r.createdAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (r) => {
        const next = nextStatus(r.status);
        return (
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedOrder(r)}
              className="h-8 rounded-xl px-2.5 text-xs font-medium border-neutral-200 dark:border-neutral-800"
            >
              <Eye className="h-3.5 w-3.5 mr-1 text-neutral-400" />
              View
            </Button>

            {next && (
              <Button
                size="sm"
                onClick={() => setStatusAdvanceTarget({ order: r, next })}
                className="h-8 rounded-xl px-2.5 text-xs font-medium bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
              >
                <Truck className="h-3 w-3 mr-1" />
                {next}
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  const allowedNext = selectedOrder ? nextStatus(selectedOrder.status) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Marketplace Orders"
        description="Monitor customer purchases, shipping status updates, and settlement audits."
      />

      <ManagementToolbar
        value={search}
        onChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        placeholder="Search order #, customer email/name, or product..."
        filterValue={status}
        onFilterChange={(v) => {
          setStatus(v);
          setPage(1);
        }}
        filters={[
          { value: "PENDING", label: "Pending" },
          { value: "PROCESSING", label: "Processing" },
          { value: "SHIPPED", label: "Shipped" },
          { value: "DELIVERED", label: "Delivered" },
          { value: "CANCELLED", label: "Cancelled" },
          { value: "REFUND_PENDING", label: "Refund pending" },
          { value: "REFUNDED", label: "Refunded" },
        ]}
        onRefresh={() => qc.invalidateQueries({ queryKey: queryKey.admin.order })}
        isLoading={isLoading || isFetching}
      />

      <DataTable
        columns={columns}
        data={Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []}
        isLoading={isLoading}
        isFetching={isFetching}
        onRowClick={(row) => setSelectedOrder(row)}
        emptyMessage="No customer orders found."
        pagination={
          data?.meta && "page" in data.meta
            ? {
                page: data.meta.page ?? page,
                limit: data.meta.limit ?? 25,
                total: data.meta.totalItems ?? data.meta.total ?? 0,
                totalPages: data.meta.totalPages,
                hasNextPage: "hasNextPage" in data.meta ? data.meta.hasNextPage : undefined,
                hasPrevPage: "hasPreviousPage" in data.meta ? data.meta.hasPreviousPage : undefined,
                onPageChange: (newPage) => setPage(newPage),
              }
            : undefined
        }
      />

      {/* DETAILED ORDER MODAL */}
      <OrderDetailsModal
        order={selectedOrder}
        open={Boolean(selectedOrder)}
        onOpenChange={(v) => !v && setSelectedOrder(null)}
        allowedNextStatuses={allowedNext ? [allowedNext] : []}
        isUpdatingStatus={updateStatusMutation.isPending}
        onUpdateStatus={(st) => {
          if (selectedOrder) {
            setStatusAdvanceTarget({
              order: selectedOrder,
              next: st as OrderStatus,
            });
          }
        }}
      />

      {/* CONFIRM ADVANCE FULFILLMENT DIALOG */}
      <ConfirmDialog
        open={Boolean(statusAdvanceTarget)}
        onOpenChange={(v) => !v && setStatusAdvanceTarget(null)}
        title="Advance Order Status"
        description={
          <>
            Advance Order <strong>#{statusAdvanceTarget?.order.orderNumber}</strong> to{" "}
            <strong>{statusAdvanceTarget?.next}</strong>? This will notify the customer
            and update vendor records.
          </>
        }
        confirmText={`Mark as ${statusAdvanceTarget?.next}`}
        isLoading={updateStatusMutation.isPending}
        onConfirm={() =>
          statusAdvanceTarget &&
          updateStatusMutation.mutate({
            id: statusAdvanceTarget.order.id,
            status: statusAdvanceTarget.next,
          })
        }
      />
    </div>
  );
}
