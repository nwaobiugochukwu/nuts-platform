"use client";

import { RemoteImage } from "@/component/ui/RemoteImage";
import { categoryService } from "@/api";
import { vendorApi } from "@/api/core/client";
import type { VendorVariantResponseDto } from "@/api/dto/variant";
import { ManagementToolbar } from "@/component/common/ManagementToolbar";
import { PageHeader } from "@/component/common/PageHeader";
import { DataTable,type Column } from "@/component/data/DataTable";
import { CategoryPicker } from "@/component/form/CategoryPicker";
import { FormInput } from "@/component/form/FormInput";
import { FormTextarea } from "@/component/form/FormTextarea";
import { ImageUpload } from "@/component/form/ImageUpload";
import { ConfirmDialog } from "@/component/modal/ConfirmDialog";
import {
ProductVariantBuilder,
type ProductVariantItem,
} from "@/component/product/ProductVariantBuilder";
import { Badge } from "@/component/ui/badge";
import { Button } from "@/component/ui/button";
import {
Dialog,
DialogContent,
DialogFooter,
DialogHeader,
DialogTitle,
} from "@/component/ui/dialog";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { queryKey } from "@/lib/query-key";
import { getApiErrorMessage } from "@/lib/api-error";
import { formatPrice } from "@/lib/util";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation,useQuery,useQueryClient } from "@tanstack/react-query";
import {
Ban,
Layers,
Package,
PackagePlus,
Pencil,
Plus,
RotateCcw,
Trash2
} from "lucide-react";
import { useState } from "react";
import { FormProvider,useForm,useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

interface VendorProduct {
  id: string;
  name: string;
  slug?: string;
  sku: string;
  price: number;
  stock: number;
  hasVariants?: boolean;
  description?: string | null;
  isActive: boolean;
  createdAt: string;
  category?: { id: string; name?: string; slug?: string; path?: string };
  images?: Array<{ url?: string; publicId?: string }>;
  imageUrl?: string | null;
}

const productSchema = z.object({
  name: z.string().min(2, "Product name is required").max(200),
  sku: z
    .string()
    .min(2, "SKU is required")
    .max(100)
    .regex(/^[A-Za-z0-9_-]+$/, "Letters, numbers, hyphens, and underscores only"),
  price: z.coerce.number().min(0, "Price must be positive"),
  stock: z.coerce.number().int().min(0, "Stock must be 0 or more").optional(),
  hasVariants: z.boolean().default(false),
  categoryId: z.string().min(1, "Choose a category"),
  description: z.string().max(1500).optional().or(z.literal("")),
  imageUrls: z.array(z.string()).max(6).optional(),
});

const stockSchema = z.object({
  quantity: z
    .coerce
    .number()
    .int("Use a whole number")
    .refine((v) => v !== 0, "Adjustment cannot be 0"),
  description: z.string().max(250).optional().or(z.literal("")),
});

type ProductFormData = z.infer<typeof productSchema>;
type StockFormData = z.infer<typeof stockSchema>;

const defaultProductValues: ProductFormData = {
  name: "",
  sku: "",
  price: 0,
  stock: 10,
  hasVariants: false,
  categoryId: "",
  description: "",
  imageUrls: [],
};

function productImages(product: VendorProduct) {
  return (
    product.images?.map((img) => img.url ?? img.publicId ?? "").filter(Boolean) ??
    (product.imageUrl ? [product.imageUrl] : [])
  );
}

export default function DashboardProductPage() {
  const [open, setOpen] = useState(false);
  const [stockOpen, setStockOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<VendorProduct | null>(null);
  const [stockProduct, setStockProduct] = useState<VendorProduct | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VendorProduct | null>(null);
  const [toggleActiveTarget, setToggleActiveTarget] = useState<VendorProduct | null>(null);
  const [variantsList, setVariantsList] = useState<ProductVariantItem[]>([]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const qc = useQueryClient();
  const debouncedSearch = useDebouncedValue(search.trim());

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [...queryKey.vendor.product, debouncedSearch, status, page],
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
    placeholderData: (previousData) => previousData,
    queryFn: async () => {
      const params: Record<string, string | number | boolean> = {
        page,
        limit: 25,
      };

      if (debouncedSearch) params.search = debouncedSearch;
      if (status === "active") params.isActive = true;
      if (status === "inactive") params.isActive = false;

      const res = await vendorApi.get<VendorProduct[]>("/vendors/products", { params });
      return res;
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

  const methods = useForm<ProductFormData>({
    resolver: zodResolver(productSchema),
    defaultValues: defaultProductValues,
  });
  const hasVariants = useWatch({ control: methods.control, name: "hasVariants" });

  const stockMethods = useForm<StockFormData>({
    resolver: zodResolver(stockSchema),
    defaultValues: { quantity: 1, description: "" },
  });

  const refreshProducts = () =>
    qc.invalidateQueries({ queryKey: queryKey.vendor.product });

  const createMutation = useMutation({
    mutationFn: (values: ProductFormData) =>
      vendorApi.post("/vendors/products", {
        name: values.name.trim(),
        sku: values.sku.trim().toUpperCase(),
        price: values.price,
        hasVariants: values.hasVariants,
        stock: values.hasVariants ? 0 : (values.stock ?? 0),
        categoryId: values.categoryId,
        ...(values.description?.trim() ? { description: values.description.trim() } : {}),
        ...(values.imageUrls?.length ? { imageUrls: values.imageUrls, imageUrl: values.imageUrls[0] } : {}),
        ...(values.hasVariants && variantsList.length > 0 ? { variants: variantsList } : {}),
      }),
    onSuccess: () => {
      toast.success("Product listed successfully in your store!");
      refreshProducts();
      setOpen(false);
      methods.reset(defaultProductValues);
      setVariantsList([]);
    },
    onError: (error: unknown) => toast.error(getApiErrorMessage(error, "Failed to create product listing")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: ProductFormData }) =>
      vendorApi.patch(`/vendors/products/${id}`, {
        name: values.name.trim(),
        sku: values.sku.trim().toUpperCase(),
        price: values.price,
        hasVariants: values.hasVariants,
        stock: values.hasVariants ? 0 : (values.stock ?? 0),
        categoryId: values.categoryId,
        description: values.description?.trim() || undefined,
        ...(values.imageUrls?.length ? { imageUrls: values.imageUrls, imageUrl: values.imageUrls[0] } : {}),
        ...(values.hasVariants && variantsList.length > 0 ? { variants: variantsList } : {}),
      }),
    onSuccess: () => {
      toast.success("Product listing updated successfully!");
      refreshProducts();
      setOpen(false);
      setEditingProduct(null);
      setVariantsList([]);
    },
    onError: (error: unknown) => toast.error(getApiErrorMessage(error, "Failed to update product")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => vendorApi.delete(`/vendors/products/${id}/permanent`),
    onSuccess: () => {
      toast.success("Product permanently deleted from your store");
      refreshProducts();
      setDeleteTarget(null);
    },
    onError: (error: unknown) => toast.error(getApiErrorMessage(error, "Failed to delete product")),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      vendorApi.patch(`/vendors/products/${id}/${active ? "deactivate" : "reactivate"}`),
    onSuccess: () => {
      toast.success("Product status updated");
      refreshProducts();
      setToggleActiveTarget(null);
    },
    onError: (error: unknown) => toast.error(getApiErrorMessage(error, "Failed to update product status")),
  });

  const adjustStockMutation = useMutation({
    mutationFn: ({
      id,
      quantity,
      description,
    }: {
      id: string;
      quantity: number;
      description?: string;
    }) =>
      vendorApi.patch(`/vendors/products/${id}/stock`, {
        quantity,
        ...(description ? { description } : {}),
      }),
    onSuccess: () => {
      toast.success("Inventory stock adjusted");
      refreshProducts();
      setStockOpen(false);
      setStockProduct(null);
      stockMethods.reset({ quantity: 1, description: "" });
    },
    onError: (error: unknown) => toast.error(getApiErrorMessage(error, "Failed to adjust stock")),
  });

  const openCreate = () => {
    setEditingProduct(null);
    setVariantsList([]);
    methods.reset(defaultProductValues);
    setOpen(true);
  };

  const openEdit = async (product: VendorProduct) => {
    setEditingProduct(product);
    methods.reset({
      name: product.name ?? "",
      sku: product.sku ?? "",
      price: product.price ?? 0,
      stock: product.stock ?? 0,
      hasVariants: Boolean(product.hasVariants),
      categoryId: product.category?.id ?? "",
      description: product.description ?? "",
      imageUrls: productImages(product),
    });

    if (product.hasVariants) {
      try {
        const res = await vendorApi.get<{ variants: VendorVariantResponseDto[] }>(`/vendors/products/variants?productId=${product.id}`);
        const list = res.data.variants;
        setVariantsList(
          list.map((v) => ({
            id: v.id,
            options: Array.isArray(v.options) ? v.options : [],
            stock: v.stock ?? 0,
            images: Array.isArray(v.images) ? v.images : [],
          }))
        );
      } catch {
        setVariantsList([]);
      }
    } else {
      setVariantsList([]);
    }

    setOpen(true);
  };

  const openStock = (product: VendorProduct) => {
    setStockProduct(product);
    stockMethods.reset({ quantity: 1, description: "" });
    setStockOpen(true);
  };

  const columns: Column<VendorProduct>[] = [
    {
      key: "name",
      header: "Product & Information",
      render: (r) => {
        const img = productImages(r)[0];
        return (
          <div className="flex items-center gap-3">
            <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
              {img ? (
                <RemoteImage src={img} alt={r.name} className="h-full w-full object-cover" />
              ) : (
                <Package className="h-5 w-5 text-neutral-400" />
              )}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-semibold text-neutral-900 dark:text-white truncate max-w-[200px] sm:max-w-xs">
                {r.name}
              </span>
              <span className="text-xs font-mono text-neutral-400">
                SKU: {r.sku}
              </span>
            </div>
          </div>
        );
      },
    },
    {
      key: "category",
      header: "Category",
      render: (r) =>
        r.category?.name ? (
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-semibold text-foreground">
              {r.category.name}
            </span>
            {r.category.path && (
              <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[220px]" title={r.category.path.split("/").join(" › ")}>
                {r.category.path.split("/").join(" › ")}
              </span>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        ),
    },
    {
      key: "price",
      header: "Price",
      render: (r) => (
        <span className="font-bold text-sm text-foreground">
          {formatPrice(r.price)}
        </span>
      ),
    },
    {
      key: "stock",
      header: "Inventory Stock",
      render: (r) => {
        if (r.hasVariants) {
          return (
            <Badge variant="outline" className="text-xs font-semibold bg-primary/10 text-primary border-primary/20">
              <Layers className="h-3 w-3 mr-1" />
              {r.stock > 0 ? `${r.stock} in variants` : "Variants"}
            </Badge>
          );
        }
        const qty = r.stock ?? 0;
        if (qty === 0) {
          return (
            <Badge variant="destructive" className="text-xs font-semibold">
              Out of stock
            </Badge>
          );
        }
        if (qty <= 5) {
          return (
            <Badge variant="muted" className="text-xs font-semibold text-amber-600 dark:text-amber-400 border-amber-500/30">
              Low: {qty}
            </Badge>
          );
        }
        return (
          <span className="text-sm font-semibold text-foreground">
            {qty} units
          </span>
        );
      },
    },
    {
      key: "isActive",
      header: "Status",
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
      key: "createdAt",
      header: "Created",
      render: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "-"}
        </span>
      ),
    },
    {
      key: "id",
      header: "Actions",
      render: (r) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            title="Edit product"
            onClick={() => openEdit(r)}
            className="h-8 w-8 p-0 rounded-lg"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            title="Adjust stock quantity"
            onClick={() => openStock(r)}
            className="h-8 w-8 p-0 rounded-lg text-indigo-500 hover:text-indigo-600"
          >
            <PackagePlus className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            title={r.isActive ? "Deactivate product" : "Activate product"}
            className={`h-8 w-8 p-0 rounded-lg ${
              r.isActive
                ? "text-amber-500 hover:text-amber-600"
                : "text-emerald-500 hover:text-emerald-600"
            }`}
            onClick={() => setToggleActiveTarget(r)}
          >
            {r.isActive ? <Ban className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 rounded-lg text-rose-500 hover:bg-rose-500/10 hover:text-rose-600"
            title="Delete product"
            onClick={() => setDeleteTarget(r)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  const isEditing = Boolean(editingProduct);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          title="Product Catalog"
          description="Manage storefront listings, stock inventories, descriptions, and media."
        />
        <Button
          onClick={openCreate}
          className="gap-2 rounded-2xl bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200 px-5 shadow-sm"
        >
          <Plus className="h-4 w-4" />
          Add Product
        </Button>
      </div>

      <ManagementToolbar
        value={search}
        onChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        placeholder="Search by title, SKU, or keyword..."
        filterValue={status}
        onFilterChange={(v) => {
          setStatus(v);
          setPage(1);
        }}
        filters={[
          { value: "active", label: "Active" },
          { value: "inactive", label: "Inactive" },
        ]}
        onRefresh={refreshProducts}
        isLoading={isLoading || isFetching}
      />

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        isFetching={isFetching}
        emptyMessage="No product listings found in your store."
        pagination={
          data?.meta
            ? {
                page: data.meta.page ?? page,
                limit: data.meta.limit ?? 25,
                total: data.meta.totalItems ?? data.meta.total ?? 0,
                totalPages: data.meta.totalPages,
                hasNextPage: data.meta.hasNextPage,
                hasPrevPage: data.meta.hasPreviousPage,
                onPageChange: (newPage) => setPage(newPage),
              }
            : undefined
        }
      />

      {/* CREATE / EDIT PRODUCT MODAL */}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setEditingProduct(null);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl p-6 sm:p-8">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">
              {isEditing ? `Edit: ${editingProduct?.name}` : "Create New Product Listing"}
            </DialogTitle>
          </DialogHeader>

          <FormProvider {...methods}>
            <form
              onSubmit={methods.handleSubmit((values) =>
                editingProduct
                  ? updateMutation.mutate({ id: editingProduct.id, values })
                  : createMutation.mutate(values)
              )}
              className="space-y-4 pt-2"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormInput
                  name="name"
                  label="Product Title"
                  placeholder="e.g. Handmade Ceramic Mug"
                  required
                />
                <FormInput
                  name="sku"
                  label="SKU Identifier"
                  placeholder="e.g. HCM-001"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormInput
                  name="price"
                  label="Retail Price (NGN)"
                  type="number"
                  placeholder="8500"
                  required
                />
                {!hasVariants && !isEditing && (
                  <FormInput
                    name="stock"
                    label="Initial Stock Quantity"
                    type="number"
                    placeholder="20"
                  />
                )}
              </div>

              {/* Variants toggle */}
              <div className="rounded-2xl border border-border/80 bg-secondary/30 p-3.5 flex items-center justify-between">
                <div>
                  <label htmlFor="hasVariants" className="text-xs font-bold text-foreground cursor-pointer flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5 text-primary" />
                    Product Has Multiple Variants
                  </label>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Enable if this item has different sizes, colors, or materials with individual stock and photos.
                  </p>
                </div>
                <input
                  id="hasVariants"
                  name="hasVariants"
                  type="checkbox"
                  checked={Boolean(hasVariants)}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    methods.setValue("hasVariants", checked, { shouldDirty: true });
                    if (checked && variantsList.length === 0) {
                      setVariantsList([
                        {
                          options: [{ name: "Size", value: "Standard" }],
                          stock: 10,
                          images: [],
                        },
                      ]);
                    }
                  }}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
                />
              </div>

              {/* Variant builder section */}
              {hasVariants && (
                <ProductVariantBuilder
                  authRole="vendor"
                  variants={variantsList}
                  onChange={setVariantsList}
                />
              )}

              <CategoryPicker categories={categoriesData ?? []} />

              <ImageUpload
                authRole="vendor"
                name="imageUrls"
                label="Product Images (up to 6)"
                aspectHint="square or portrait"
                maxImages={6}
              />

              <FormTextarea
                name="description"
                label="Product Description"
                placeholder="Share material composition, sizing, specifications, or care tips..."
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
                  {isEditing
                    ? updateMutation.isPending
                      ? "Updating..."
                      : "Save Listing"
                    : createMutation.isPending
                    ? "Listing..."
                    : "Publish Product"}
                </Button>
              </DialogFooter>
            </form>
          </FormProvider>
        </DialogContent>
      </Dialog>

      {/* ADJUST STOCK MODAL */}
      <Dialog open={stockOpen} onOpenChange={setStockOpen}>
        <DialogContent className="max-w-md rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <PackagePlus className="h-5 w-5 text-indigo-500" />
              Adjust Stock Inventory
            </DialogTitle>
          </DialogHeader>

          <FormProvider {...stockMethods}>
            <form
              onSubmit={stockMethods.handleSubmit((values) =>
                stockProduct &&
                adjustStockMutation.mutate({
                  id: stockProduct.id,
                  quantity: values.quantity,
                  description: values.description?.trim() || undefined,
                })
              )}
              className="space-y-4 pt-2"
            >
              <div className="rounded-xl bg-neutral-50 dark:bg-neutral-900/60 p-3 text-xs text-neutral-600 dark:text-neutral-400">
                <p className="font-bold text-neutral-900 dark:text-white">
                  {stockProduct?.name}
                </p>
                <p className="mt-0.5">
                  Available in store:{" "}
                  <span className="font-bold text-indigo-500">
                    {stockProduct?.stock ?? 0} units
                  </span>
                </p>
              </div>

              <FormInput
                name="quantity"
                label="Adjustment (+ to add, - to deduct)"
                type="number"
                placeholder="e.g. 10 or -3"
                required
              />

              <FormTextarea
                name="description"
                label="Inventory Reason (Optional)"
                placeholder="e.g. New craft batch, personal restock, inspection deduction..."
              />

              <DialogFooter className="mt-6 flex flex-row items-center justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStockOpen(false)}
                  className="rounded-xl text-xs h-9 px-4 font-semibold"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={adjustStockMutation.isPending}
                  className="rounded-xl text-xs h-9 px-4 font-bold bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200 shadow-xs"
                >
                  {adjustStockMutation.isPending ? "Applying..." : "Apply Adjustment"}
                </Button>
              </DialogFooter>
            </form>
          </FormProvider>
        </DialogContent>
      </Dialog>

      {/* CONFIRM DELETE DIALOG */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title="Delete Product Listing"
        description={
          <>
            Are you sure you want to permanently delete{" "}
            <strong>&quot;{deleteTarget?.name}&quot;</strong> from your storefront?
          </>
        }
        confirmText="Delete Listing"
        variant="destructive"
        isLoading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
      />

      {/* CONFIRM TOGGLE ACTIVE DIALOG */}
      <ConfirmDialog
        open={Boolean(toggleActiveTarget)}
        onOpenChange={(v) => !v && setToggleActiveTarget(null)}
        title={toggleActiveTarget?.isActive ? "Deactivate Product Listing" : "Reactivate Product Listing"}
        description={
          toggleActiveTarget?.isActive ? (
            <>
              Are you sure you want to deactivate <strong>&quot;{toggleActiveTarget?.name}&quot;</strong>? It will no longer be visible to customers on your storefront until reactivated.
            </>
          ) : (
            <>
              Reactivate <strong>&quot;{toggleActiveTarget?.name}&quot;</strong>? It will immediately become visible to shoppers again.
            </>
          )
        }
        confirmText={toggleActiveTarget?.isActive ? "Deactivate Listing" : "Reactivate Listing"}
        variant={toggleActiveTarget?.isActive ? "destructive" : "default"}
        isLoading={toggleActiveMutation.isPending}
        onConfirm={() => {
          if (toggleActiveTarget) {
            toggleActiveMutation.mutate(
              { id: toggleActiveTarget.id, active: !!toggleActiveTarget.isActive },
              { onSettled: () => setToggleActiveTarget(null) }
            );
          }
        }}
      />
    </div>
  );
}
