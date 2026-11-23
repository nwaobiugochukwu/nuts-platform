"use client";

import { vendorApi } from "@/api/core/client";
import { getApiErrorMessage } from "@/api/core/error";
import { ManagementToolbar } from "@/component/common/ManagementToolbar";
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
import { zodResolver } from "@/lib/zod-resolver";
import { useMutation,useQuery,useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Check,
  Copy,
  Package,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Tag,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

interface VendorDiscount {
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
  applicableProductIds?: string[];
}

interface VendorProductOption {
  id: string;
  name: string;
  sku: string;
  price: number;
}

function toInputDateTime(isoString?: string | null): string {
  if (!isoString) return "";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return "";
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  } catch {
    return "";
  }
}

const optionalNumber = (minVal = 0, label = "Value") =>
  z
    .union([z.number(), z.string(), z.null(), z.undefined()])
    .transform((val) => {
      if (val === "" || val === null || val === undefined) return undefined;
      const num = typeof val === "string" ? Number(val.trim()) : Number(val);
      if (isNaN(num)) return undefined;
      return num;
    })
    .pipe(
      z
        .number()
        .min(minVal, `${label} cannot be negative`)
        .optional()
    );

const optionalPositiveInt = (label: string) =>
  z
    .union([z.number(), z.string(), z.null(), z.undefined()])
    .transform((val) => {
      if (val === "" || val === null || val === undefined) return null;
      if (typeof val === "string") {
        const trimmed = val.trim();
        if (trimmed === "") return null;
        const num = Number(trimmed);
        if (isNaN(num)) return null;
        if (num === 0) return null;
        return num;
      }
      if (typeof val === "number") {
        if (isNaN(val) || val === 0) return null;
        return val;
      }
      return null;
    })
    .pipe(
      z.union([
        z
          .number()
          .int(`${label} must be a whole number`)
          .positive(`${label} must be greater than 0`),
        z.null(),
      ])
    );

/** Mirrors the API limit for vendor-funded discounts. */
const VENDOR_MAX_DISCOUNT_PERCENT = 50;

const createDiscountSchema = z
  .object({
    code: z
      .string()
      .min(3, "Code must be at least 3 characters")
      .max(50)
      .regex(/^[A-Za-z0-9_-]+$/, "Alphanumeric, hyphens and underscores only"),
    type: z.enum(["PERCENTAGE", "FIXED"]),
    value: z.coerce.number().positive("Value must be greater than 0"),
    description: z.string().max(256).optional().or(z.literal("")),
    minOrderAmount: optionalNumber(0, "Minimum basket size"),
    maxDiscountAmount: optionalNumber(0, "Maximum discount cap"),
    usageLimit: optionalPositiveInt("Global usage limit"),
    expiresAt: z.string().optional().or(z.literal("")),
    applicableProductIds: z.array(z.string()).default([]),
  })
  .superRefine((data, ctx) => {
    if (data.type === "PERCENTAGE" && data.value > VENDOR_MAX_DISCOUNT_PERCENT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Store discounts cannot exceed ${VENDOR_MAX_DISCOUNT_PERCENT}%`,
        path: ["value"],
      });
    }
  });

type CreateDiscountFormData = z.infer<typeof createDiscountSchema>;

export default function DashboardDiscountPage() {
  const [open, setOpen] = useState(false);
  const [editingDiscount, setEditingDiscount] = useState<VendorDiscount | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VendorDiscount | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<VendorDiscount | null>(null);
  const [reactivateTarget, setReactivateTarget] = useState<VendorDiscount | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [scopeMode, setScopeMode] = useState<"all" | "specific">("all");
  const [page, setPage] = useState(1);
  const pageSize = 15;
  const qc = useQueryClient();

  const { data, isLoading, isFetching } = useQuery({
    queryKey: queryKey.vendor.discount,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
    queryFn: async () => {
      const res = await vendorApi.get<VendorDiscount[]>("/vendor/discounts");
      return res.data;
    },
  });

  const { data: vendorProducts = [] } = useQuery<VendorProductOption[]>({
    queryKey: ["vendor", "products", "discount-selector"],
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const res = await vendorApi.get<VendorProductOption[]>("/vendors/products", {
        params: { limit: 100 },
      });
      const raw = res.data;
      if (Array.isArray(raw)) return raw;
      if (
        raw &&
        typeof raw === "object" &&
        "data" in raw &&
        Array.isArray((raw as { data: unknown }).data)
      ) {
        return (raw as { data: VendorProductOption[] }).data;
      }
      return [];
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
      applicableProductIds: [],
    },
  });

  const selectedType = useWatch({ control: methods.control, name: "type" });
  const selectedProductIds = useWatch({ control: methods.control, name: "applicableProductIds" }) ?? [];

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
    usageLimit:
      values.usageLimit !== null && values.usageLimit !== undefined && values.usageLimit > 0
        ? values.usageLimit
        : null,
    expiresAt: values.expiresAt ? new Date(values.expiresAt).toISOString() : null,
    applicableProductIds: values.applicableProductIds?.length ? values.applicableProductIds : [],
  });

  const refreshDiscounts = () =>
    qc.invalidateQueries({ queryKey: queryKey.vendor.discount });

  const createMutation = useMutation({
    mutationFn: (values: CreateDiscountFormData) =>
      vendorApi.post("/vendor/discounts", discountPayload(values)),
    onSuccess: () => {
      toast.success("Store discount coupon created successfully!");
      refreshDiscounts();
      setOpen(false);
      methods.reset();
    },
    onError: (err: unknown) => toast.error(getApiErrorMessage(err, "Failed to create discount code")),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      values,
    }: {
      id: string;
      values: CreateDiscountFormData;
    }) => vendorApi.patch(`/vendor/discounts/${id}`, discountPayload(values)),
    onSuccess: () => {
      toast.success("Store discount updated successfully!");
      refreshDiscounts();
      setOpen(false);
      setEditingDiscount(null);
    },
    onError: (err: unknown) => toast.error(getApiErrorMessage(err, "Failed to update discount code")),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => vendorApi.patch(`/vendor/discounts/${id}/deactivate`),
    onSuccess: () => {
      toast.success("Discount coupon deactivated");
      refreshDiscounts();
      setDeactivateTarget(null);
    },
    onError: (err: unknown) => toast.error(getApiErrorMessage(err, "Failed to deactivate discount code")),
  });

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => vendorApi.patch(`/vendor/discounts/${id}/reactivate`),
    onSuccess: () => {
      toast.success("Discount coupon reactivated successfully");
      refreshDiscounts();
      setReactivateTarget(null);
    },
    onError: (err: unknown) => toast.error(getApiErrorMessage(err, "Failed to reactivate discount code")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => vendorApi.delete(`/vendor/discounts/${id}`),
    onSuccess: () => {
      toast.success("Discount coupon deleted");
      refreshDiscounts();
      setDeleteTarget(null);
    },
    onError: (err: unknown) => toast.error(getApiErrorMessage(err, "Failed to delete discount code")),
  });

  const copyToClipboard = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    toast.success(`Copied "${code}" to clipboard`);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const openCreate = () => {
    setEditingDiscount(null);
    setProductSearch("");
    setScopeMode("all");
    methods.reset({
      code: "",
      type: "PERCENTAGE",
      value: 10,
      description: "",
      minOrderAmount: 0,
      maxDiscountAmount: undefined,
      usageLimit: undefined,
      expiresAt: "",
      applicableProductIds: [],
    });
    setOpen(true);
  };

  const openEdit = (discount: VendorDiscount) => {
    setEditingDiscount(discount);
    setProductSearch("");
    const hasSpecific = Boolean(
      discount.applicableProductIds && discount.applicableProductIds.length > 0,
    );
    setScopeMode(hasSpecific ? "specific" : "all");
    methods.reset({
      code: discount.code,
      type: discount.type,
      value: discount.value,
      description: discount.description ?? "",
      minOrderAmount: discount.minOrderAmount ?? 0,
      maxDiscountAmount: discount.maxDiscountAmount ?? undefined,
      usageLimit: discount.usageLimit ?? undefined,
      expiresAt: toInputDateTime(discount.expiresAt),
      applicableProductIds: discount.applicableProductIds ?? [],
    });
    setOpen(true);
  };

  const columns: Column<VendorDiscount>[] = [
    {
      key: "code",
      header: "Coupon Code",
      className: "min-w-[160px]",
      render: (r) => (
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 shrink-0">
            <Tag className="h-4 w-4" />
          </div>
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-mono font-bold text-sm tracking-wider text-neutral-900 dark:text-white truncate">
              {r.code}
            </span>
            <button
              type="button"
              onClick={() => copyToClipboard(r.code)}
              className="p-1 text-neutral-400 hover:text-foreground transition-colors shrink-0"
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
      key: "scope",
      header: "Applies To",
      className: "min-w-[140px]",
      render: (r) => {
        const count = r.applicableProductIds?.length ?? 0;
        if (count === 0) {
          return (
            <span className="text-xs text-muted-foreground font-medium">
              All store products
            </span>
          );
        }
        return (
          <Badge
            variant="outline"
            className="text-xs font-semibold bg-primary/10 text-primary border-primary/20"
          >
            {count} {count === 1 ? "Product" : "Products"}
          </Badge>
        );
      },
    },
    {
      key: "type",
      header: "Calculation",
      className: "min-w-[130px]",
      render: (r) => (
        <Badge variant="outline" className="text-xs font-medium whitespace-nowrap">
          {r.type === "PERCENTAGE" ? "Percentage Off" : "Fixed Discount"}
        </Badge>
      ),
    },
    {
      key: "value",
      header: "Discount Value",
      className: "min-w-[110px]",
      render: (r) => (
        <span className="font-semibold text-sm text-neutral-900 dark:text-white whitespace-nowrap">
          {r.type === "PERCENTAGE" ? `${r.value}% Off` : formatPrice(r.value)}
        </span>
      ),
    },
    {
      key: "usedCount",
      header: "Redemptions",
      className: "min-w-[110px]",
      render: (r) => (
        <span className="text-xs text-neutral-700 dark:text-neutral-300 whitespace-nowrap">
          {r.usageCount ?? 0} {r.usageLimit ? `/ ${r.usageLimit}` : "uses"}
        </span>
      ),
    },
    {
      key: "isActive",
      header: "Status",
      className: "min-w-[90px]",
      render: (r) =>
        r.isActive ? (
          <Badge variant="success" className="text-xs font-semibold">
            Active
          </Badge>
        ) : (
          <Badge variant="muted" className="text-xs font-semibold">
            Inactive
          </Badge>
        ),
    },
    {
      key: "expiresAt",
      header: "Expires",
      className: "min-w-[120px]",
      render: (r) => (
        <span className="text-xs text-neutral-400 whitespace-nowrap">
          {r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : "Never"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      className: "min-w-[110px] text-right",
      headerClassName: "text-right",
      render: (r) => (
        <div className="flex items-center justify-end gap-1">
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
              title="Deactivate coupon"
              className="h-8 w-8 p-0 rounded-lg text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/30"
              onClick={() => setDeactivateTarget(r)}
            >
              <Ban className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              title="Reactivate coupon"
              className="h-8 w-8 p-0 rounded-lg text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
              onClick={() => setReactivateTarget(r)}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            title="Delete coupon"
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
      <div className="flex items-center justify-end">
        <Button
          onClick={openCreate}
          className="w-full sm:w-auto justify-center gap-2 rounded-2xl bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200 px-5 shadow-sm"
        >
          <Plus className="h-4 w-4" />
          Create Discount
        </Button>
      </div>

      <ManagementToolbar
        value={search}
        onChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        placeholder="Search your coupon codes or description..."
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
        const rawList: VendorDiscount[] = Array.isArray(data)
          ? data
          : data && typeof data === "object" && "data" in data && Array.isArray((data as { data: unknown }).data)
          ? ((data as { data: VendorDiscount[] }).data)
          : [];
        const filtered = rawList.filter((discount: VendorDiscount) => {
          const q = search.trim().toLowerCase();
          const matchesSearch = !q || `${discount.code} ${discount.description ?? ""}`
            .toLowerCase()
            .includes(q);
          const matchesStatus =
            !status ||
            (status === "active" && discount.isActive) ||
            (status === "inactive" && !discount.isActive);
          return matchesSearch && matchesStatus;
        });
        const paginatedData = filtered.slice((page - 1) * pageSize, page * pageSize);

        return (
          <DataTable
            columns={columns}
            data={paginatedData}
            isLoading={isLoading}
            isFetching={isFetching}
            emptyMessage="No promotion coupon codes found for your store."
            pagination={{
              page,
              limit: pageSize,
              total: filtered.length,
              totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
              onPageChange: (newPage) => setPage(newPage),
            }}
          />
        );
      })()}

      {/* CREATE / EDIT DISCOUNT MODAL */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[calc(100vw-1.5rem)] sm:w-full max-w-lg max-h-[90vh] sm:max-h-[85vh] rounded-2xl sm:rounded-3xl p-4 sm:p-6 md:p-8 flex flex-col gap-0 overflow-hidden">
          <DialogHeader className="pb-3 border-b border-border/50 shrink-0">
            <DialogTitle className="text-base sm:text-lg font-bold pr-6">
              {editingDiscount
                ? `Edit Coupon: ${editingDiscount.code}`
                : "Create Store Coupon"}
            </DialogTitle>
          </DialogHeader>

          <FormProvider {...methods}>
            <form
              onSubmit={methods.handleSubmit((data) => {
                if (
                  editingDiscount &&
                  data.usageLimit !== null &&
                  data.usageLimit !== undefined &&
                  data.usageLimit < editingDiscount.usageCount
                ) {
                  methods.setError("usageLimit", {
                    type: "manual",
                    message: `Total limit (${data.usageLimit}) cannot be less than current redemptions (${editingDiscount.usageCount})`,
                  });
                  return;
                }
                return editingDiscount
                  ? updateMutation.mutate({
                      id: editingDiscount.id,
                      values: data,
                    })
                  : createMutation.mutate(data);
              })}
              className="space-y-4 pt-3 overflow-y-auto pr-1 sm:pr-2 flex-1 overscroll-contain"
            >
              <FormInput
                name="code"
                label="Coupon Code"
                placeholder="e.g. SUMMER20"
                required
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormSelect
                  name="type"
                  label="Type"
                  options={[
                    { value: "PERCENTAGE", label: "Percentage (%)" },
                    { value: "FIXED", label: "Fixed Amount (NGN)" },
                  ]}
                />
                <FormInput
                  name="value"
                  label={
                    selectedType === "PERCENTAGE"
                      ? "Percentage Off (%)"
                      : "Amount Off (NGN)"
                  }
                  type="number"
                  placeholder={selectedType === "PERCENTAGE" ? "20" : "1500"}
                  required
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormInput
                  name="minOrderAmount"
                  label="Minimum Order Value"
                  type="number"
                  placeholder="0"
                />
                <FormInput
                  name="usageLimit"
                  label="Total Usage Limit"
                  type="number"
                  placeholder="Leave empty or 0 for unlimited"
                  hint={
                    editingDiscount && editingDiscount.usageCount > 0
                      ? `Already redeemed: ${editingDiscount.usageCount} times`
                      : "Empty or 0 = unlimited"
                  }
                />
              </div>

              <FormInput
                name="expiresAt"
                label="Expiration Date & Time (Optional)"
                type="datetime-local"
              />

              {/* Product Application Scope */}
              <div className="space-y-2 rounded-2xl border border-border/80 bg-muted/20 p-3 sm:p-4">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Package className="h-3.5 w-3.5 text-primary" />
                    Applicable Products
                  </label>
                  <span className="text-[11px] text-muted-foreground">
                    {scopeMode === "all"
                      ? "Applies to entire store catalog"
                      : `${selectedProductIds.length} of ${vendorProducts.length} selected`}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setScopeMode("all");
                      methods.setValue("applicableProductIds", []);
                    }}
                    className={`rounded-xl px-3 py-2 text-xs font-semibold border transition-all ${
                      scopeMode === "all"
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border/80 bg-card text-muted-foreground hover:bg-secondary"
                    }`}
                  >
                    All Store Products
                  </button>
                  <button
                    type="button"
                    onClick={() => setScopeMode("specific")}
                    className={`rounded-xl px-3 py-2 text-xs font-semibold border transition-all ${
                      scopeMode === "specific"
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border/80 bg-card text-muted-foreground hover:bg-secondary"
                    }`}
                  >
                    Specific Products
                  </button>
                </div>

                {scopeMode === "specific" && (
                  <div className="space-y-2 pt-2 border-t border-border/60">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                      <input
                        type="text"
                        value={productSearch}
                        onChange={(e) => setProductSearch(e.target.value)}
                        placeholder="Search your products by name or SKU..."
                        className="w-full rounded-xl border border-border/80 bg-background py-1.5 pl-8 pr-3 text-xs focus:border-primary focus:outline-none"
                      />
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-muted-foreground px-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          const allIds = vendorProducts.map((p) => p.id);
                          methods.setValue("applicableProductIds", allIds);
                        }}
                        className="text-primary hover:underline font-medium"
                      >
                        Select all ({vendorProducts.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => methods.setValue("applicableProductIds", [])}
                        className="text-muted-foreground hover:text-foreground font-medium"
                      >
                        Clear selection
                      </button>
                    </div>

                    <div className="max-h-40 overflow-y-auto divide-y divide-border/40 rounded-xl border border-border/80 bg-background p-1 space-y-0.5">
                      {vendorProducts.length === 0 ? (
                        <p className="p-3 text-center text-xs text-muted-foreground">
                          No products found in your catalog.
                        </p>
                      ) : (
                        vendorProducts
                          .filter((p) => {
                            const q = productSearch.trim().toLowerCase();
                            return (
                              !q ||
                              p.name.toLowerCase().includes(q) ||
                              p.sku.toLowerCase().includes(q)
                            );
                          })
                          .map((product) => {
                            const isChecked = selectedProductIds.includes(product.id);
                            return (
                              <label
                                key={product.id}
                                className={`flex items-center gap-2.5 p-2 rounded-lg cursor-pointer transition-colors text-xs ${
                                  isChecked
                                    ? "bg-primary/5 text-foreground font-medium"
                                    : "text-muted-foreground hover:bg-muted/40"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      methods.setValue("applicableProductIds", [
                                        ...selectedProductIds,
                                        product.id,
                                      ]);
                                    } else {
                                      methods.setValue(
                                        "applicableProductIds",
                                        selectedProductIds.filter((id) => id !== product.id),
                                      );
                                    }
                                  }}
                                  className="h-3.5 w-3.5 rounded border-border text-primary focus:ring-primary"
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="truncate font-semibold text-foreground">
                                    {product.name}
                                  </div>
                                  <div className="text-[10px] text-muted-foreground">
                                    SKU: {product.sku} • {formatPrice(product.price)}
                                  </div>
                                </div>
                              </label>
                            );
                          })
                      )}
                    </div>
                  </div>
                )}
              </div>

              <FormTextarea
                name="description"
                label="Campaign Purpose (Optional)"
                placeholder="e.g. Weekend special promotional coupon"
              />

              <DialogFooter className="mt-4 pt-3 border-t border-border/50 shrink-0 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                  className="rounded-xl text-xs h-9 px-4 font-semibold w-full sm:w-auto"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="rounded-xl text-xs h-9 px-4 font-bold bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200 shadow-xs w-full sm:w-auto"
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
        title="Deactivate Coupon"
        description={
          <>
            Deactivate discount code <strong>&quot;{deactivateTarget?.code}&quot;</strong>? Customers
            will no longer be able to apply it in your store.
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
        title="Delete Coupon"
        description={
          <>
            Permanently delete coupon <strong>&quot;{deleteTarget?.code}&quot;</strong>? This action
            cannot be undone.
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
        title="Reactivate Coupon"
        description={
          <>
            Reactivate discount code <strong>&quot;{reactivateTarget?.code}&quot;</strong>? Customers will be able to apply it on their orders again.
          </>
        }
        confirmText="Reactivate Code"
        isLoading={reactivateMutation.isPending}
        onConfirm={() =>
          reactivateTarget && reactivateMutation.mutate(reactivateTarget.id)
        }
      />
    </div>
  );
}
