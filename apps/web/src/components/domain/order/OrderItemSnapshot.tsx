import { cn } from "@/lib/util";

const STATUS: Record<string, { label: string; className: string }> = {
  PENDING: { label: "Pending", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/20" },
  PROCESSING: { label: "Processing", className: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border border-blue-500/20" },
  SHIPPED: { label: "Shipped", className: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400 border border-indigo-500/20" },
  DELIVERED: { label: "Delivered", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20" },
  CANCELLED: { label: "Cancelled", className: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/20" },
  REFUND_PENDING: { label: "Refund pending", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/20" },
  REFUNDED: { label: "Refunded", className: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/20" },
};

export function OrderStatusBadge({ status }: { status: string }) {
  const entry = STATUS[status] ?? { label: status, className: "bg-gray-100 text-gray-800" };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        entry.className,
      )}
    >
      {entry.label}
    </span>
  );
}

export function PaymentStatusBadge({ status }: { status: string }) {
  const paid = status.toLowerCase().includes("paid") || status === "SUCCESS";
  const label = status === "REFUND_PENDING"
    ? "Refund pending"
    : status === "REFUNDED"
      ? "Refunded"
      : paid
        ? "Paid"
        : status;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        paid
          ? "bg-green-100 text-green-800"
          : "bg-amber-100 text-amber-800",
      )}
    >
      {label}
    </span>
  );
}
