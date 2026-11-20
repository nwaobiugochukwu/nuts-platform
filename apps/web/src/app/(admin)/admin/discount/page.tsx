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
import { categoryService } from "@/api/modules/category";
import type { CategoryResponseDto } from "@/api/dto/category";
import { queryKey } from "@/lib/query-key";
import { formatPrice } from "@/lib/util";
import { zodResolver } from "@/lib/zod-resolver";
import { useMutation,useQuery,useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import {
  Ban,
  Check,
  Copy,
  FolderTree,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { useMemo,useState } from "react";
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
  platformwide?: boolean;
  firstOrderOnly?: boolean;
  applicableCategoryIds?: string[];
  perUserUsageLimit?: number | null;
  minOrderAmount?: number | null;
  maxDiscountAmount?: number | null;
  usageLimit?: number | null;
  expiresAt?: string | null;
  description?: string | null;
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

const createDiscountSchema = z
  .object({
    code: z
      .string()
      .min(3, "Code must be at least 3 characters")
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/, "Alphanumeric, hyphens and underscores only"),
    type: z.enum(["PERCENTAGE", "FIXED"]),
    value: z.coerce.number().positive("Value must be greater than 0"),
    description: z.string().max(256).optional().or(z.literal("")),
    minOrderAmount: optionalNumber(0, "Minimum basket size"),
    maxDiscountAmount: optionalNumber(0, "Maximum discount cap"),
    usageLimit: optionalPositiveInt("Global usage limit"),
    perUserUsageLimit: optionalPositiveInt("Per-customer usage limit"),
    expiresAt: z.string().optional().or(z.literal("")),
    platformwide: z.boolean().default(true),
    firstOrderOnly: z.boolean().default(false),
    applicableCategoryIds: z.array(z.string()).default([]),
  })
  .superRefine((data, ctx) => {
    if (data.type === "PERCENTAGE" && data.value > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Percentage discount cannot exceed 100%",
        path: ["value"],
      });
    }

    if (
      data.usageLimit &&
      data.perUserUsageLimit &&
      data.perUserUsageLimit > data.usageLimit
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Per-customer limit (${data.perUserUsageLimit}) cannot exceed global limit (${data.usageLimit})`,
        path: ["perUserUsageLimit"],
      });
    }
  });

type CreateDiscountFormData = z.infer<typeof createDiscountSchema>;

function CategorySelector({
  categories,
  selectedCategoryIds,
  onChange,
}: {
  categories: CategoryResponseDto[];
  selectedCategoryIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const flatList = useMemo(() => {
    const list: { id: string; name: string; path: string }[] = [];
    const traverse = (nodes: CategoryResponseDto[], prefix = "") => {
      if (!Array.isArray(nodes)) return;
      for (const node of nodes) {
        if (node.status === "ARCHIVED" || node.isActive === false) continue;
        const currentPath = prefix ? `${prefix} › ${node.name}` : node.name;
        list.push({ id: node.id, name: node.name, path: currentPath });
        const children = node.children || node.subCategories || [];
        if (Array.isArray(children) && children.length > 0) {
          traverse(children, currentPath);
        }
      }
    };
    traverse(categories);
    return list;
  }, [categories]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return flatList;
    return flatList.filter((item) =>
      item.path.toLowerCase().includes(q) || item.name.toLowerCase().includes(q)
    );
  }, [flatList, search]);

  const selectedItems = useMemo(
    () => flatList.filter((c) => selectedCategoryIds.includes(c.id)),
    [flatList, selectedCategoryIds]
  );

  const toggleCategory = (id: string) => {
    if (selectedCategoryIds.includes(id)) {
      onChange(selectedCategoryIds.filter((item) => item !== id));
    } else {
      onChange([...selectedCategoryIds, id]);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-border/80 bg-neutral-50/70 p-3.5 dark:bg-neutral-900/50">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <FolderTree className="h-3.5 w-3.5" />
          Restricted Categories (Optional)
        </label>
        {selectedCategoryIds.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-[11px] font-medium text-rose-500 hover:underline"
          >
            Clear all ({selectedCategoryIds.length})
          </button>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        If any categories are chosen, this discount will strictly apply ONLY to items in those categories. Leave empty to allow all categories across the platform.
      </p>

      {selectedItems.length > 0 && (
        <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pt-1">
          {selectedItems.map((cat) => (
            <span
              key={cat.id}
              className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary border border-primary/20"
            >
              <span className="truncate max-w-[130px] sm:max-w-[200px]" title={cat.path}>{cat.name}</span>
              <button
                type="button"
                onClick={() => toggleCategory(cat.id)}
                className="hover:text-rose-500 focus:outline-none shrink-0"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (!isOpen) setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            placeholder="Search categories to select..."
            className="w-full rounded-lg border border-border bg-background pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {isOpen && (
          <div className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-border bg-popover shadow-md p-1">
            <div className="flex items-center justify-between px-2 py-1 border-b border-border/50 text-[11px] text-muted-foreground">
              <span>{filtered.length} categories found</span>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-primary hover:underline font-medium"
              >
                Done
              </button>
            </div>
            {filtered.length === 0 ? (
              <div className="p-3 text-center text-xs text-muted-foreground">
                No matching categories found
              </div>
            ) : (
              <div className="py-1">
                {filtered.map((cat) => {
                  const isSelected = selectedCategoryIds.includes(cat.id);
                  return (
                    <div
                      key={cat.id}
                      onClick={() => toggleCategory(cat.id)}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded text-xs cursor-pointer select-none transition-colors ${
                        isSelected
                          ? "bg-primary/15 text-primary font-medium"
                          : "hover:bg-accent text-foreground"
                      }`}
                    >
                      <span className="truncate pr-2">{cat.path}</span>
                      {isSelected && <Check className="h-3.5 w-3.5 shrink-0" />}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

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

  const { data: categoriesData } = useQuery({
    queryKey: queryKey.category.list(),
    queryFn: async () => {
      const res = await categoryService.getAll();
      return res.data;
    },
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
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
      perUserUsageLimit: 1,
      expiresAt: "",
      platformwide: true,
      firstOrderOnly: false,
      applicableCategoryIds: [],
    },
  });

  const selectedType = useWatch({ control: methods.control, name: "type" });
  const selectedCategoryIds = useWatch({
    control: methods.control,
    name: "applicableCategoryIds",
  }) as string[] | undefined;

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
    perUserUsageLimit:
      values.perUserUsageLimit !== null &&
      values.perUserUsageLimit !== undefined &&
      values.perUserUsageLimit > 0
        ? values.perUserUsageLimit
        : null,
    expiresAt: values.expiresAt ? new Date(values.expiresAt).toISOString() : null,
    platformwide: values.platformwide ?? true,
    firstOrderOnly: values.firstOrderOnly ?? false,
    applicableCategoryIds: values.applicableCategoryIds ?? [],
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
      perUserUsageLimit: 1,
      expiresAt: "",
      platformwide: true,
      firstOrderOnly: false,
      applicableCategoryIds: [],
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
      perUserUsageLimit: discount.perUserUsageLimit ?? undefined,
      expiresAt: discount.expiresAt ? discount.expiresAt.slice(0, 10) : "",
      platformwide: discount.platformwide ?? true,
      firstOrderOnly: discount.firstOrderOnly ?? false,
      applicableCategoryIds: discount.applicableCategoryIds ?? [],
    });
    setOpen(true);
  };

  const columns: Column<AdminDiscount>[] = [
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
      key: "type",
      header: "Discount Type",
      className: "min-w-[130px]",
      render: (r) => (
        <Badge variant="outline" className="text-xs font-semibold whitespace-nowrap">
          {r.type === "PERCENTAGE" ? "Percentage Off" : "Fixed Discount"}
        </Badge>
      ),
    },
    {
      key: "value",
      header: "Value / Rate",
      className: "min-w-[110px]",
      render: (r) => (
        <span className="text-sm font-semibold text-neutral-900 dark:text-white whitespace-nowrap">
          {r.type === "PERCENTAGE" ? `${r.value}% Off` : formatPrice(r.value)}
        </span>
      ),
    },
    {
      key: "targeting",
      header: "Audience & Placement",
      className: "min-w-[200px]",
      render: (r) => (
        <div className="flex flex-wrap items-center gap-1.5">
          {r.firstOrderOnly ? (
            <Badge
              variant="outline"
              className="border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold text-[11px] whitespace-nowrap"
            >
              First-Time Buyers
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="border-neutral-500/30 text-neutral-600 dark:text-neutral-400 text-[11px] whitespace-nowrap"
            >
              All Customers
            </Badge>
          )}

          {r.platformwide && (
            <Badge
              variant="outline"
              className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold text-[11px] whitespace-nowrap"
            >
              Header Banner
            </Badge>
          )}

          {r.applicableCategoryIds && r.applicableCategoryIds.length > 0 && (
            <Badge
              variant="outline"
              className="border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold text-[11px] whitespace-nowrap"
            >
              {r.applicableCategoryIds.length}{" "}
              {r.applicableCategoryIds.length === 1 ? "Category" : "Categories"}
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: "usedCount",
      header: "Usage Count",
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
      className: "min-w-[120px]",
      render: (r) => (
        <span className="text-xs text-neutral-400 whitespace-nowrap">
          {r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : "Never Expires"}
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
          className="w-full sm:w-auto justify-center gap-2 rounded-2xl bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200 px-5 shadow-sm"
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
        <DialogContent className="w-[calc(100vw-1.5rem)] sm:w-full max-w-lg max-h-[90vh] sm:max-h-[85vh] rounded-2xl sm:rounded-3xl p-4 sm:p-6 md:p-8 flex flex-col gap-0 overflow-hidden">
          <DialogHeader className="pb-3 border-b border-border/50 shrink-0">
            <DialogTitle className="text-base sm:text-lg font-bold pr-6">
              {editingDiscount
                ? `Edit Coupon: ${editingDiscount.code}`
                : "Create Promotion Coupon"}
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
                    message: `Global limit (${data.usageLimit}) cannot be less than current redemptions (${editingDiscount.usageCount})`,
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
                  label="Global Usage Limit"
                  type="number"
                  placeholder="Leave empty or 0 for unlimited"
                  hint={
                    editingDiscount && editingDiscount.usageCount > 0
                      ? `Already redeemed: ${editingDiscount.usageCount} times`
                      : "Empty or 0 = unlimited"
                  }
                />

                <FormInput
                  name="perUserUsageLimit"
                  label="Per-Customer Usage Limit"
                  type="number"
                  placeholder="e.g. 1 (once per user)"
                  hint="Empty or 0 = unlimited"
                />
              </div>

              <FormInput
                name="expiresAt"
                label="Expiry Date"
                type="date"
              />

              <div className="space-y-3 rounded-xl border border-border/80 bg-neutral-50/70 p-3.5 dark:bg-neutral-900/50">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Audience & Storefront Targeting
                </h4>

                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    id="firstOrderOnly"
                    {...methods.register("firstOrderOnly")}
                    className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
                  />
                  <label htmlFor="firstOrderOnly" className="text-xs cursor-pointer select-none">
                    <span className="font-semibold text-foreground block">First-Time Buyers Only</span>
                    <span className="text-muted-foreground block text-[11px] mt-0.5">
                      Strictly limit this discount code to new shoppers who haven&apos;t bought any item before. Existing buyers will be rejected at checkout.
                    </span>
                  </label>
                </div>

                <div className="flex items-start gap-3 pt-1 border-t border-border/50">
                  <input
                    type="checkbox"
                    id="platformwide"
                    {...methods.register("platformwide")}
                    className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
                  />
                  <label htmlFor="platformwide" className="text-xs cursor-pointer select-none">
                    <span className="font-semibold text-foreground block">Feature in Storefront Announcement Ticker</span>
                    <span className="text-muted-foreground block text-[11px] mt-0.5">
                      Display this campaign code in the top sticky promotion bar on the storefront for shoppers to claim in one click.
                    </span>
                  </label>
                </div>
              </div>

              <CategorySelector
                categories={categoriesData ?? []}
                selectedCategoryIds={selectedCategoryIds ?? []}
                onChange={(ids) => methods.setValue("applicableCategoryIds", ids)}
              />

              <FormTextarea
                name="description"
                label="Campaign Description"
                placeholder="Optional notes for campaign tracking..."
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
