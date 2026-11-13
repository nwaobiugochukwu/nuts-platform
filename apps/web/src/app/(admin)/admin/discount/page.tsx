"use client";

import { adminApi } from "@/api/core/client";
import { ManagementToolbar } from "@/component/common/ManagementToolbar";
import { PageHeader } from "@/component/common/PageHeader";
import { DataTable,type Column } from "@/component/data/DataTable";
import { FormInput } from "@/component/form/FormInput";
import { FormSelect } from "@/component/form/FormSelect";
import { FormTextarea } from "@/component/form/FormTextarea";
import { ConfirmDialog } from "@/component/modal/ConfirmDialog";
import { Badge } from "@/component/ui/badge";
import { Button } from "@/component/ui/button";
import {
Dialog,
DialogContent,
DialogFooter,
DialogHeader,
DialogTitle,
} from "@/component/ui/dialog";
import { queryKey } from "@/lib/query-key";
import { formatPrice } from "@/lib/util";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation,useQuery,useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import {
Ban,
Check,
Copy,
Pencil,
Plus,
RotateCcw,
Tag,
Trash2
} from "lucide-react";
import { useState } from "react";
import { FormProvider,useForm,useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

interface AdminDiscount {
  id: string;
  code: string;
  type: "PERCENTAGE" | "FIXED";
  value: number;
  usageCount: number;
  isActive: boolean;
  minOrderAmount?: number | null;
  maxDiscountAmount?: number | null;
  usageLimit?: number | null;
  expiresAt?: string | null;
  description?: string | null;
}

const createDiscountSchema = z.object({
  code: z
    .string()
    .min(3, "Code must be at least 3 characters")
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, "Alphanumeric, hyphens and underscores only"),
  type: z.enum(["PERCENTAGE", "FIXED"]),
  value: z.coerce.number().positive("Value must be greater than 0"),
  description: z.string().max(256).optional().or(z.literal("")),
  minOrderAmount: z.coerce.number().min(0).optional(),
  maxDiscountAmount: z.coerce.number().min(0).optional(),
  usageLimit: z.coerce.number().int().positive().optional(),
  expiresAt: z.string().optional().or(z.literal("")),
});

type CreateDiscountFormData = z.infer<typeof createDiscountSchema>;

export default function AdminDiscountPage() {
  const [open, setOpen] = useState(false);
  const [editingDiscount, setEditingDiscount] = useState<AdminDiscount | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminDiscount | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<AdminDiscount | null>(null);
  const [reactivateTarget, setReactivateTarget] = useState<AdminDiscount | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 15;
  const qc = useQueryClient();

  const { data, isLoading, isFetching } = useQuery({
    queryKey: queryKey.admin.discount,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
    queryFn: async () => {
      const res = await adminApi.get<AdminDiscount[]>("/admin/discounts");
      return res.data;
    },
  });

  const methods = useForm<CreateDiscountFormData>({
    resolver: zodResolver(createDiscountSchema),
    defaultValues: {
      code: "",
      type: "PERCENTAGE",
      value: 10,
      description: "",
      minOrderAmount: 0,
      maxDiscountAmount: undefined,
      usageLimit: undefined,
      expiresAt: "",
    },
  });

  const selectedType = useWatch({ control: methods.control, name: "type" });

  const discountPayload = (values: CreateDiscountFormData) => ({
    code: values.code.trim().toUpperCase(),
    type: values.type,
    value: values.value,
    description: values.description?.trim() || null,
    minOrderAmount: values.minOrderAmount || 0,
    maxDiscountAmount:
      values.type === "PERCENTAGE" && values.maxDiscountAmount
        ? values.maxDiscountAmount
        : null,
    usageLimit: values.usageLimit || null,
    expiresAt: values.expiresAt ? new Date(values.expiresAt).toISOString() : null,
  });

  const refreshDiscounts = () =>
    qc.invalidateQueries({ queryKey: queryKey.admin.discount });

  const createMutation = useMutation({
    mutationFn: (values: CreateDiscountFormData) =>
      adminApi.post("/admin/discounts", discountPayload(values)),
    onSuccess: () => {
      toast.success("Discount coupon code created successfully!");
      refreshDiscounts();
      setOpen(false);
      methods.reset();
    },
    onError: (err: AxiosError<{ message: string }>) => {
      const msg = err?.response?.data?.message ?? "Failed to create discount code";
      toast.error(typeof msg === "string" ? msg : JSON.stringify(msg));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      values,
    }: {
      id: string;
      values: CreateDiscountFormData;
    }) => adminApi.patch(`/admin/discounts/${id}`, discountPayload(values)),
    onSuccess: () => {
      toast.success("Discount coupon updated successfully!");
      refreshDiscounts();
      setOpen(false);
      setEditingDiscount(null);
    },
    onError: (err: AxiosError<{ message: string }>) =>
      toast.error(err?.response?.data?.message ?? "Failed to update discount code"),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => adminApi.patch(`/admin/discounts/${id}/deactivate`),
    onSuccess: () => {
      toast.success("Discount code deactivated");
      refreshDiscounts();
      setDeactivateTarget(null);
    },
    onError: (err: AxiosError<{ message: string }>) =>
      toast.error(err?.response?.data?.message ?? "Failed to deactivate discount code"),
  });

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => adminApi.patch(`/admin/discounts/${id}/reactivate`),
    onSuccess: () => {
      toast.success("Discount code reactivated successfully");
      refreshDiscounts();
      setReactivateTarget(null);
    },
    onError: (err: AxiosError<{ message: string }>) =>
      toast.error(err?.response?.data?.message ?? "Failed to reactivate discount code"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.delete(`/admin/discounts/${id}`),
    onSuccess: () => {
      toast.success("Discount code deleted permanently");
      refreshDiscounts();
      setDeleteTarget(null);
    },
    onError: (err: AxiosError<{ message: string }>) =>
      toast.error(err?.response?.data?.message ?? "Failed to delete discount code"),
  });

  const copyToClipboard = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    toast.success(`Copied code "${code}" to clipboard`);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const openCreate = () => {
    setEditingDiscount(null);
    methods.reset({
      code: "",
      type: "PERCENTAGE",
      value: 10,
      description: "",
      minOrderAmount: 0,
      maxDiscountAmount: undefined,
      usageLimit: undefined,
      expiresAt: "",
    });
    setOpen(true);
  };

  const openEdit = (discount: AdminDiscount) => {
    setEditingDiscount(discount);
    methods.reset({
      code: discount.code,
      type: discount.type,
      value: discount.value,
      description: discount.description ?? "",
      minOrderAmount: discount.minOrderAmount ?? 0,
      maxDiscountAmount: discount.maxDiscountAmount ?? undefined,
      usageLimit: discount.usageLimit ?? undefined,
      expiresAt: discount.expiresAt ? discount.expiresAt.slice(0, 10) : "",
    });
    setOpen(true);
  };

  const columns: Column<AdminDiscount>[] = [
    {
      key: "code",
      header: "Coupon Code",
      render: (r) => (
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300">
            <Tag className="h-4 w-4" />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-mono font-bold text-sm tracking-wider text-neutral-900 dark:text-white">
              {r.code}
            </span>
            <button
              type="button"
              onClick={() => copyToClipboard(r.code)}
              className="p-1 text-neutral-400 hover:text-foreground transition-colors"
              title="Copy coupon code"
            >
              {copiedCode === r.code ? (
                <Check className="h-3 w-3 text-emerald-500" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </button>
          </div>
        </div>
      ),
    },
    {
      key: "type",
      header: "Discount Type",
      render: (r) => (
        <Badge variant="outline" className="text-xs font-semibold">
          {r.type === "PERCENTAGE" ? "Percentage Off" : "Fixed Discount"}
        </Badge>
      ),
    },
    {
      key: "value",
      header: "Value / Rate",
      render: (r) => (
        <span className="text-sm font-semibold text-neutral-900 dark:text-white">
          {r.type === "PERCENTAGE" ? `${r.value}% Off` : formatPrice(r.value)}
        </span>
      ),
    },
    {
      key: "usedCount",
      header: "Usage Count",
      render: (r) => (
        <span className="text-xs text-neutral-700 dark:text-neutral-300">
          {r.usageCount ?? 0} {r.usageLimit ? `/ ${r.usageLimit}` : "uses"}
        </span>
      ),
    },
    {
      key: "isActive",
      header: "Status",
      render: (r) =>
        r.isActive ? (
          <Badge variant="success">
            Active
          </Badge>
        ) : (
          <Badge variant="muted">
            Inactive
          </Badge>
        ),
    },
    {
      key: "expiresAt",
      header: "Expiration",
      render: (r) => (
        <span className="text-xs text-neutral-400">
          {r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : "Never Expires"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (r) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            title="Edit discount code"
            onClick={() => openEdit(r)}
            className="h-8 w-8 p-0 rounded-lg"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>

          {r.isActive ? (
            <Button
              variant="ghost"
              size="sm"
              title="Deactivate code"
              className="h-8 w-8 p-0 rounded-lg text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/30"
              onClick={() => setDeactivateTarget(r)}
            >
              <Ban className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              title="Reactivate code"
              className="h-8 w-8 p-0 rounded-lg text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
              onClick={() => setReactivateTarget(r)}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            title="Delete discount code"
            className="h-8 w-8 p-0 rounded-lg text-rose-500 hover:bg-rose-500/10 hover:text-rose-600"
            onClick={() => setDeleteTarget(r)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          title="Promotions & Discounts"
          description="Create platform-wide campaign coupon codes, set usage limits, and monitor redemptions."
        />
        <Button
          onClick={openCreate}
          className="gap-2 rounded-2xl bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200 px-5 shadow-sm"
        >
          <Plus className="h-4 w-4" />
          Create Coupon
        </Button>
      </div>

      <ManagementToolbar
        value={search}
        onChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        placeholder="Search coupon code or promotional description..."
        filterValue={status}
        onFilterChange={(v) => {
          setStatus(v);
          setPage(1);
        }}
        filters={[
          { value: "active", label: "Active Coupons" },
          { value: "inactive", label: "Disabled Coupons" },
        ]}
        onRefresh={refreshDiscounts}
        isLoading={isLoading || isFetching}
      />

      {(() => {
        const rawList: AdminDiscount[] = Array.isArray(data)
          ? data
          : data && typeof data === "object" && "data" in data && Array.isArray((data as { data: unknown }).data)
          ? ((data as { data: AdminDiscount[] }).data)
          : [];
        const term = search.trim().toLowerCase();
        const filtered = rawList.filter((discount: AdminDiscount) => {
          const matchesSearch = !term || `${discount.code} ${discount.description ?? ""}`.toLowerCase().includes(term);
          const matchesStatus =
            !status ||
            (status === "active" && discount.isActive) ||
            (status === "inactive" && !discount.isActive);
          return matchesSearch && matchesStatus;
        });
        const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
        const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

        return (
          <DataTable
            columns={columns}
            data={paginated}
            isLoading={isLoading}
            isFetching={isFetching}
            emptyMessage="No promotion discount codes found."
            pagination={{
              page,
              limit: pageSize,
              total: filtered.length,
              totalPages,
              onPageChange: (newPage) => setPage(newPage),
            }}
          />
        );
      })()}

      {/* CREATE / EDIT DISCOUNT MODAL */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg rounded-3xl p-6 sm:p-8">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">
              {editingDiscount
                ? `Edit Coupon: ${editingDiscount.code}`
                : "Create Promotion Coupon"}
            </DialogTitle>
          </DialogHeader>

          <FormProvider {...methods}>
            <form
              onSubmit={methods.handleSubmit((data) =>
                editingDiscount
                  ? updateMutation.mutate({
                      id: editingDiscount.id,
                      values: data,
                    })
                  : createMutation.mutate(data)
              )}
              className="space-y-4 pt-2"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormInput
                  name="code"
                  label="Discount Coupon Code"
                  placeholder="e.g. FLASH25"
                  required
                />

                <FormSelect
                  name="type"
                  label="Discount Calculation"
                  options={[
                    { value: "PERCENTAGE", label: "Percentage Off (%)" },
                    { value: "FIXED", label: "Fixed Amount (NGN)" },
                  ]}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormInput
                  name="value"
                  label={
                    selectedType === "PERCENTAGE"
                      ? "Percentage Off (%)"
                      : "Discount Amount (NGN)"
                  }
                  type="number"
                  placeholder={selectedType === "PERCENTAGE" ? "20" : "2500"}
                  required
                />

                <FormInput
                  name="minOrderAmount"
                  label="Minimum Basket Size (NGN)"
                  type="number"
                  placeholder="0"
                />
              </div>

              {selectedType === "PERCENTAGE" && (
                <FormInput
                  name="maxDiscountAmount"
                  label="Maximum Discount Cap (NGN, Optional)"
                  type="number"
                  placeholder="e.g. 5000"
                />
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormInput
                  name="usageLimit"
                  label="Total Usage Limit"
                  type="number"
                  placeholder="Leave empty for unlimited"
                />

                <FormInput
                  name="expiresAt"
                  label="Expiry Date"
                  type="date"
                />
              </div>

              <FormTextarea
                name="description"
                label="Campaign Description"
                placeholder="Optional notes for campaign tracking..."
              />

              <DialogFooter className="mt-6 flex flex-row items-center justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                  className="rounded-xl text-xs h-9 px-4 font-semibold"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="rounded-xl text-xs h-9 px-4 font-bold bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200 shadow-xs"
                >
                  {editingDiscount
                    ? updateMutation.isPending
                      ? "Saving..."
                      : "Update Coupon"
                    : createMutation.isPending
                    ? "Creating..."
                    : "Create Coupon"}
                </Button>
              </DialogFooter>
            </form>
          </FormProvider>
        </DialogContent>
      </Dialog>

      {/* CONFIRM DEACTIVATE DIALOG */}
      <ConfirmDialog
        open={Boolean(deactivateTarget)}
        onOpenChange={(v) => !v && setDeactivateTarget(null)}
        title="Deactivate Discount Code"
        description={
          <>
            Deactivate coupon <strong>&quot;{deactivateTarget?.code}&quot;</strong>? Customers will no
            longer be able to apply this code during checkout.
          </>
        }
        confirmText="Deactivate Code"
        variant="warning"
        isLoading={deactivateMutation.isPending}
        onConfirm={() =>
          deactivateTarget && deactivateMutation.mutate(deactivateTarget.id)
        }
      />

      {/* CONFIRM DELETE DIALOG */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title="Delete Discount Code"
        description={
          <>
            Permanently delete coupon <strong>&quot;{deleteTarget?.code}&quot;</strong>? Historical
            redemption logs will be archived.
          </>
        }
        confirmText="Delete Code"
        variant="destructive"
        isLoading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
      />

      {/* CONFIRM REACTIVATE DIALOG */}
      <ConfirmDialog
        open={Boolean(reactivateTarget)}
        onOpenChange={(v) => !v && setReactivateTarget(null)}
        title="Reactivate Discount Code"
        description={
          <>
            Reactivate coupon code <strong>&quot;{reactivateTarget?.code}&quot;</strong>? Customers will immediately be able to apply this discount at checkout.
          </>
        }
        confirmText="Reactivate Code"
        variant="default"
        isLoading={reactivateMutation.isPending}
        onConfirm={() =>
          reactivateTarget && reactivateMutation.mutate(reactivateTarget.id)
        }
      />
    </div>
  );
}
