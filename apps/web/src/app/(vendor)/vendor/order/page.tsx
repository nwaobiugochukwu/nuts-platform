"use client";

import { dashboardOrderService } from "@/api";
import { getApiErrorMessage } from "@/api/core/error";
import type { VendorOrderResponseDto } from "@/api/dto/order";
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

type DashboardOrder = VendorOrderResponseDto;

const getVendorNextStatus = (status: OrderStatus): OrderStatus | null => {
  if (status === "PROCESSING") return "SHIPPED";
  if (status === "SHIPPED") return "DELIVERED";
  return null;
};

export default function DashboardOrderPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [selectedOrder, setSelectedOrder] = useState<DashboardOrder | null>(null);
  const [advanceTarget, setAdvanceTarget] = useState<{
    order: DashboardOrder;
    next: OrderStatus;
  } | null>(null);

  const qc = useQueryClient();
  const debouncedSearch = useDebouncedValue(search.trim());

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [...queryKey.vendor.order, debouncedSearch, status, page],
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
    placeholderData: (previousData) => previousData,
    queryFn: async () => {
      const res = await dashboardOrderService.list({
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
      dashboardOrderService.updateStatus(id, { status }),
    onSuccess: (_, variables) => {
      toast.success(`Order #${advanceTarget?.order.orderNumber || ""} marked as ${variables.status}`);
      qc.invalidateQueries({ queryKey: queryKey.vendor.order });
      setAdvanceTarget(null);
      if (selectedOrder && selectedOrder.id === variables.id) {
        setSelectedOrder((prev) =>
          prev ? { ...prev, status: variables.status } : null
        );
      }
    },
    onError: (e: unknown) =>
      toast.error(getApiErrorMessage(e, "Unable to update order fulfillment status")),
  });

  const columns: Column<DashboardOrder>[] = [
    {
      key: "orderNumber",
      header: "Order & Items",
      render: (r) => (
        <div className="flex items-center gap-3">
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
      key: "status",
      header: "Fulfillment Status",
      render: (r) => <OrderStatusBadge status={r.status} />,
    },
    {
      key: "finalAmount",
      header: "Your Revenue",
      render: (r) => (
        <span className="font-semibold text-sm text-neutral-900 dark:text-white">
          {formatPrice(r.finalAmount)}
        </span>
      ),
    },
    {
      key: "createdAt",
      header: "Date Placed",
      render: (r) => (
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          {new Date(r.createdAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Fulfilment Actions",
      render: (r) => {
        const next = getVendorNextStatus(r.status);
        return (
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedOrder(r)}
              className="h-8 rounded-xl px-2.5 text-xs font-medium border-neutral-200 dark:border-neutral-800"
            >
              <Eye className="h-3.5 w-3.5 mr-1 text-neutral-400" />
              Details
            </Button>

            {next && (
              <Button
                size="sm"
                onClick={() => setAdvanceTarget({ order: r, next })}
                className="h-8 rounded-xl px-2.5 text-xs font-medium bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
              >
                <Truck className="h-3 w-3 mr-1" />
                Mark {next.toLowerCase()}
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  const allowedNext = selectedOrder ? getVendorNextStatus(selectedOrder.status) : null;

  const orderList = data?.data ?? (Array.isArray(data) ? data : []);
  const meta = data?.meta;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customer Orders"
        description="Fulfill purchases, update shipping stages, and inspect buyer delivery details."
      />

      <ManagementToolbar
        value={search}
        onChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        placeholder="Search order number or customer email..."
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
        onRefresh={() => qc.invalidateQueries({ queryKey: queryKey.vendor.order })}
        isLoading={isLoading || isFetching}
      />

      <DataTable
        columns={columns}
        data={orderList}
        isLoading={isLoading}
        isFetching={isFetching}
        onRowClick={(row) => setSelectedOrder(row)}
        emptyMessage="No customer orders found."
        pagination={
          meta && "page" in meta
            ? {
                page: meta.page ?? page,
                limit: meta.limit ?? 25,
                total: meta.totalItems ?? meta.total ?? 0,
                totalPages: meta.totalPages,
                hasNextPage: meta.hasNextPage,
                hasPrevPage: meta.hasPreviousPage,
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
            setAdvanceTarget({ order: selectedOrder, next: st });
          }
        }}
      />

      {/* CONFIRM ADVANCE FULFILLMENT DIALOG */}
      <ConfirmDialog
        open={Boolean(advanceTarget)}
        onOpenChange={(v) => !v && setAdvanceTarget(null)}
        title="Update Order Fulfillment"
        description={
          <>
            Mark Order <strong>#{advanceTarget?.order.orderNumber}</strong> as{" "}
            <strong>{advanceTarget?.next}</strong>? The buyer will receive a tracking status
            update.
          </>
        }
        confirmText={`Mark as ${advanceTarget?.next}`}
        isLoading={updateStatusMutation.isPending}
        onConfirm={() =>
          advanceTarget &&
          updateStatusMutation.mutate({
            id: advanceTarget.order.id,
            status: advanceTarget.next,
          })
        }
      />
    </div>
  );
}
