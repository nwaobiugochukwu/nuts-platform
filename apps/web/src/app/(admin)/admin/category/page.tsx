"use client";

import { RemoteImage } from "@/component/ui/RemoteImage";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation,useQuery,useQueryClient } from "@tanstack/react-query";
import { useCallback,useMemo,useState } from "react";
import { FormProvider,useForm,useWatch } from "react-hook-form";
import { z } from "zod";

import { adminCategoryService,adminSystemService } from "@/api";
import type { CreateCategoryPayload, UpdateCategoryPayload } from "@/api/modules/category";
import type { CategoryResponseDto,CategoryStatus } from "@/api/dto/category";
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
import { getApiErrorMessage } from "@/lib/api-error";
import {
AlertTriangle,
Archive,
ArrowRightLeft,
CheckCircle2,
ChevronDown,
ChevronRight,
Eye,
FolderTree,
ListTree,
Package,
Pencil,
Plus,
RefreshCw,
RotateCcw,
Search,
Table as TableIcon,
Trash2,
XCircle
} from "lucide-react";
import Link from "@/components/navigation/AppLink";
import { toast } from "sonner";

interface FlatAdminCategory {
  id: string;
  name: string;
  slug: string;
  path: string;
  depth: number;
  status: CategoryStatus;
  isActive: boolean;
  parentId?: string | null;
  parentName: string;
  fullPath: string;
  description?: string | null;
  imageUrl?: string | null;
  childrenCount: number;
  productCount: number;
  node: CategoryResponseDto;
}

function flattenTree(
  nodes: CategoryResponseDto[],
  parentName = "Root",
  ancestorPath = "",
  currentDepth = 0
): FlatAdminCategory[] {
  const result: FlatAdminCategory[] = [];
  for (const node of nodes) {
    const currentPath = ancestorPath ? `${ancestorPath} › ${node.name}` : node.name;
    const children = node.children || node.subCategories || [];
    result.push({
      id: node.id,
      name: node.name,
      slug: node.slug,
      path: node.path || node.slug,
      depth: currentDepth,
      status: node.status || (node.isActive ? "ACTIVE" : "INACTIVE"),
      isActive: node.isActive,
      parentId: node.parentId,
      parentName,
      fullPath: currentPath,
      description: node.description,
      imageUrl: node.imageUrl,
      childrenCount: children.length,
      productCount: node.productCount ?? 0,
      node,
    });
    if (children.length > 0) {
      result.push(
        ...flattenTree(children, node.name, currentPath, currentDepth + 1)
      );
    }
  }
  return result;
}

const createCategorySchema = z.object({
  name: z.string().min(2, "Category name must be at least 2 characters").max(100),
  slug: z.string().max(120).optional().or(z.literal("")),
  parentId: z.string().optional().or(z.literal("")),
  description: z.string().max(500).optional().or(z.literal("")),
  imageUrl: z.string().optional().or(z.literal("")),
  status: z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]).default("ACTIVE"),
  sortOrder: z.coerce.number().min(0).default(0),
});

type CategoryFormData = z.infer<typeof createCategorySchema>;

export default function AdminCategoryPage() {
  const [openForm, setOpenForm] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryResponseDto | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<CategoryResponseDto | null>(null);
  const [moveTarget, setMoveTarget] = useState<FlatAdminCategory | null>(null);
  const [newParentId, setNewParentId] = useState<string>("none");
  const [archiveTarget, setArchiveTarget] = useState<FlatAdminCategory | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FlatAdminCategory | null>(null);
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<{ id: string; name: string } | null>(null);
  const [statusToggleTarget, setStatusToggleTarget] = useState<{
    id: string;
    name: string;
    activate: boolean;
  } | null>(null);
  const [viewMode, setViewMode] = useState<"tree" | "table">("tree");
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const qc = useQueryClient();

  const { data: rawTree, isLoading, isFetching } = useQuery({
    queryKey: [...queryKey.admin.category, "includeArchived"],
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
    queryFn: async () => {
      const res = await adminCategoryService.get({ includeArchived: true });
      return res.data;
    },
  });

  const flatCategories = useMemo(
    () => (rawTree ? flattenTree(rawTree) : []),
    [rawTree]
  );

  const methods = useForm<CategoryFormData>({
    resolver: zodResolver(createCategorySchema),
    defaultValues: {
      name: "",
      slug: "",
      parentId: "none",
      description: "",
      imageUrl: "",
      status: "ACTIVE",
      sortOrder: 0,
    },
  });
  const selectedParentId = useWatch({ control: methods.control, name: "parentId" });

  const refreshCategories = () => {
    qc.invalidateQueries({ queryKey: queryKey.admin.category });
    qc.invalidateQueries({ queryKey: queryKey.category.list() });
  };

  const purgeCacheMutation = useMutation({
    mutationFn: () => adminSystemService.clearCategoryCache(),
    onSuccess: (res) => {
      toast.success(res?.data?.message || "Category cache successfully invalidated");
      refreshCategories();
      setShowPurgeConfirm(false);
    },
    onError: () => toast.error("Failed to clear category cache"),
  });

  const createMutation = useMutation({
    mutationFn: (values: CategoryFormData) => {
      const payload: CreateCategoryPayload = {
        name: values.name.trim(),
        status: values.status,
        sortOrder: values.sortOrder,
      };
      if (values.slug?.trim()) payload.slug = values.slug.trim();
      if (values.parentId && values.parentId !== "none") {
        payload.parentId = values.parentId;
        payload.imageUrl = null; // Subcategories strictly do not have icons or images
      } else {
        payload.imageUrl = values.imageUrl?.trim() || null;
      }
      return adminCategoryService.create(payload);
    },
    onSuccess: () => {
      toast.success("Category node created successfully!");
      refreshCategories();
      setOpenForm(false);
      methods.reset();
    },
    onError: (error: unknown) => toast.error(getApiErrorMessage(error, "Failed to create category")),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      values,
    }: {
      id: string;
      values: CategoryFormData;
    }) => {
      const payload: UpdateCategoryPayload = {
        name: values.name.trim(),
        status: values.status,
        sortOrder: values.sortOrder,
      };
      const isRoot = !values.parentId || values.parentId === "none";
      payload.parentId = isRoot ? null : values.parentId;
      payload.description = values.description?.trim() || null;
      payload.imageUrl = isRoot ? (values.imageUrl?.trim() || null) : null;
      return adminCategoryService.update(id, payload);
    },
    onSuccess: () => {
      toast.success("Category updated successfully!");
      refreshCategories();
      setOpenForm(false);
      setEditingCategory(null);
    },
    onError: (error: unknown) => toast.error(getApiErrorMessage(error, "Failed to update category")),
  });

  const moveMutation = useMutation({
    mutationFn: ({
      id,
      targetParentId,
    }: {
      id: string;
      targetParentId: string | null;
    }) => adminCategoryService.move(id, targetParentId),
    onSuccess: () => {
      toast.success("Category moved successfully!");
      refreshCategories();
      setMoveTarget(null);
    },
    onError: (error: unknown) => toast.error(getApiErrorMessage(error, "Failed to move category")),
  });

  const toggleStatusMutation = useMutation({
    mutationFn: ({ id, activate }: { id: string; activate: boolean }) =>
      adminCategoryService.setActive(id, activate),
    onSuccess: () => {
      toast.success("Category status updated!");
      refreshCategories();
      setStatusToggleTarget(null);
    },
    onError: (error: unknown) => toast.error(getApiErrorMessage(error, "Failed to update status")),
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => adminCategoryService.archive(id),
    onSuccess: () => {
      toast.success("Category successfully archived!");
      refreshCategories();
      setArchiveTarget(null);
    },
    onError: (error: unknown) => toast.error(getApiErrorMessage(error, "Failed to archive category")),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => adminCategoryService.restore(id),
    onSuccess: () => {
      toast.success("Category successfully restored!");
      refreshCategories();
      setRestoreTarget(null);
    },
    onError: (error: unknown) => toast.error(getApiErrorMessage(error, "Failed to restore category")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminCategoryService.delete(id),
    onSuccess: () => {
      toast.success("Category permanently deleted!");
      refreshCategories();
      setDeleteTarget(null);
    },
    onError: (error: unknown) => toast.error(getApiErrorMessage(error, "Failed to delete category")),
  });

  const openCreate = (initialParentId?: string) => {
    setEditingCategory(null);
    methods.reset({
      name: "",
      slug: "",
      parentId: initialParentId ?? "none",
      description: "",
      imageUrl: "",
      status: "ACTIVE",
      sortOrder: 0,
    });
    setOpenForm(true);
  };

  const openEdit = (cat: CategoryResponseDto) => {
    setEditingCategory(cat);
    methods.reset({
      name: cat.name,
      slug: cat.slug,
      parentId: cat.parentId ?? "none",
      description: cat.description ?? "",
      imageUrl: cat.imageUrl ?? "",
      status: cat.status || (cat.isActive ? "ACTIVE" : "INACTIVE"),
      sortOrder: cat.sortOrder ?? 0,
    });
    setOpenForm(true);
  };

  const toggleNodeExpanded = (id: string) => {
    setExpandedNodes((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const expandAll = () => {
    const all: Record<string, boolean> = {};
    for (const c of flatCategories) all[c.id] = true;
    setExpandedNodes(all);
  };

  const collapseAll = () => {
    setExpandedNodes({});
  };

  // Helper to determine if a node is descendant of target category (for Move dialog)
  const isDescendant = useCallback((nodeId: string, potentialAncestorId: string): boolean => {
    let current = flatCategories.find((c) => c.id === nodeId);
    while (current && current.parentId) {
      if (current.parentId === potentialAncestorId) return true;
      current = flatCategories.find((c) => c.id === current?.parentId);
    }
    return false;
  }, [flatCategories]);

  const parentOptions = useMemo(() => {
    return [
      { value: "none", label: "None (Root Category)" },
      ...flatCategories
        .filter(
          (c) =>
            (!editingCategory || c.id !== editingCategory.id) &&
            c.status !== "ARCHIVED"
        )
        .map((c) => ({
          value: c.id,
          label: c.fullPath,
        })),
    ];
  }, [flatCategories, editingCategory]);

  const moveParentOptions = useMemo(() => {
    if (!moveTarget) return [];
    return [
      { value: "none", label: "None (Root Level)" },
      ...flatCategories
        .filter(
          (c) =>
            c.id !== moveTarget.id &&
            !isDescendant(c.id, moveTarget.id) &&
            c.status !== "ARCHIVED"
        )
        .map((c) => ({
          value: c.id,
          label: `${c.fullPath}`,
        })),
    ];
  }, [flatCategories, moveTarget, isDescendant]);

  const filteredFlatCategories = useMemo(() => {
    return flatCategories.filter((c) => {
      const matchesSearch =
        search === "" ||
        `${c.name} ${c.slug} ${c.fullPath}`
          .toLowerCase()
          .includes(search.toLowerCase());

      const matchesStatus =
        statusFilter === "ALL" ||
        (statusFilter === "ACTIVE" && c.status === "ACTIVE") ||
        (statusFilter === "INACTIVE" && c.status === "INACTIVE") ||
        (statusFilter === "ARCHIVED" && c.status === "ARCHIVED");

      return matchesSearch && matchesStatus;
    });
  }, [flatCategories, search, statusFilter]);

  const filteredTree = useMemo(() => {
    if (!rawTree) return [];
    const term = search.trim().toLowerCase();
    if (!term && statusFilter === "ALL") return rawTree;

    function filterNodes(nodes: CategoryResponseDto[]): CategoryResponseDto[] {
      const kept: CategoryResponseDto[] = [];
      for (const node of nodes) {
        const children = node.children || node.subCategories || [];
        const filteredChildren = filterNodes(children);

        const matchesSearch =
          !term ||
          `${node.name} ${node.slug} ${node.path || ""}`.toLowerCase().includes(term);

        const nodeStatus = node.status || (node.isActive ? "ACTIVE" : "INACTIVE");
        const matchesStatus =
          statusFilter === "ALL" || nodeStatus === statusFilter;

        if ((matchesSearch && matchesStatus) || filteredChildren.length > 0) {
          kept.push({
            ...node,
            children: filteredChildren,
            subCategories: filteredChildren,
          });
        }
      }
      return kept;
    }

    return filterNodes(rawTree);
  }, [rawTree, search, statusFilter]);


  const columns: Column<FlatAdminCategory>[] = [
    {
      key: "name",
      header: "Category & Path",
      render: (r) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300">
            {r.depth === 0 ? (
              r.imageUrl ? (
                <RemoteImage src={r.imageUrl} alt={r.name} className="h-5 w-5 object-contain" />
              ) : (
                <span className="text-xs font-bold">{r.name.charAt(0)}</span>
              )
            ) : (
              <FolderTree className="h-4 w-4 text-neutral-400" />
            )}
          </div>
          <div className="flex flex-col min-w-0">
            <button
              type="button"
              onClick={() => setSelectedDetail(r.node)}
              className="text-sm font-semibold text-neutral-900 dark:text-white hover:underline text-left truncate"
            >
              {r.name}
            </button>
            <span className="text-xs font-mono text-neutral-400 truncate">
              {r.fullPath}
            </span>
          </div>
        </div>
      ),
    },
    {
      key: "slug",
      header: "Slug / Path",
      render: (r) => (
        <span className="font-mono text-xs text-neutral-600 dark:text-neutral-400">
          /{r.path || r.slug}
        </span>
      ),
    },
    {
      key: "depth",
      header: "Depth",
      render: (r) => (
        <Badge variant={r.depth === 0 ? "default" : "outline"} className="text-xs">
          {r.depth === 0 ? "Root (Level 0)" : `Child (Depth ${r.depth})`}
        </Badge>
      ),
    },
    {
      key: "productCount",
      header: "Products",
      render: (r) => (
        <Link
          href={`/admin/product?categoryId=${r.id}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-neutral-600 dark:text-neutral-300 hover:text-primary transition-colors"
        >
          <Package className="h-3.5 w-3.5" />
          <span>{r.productCount}</span>
        </Link>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => {
        if (r.status === "ARCHIVED") {
          return <Badge variant="destructive">Archived</Badge>;
        }
        return r.status === "ACTIVE" ? (
          <Badge variant="success">Active</Badge>
        ) : (
          <Badge variant="muted">Inactive</Badge>
        );
      },
    },
    {
      key: "actions",
      header: "Actions",
      render: (r) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            title="View Details"
            onClick={() => setSelectedDetail(r.node)}
            className="h-8 w-8 p-0 rounded-lg text-neutral-500 hover:text-foreground"
          >
            <Eye className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            title="Add Child Category"
            onClick={() => openCreate(r.id)}
            className="h-8 w-8 p-0 rounded-lg text-neutral-500 hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            title="Edit category"
            onClick={() => openEdit(r.node)}
            className="h-8 w-8 p-0 rounded-lg"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            title="Move category in tree"
            onClick={() => {
              setMoveTarget(r);
              setNewParentId(r.parentId ?? "none");
            }}
            className="h-8 w-8 p-0 rounded-lg text-sky-500 hover:text-sky-600"
          >
            <ArrowRightLeft className="h-3.5 w-3.5" />
          </Button>

          {r.status === "ARCHIVED" ? (
            <Button
              variant="ghost"
              size="sm"
              title="Restore archived category"
              onClick={() => setRestoreTarget({ id: r.id, name: r.name })}
              className="h-8 w-8 p-0 rounded-lg text-emerald-500 hover:text-emerald-600"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                title={r.status === "ACTIVE" ? "Deactivate category" : "Activate category"}
                className={`h-8 w-8 p-0 rounded-lg ${
                  r.status === "ACTIVE"
                    ? "text-amber-500 hover:text-amber-600"
                    : "text-emerald-500 hover:text-emerald-600"
                }`}
                onClick={() =>
                  setStatusToggleTarget({
                    id: r.id,
                    name: r.name,
                    activate: r.status !== "ACTIVE",
                  })
                }
              >
                {r.status === "ACTIVE" ? (
                  <XCircle className="h-3.5 w-3.5" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
              </Button>

              <Button
                variant="ghost"
                size="sm"
                title="Archive category"
                onClick={() => setArchiveTarget(r)}
                className="h-8 w-8 p-0 rounded-lg text-amber-600 hover:text-amber-700"
              >
                <Archive className="h-3.5 w-3.5" />
              </Button>
            </>
          )}

          <Button
            variant="ghost"
            size="sm"
            title="Permanently delete category (empty leaf only)"
            className="h-8 w-8 p-0 rounded-lg text-rose-500 hover:bg-rose-500/10 hover:text-rose-600"
            onClick={() => setDeleteTarget(r)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  // Recursive Tree Node Renderer
  const renderTreeNode = (node: CategoryResponseDto, depth = 0) => {
    const isSearchActive = Boolean(search.trim() || statusFilter !== "ALL");
    const isExpanded = isSearchActive || (expandedNodes[node.id] ?? depth < 1);
    const children = node.children || node.subCategories || [];
    const hasChildren = children.length > 0;
    const isArchived = node.status === "ARCHIVED";

    return (
      <div key={node.id} className="select-none">
        <div
          className={`group flex items-center justify-between rounded-xl px-3 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800/60 transition-colors ${
            depth > 0 ? "ml-6 border-l border-neutral-200 dark:border-neutral-800" : ""
          } ${isArchived ? "opacity-60 bg-neutral-50 dark:bg-neutral-900/30" : ""}`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {hasChildren ? (
              <button
                type="button"
                onClick={() => toggleNodeExpanded(node.id)}
                className="p-1 hover:text-foreground text-neutral-400 transition-transform"
                title={isExpanded ? "Collapse" : "Expand"}
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
            ) : (
              <span className="w-6" />
            )}

            {depth === 0 && (
              node.imageUrl ? (
                <RemoteImage src={node.imageUrl} alt={node.name} className="h-4 w-4 shrink-0 object-contain" />
              ) : (
                <span className="text-xs font-bold text-primary shrink-0">{node.name.charAt(0)}</span>
              )
            )}

            <button
              type="button"
              onClick={() => setSelectedDetail(node)}
              className="text-sm font-semibold text-neutral-900 dark:text-white hover:underline truncate text-left"
            >
              {node.name}
            </button>

            <span className="font-mono text-xs text-neutral-400">/{node.slug}</span>

            {node.status === "ARCHIVED" ? (
              <Badge variant="destructive" className="text-[10px] py-0 px-1.5 font-medium">
                Archived
              </Badge>
            ) : node.status === "INACTIVE" || node.isActive === false ? (
              <Badge variant="muted" className="text-[10px] py-0 px-1.5 font-medium">
                Inactive
              </Badge>
            ) : null}

            {node.productCount !== undefined && node.productCount > 0 && (
              <Link
                href={`/admin/product?categoryId=${node.id}`}
                className="inline-flex items-center gap-1 rounded-md bg-secondary/80 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-primary transition-colors"
                title="View products in this category"
              >
                <Package className="h-3 w-3" />
                {node.productCount}
              </Link>
            )}
          </div>

          <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="sm"
              title="Add Child Category"
              onClick={() => openCreate(node.id)}
              className="h-7 w-7 p-0 rounded-lg text-neutral-500 hover:text-foreground"
            >
              <Plus className="h-3 w-3" />
            </Button>

            <Button
              variant="ghost"
              size="sm"
              title="Edit category"
              onClick={() => openEdit(node)}
              className="h-7 w-7 p-0 rounded-lg"
            >
              <Pencil className="h-3 w-3" />
            </Button>

            <Button
              variant="ghost"
              size="sm"
              title="Move category in tree"
              onClick={() => {
                const flat = flatCategories.find((c) => c.id === node.id);
                if (flat) {
                  setMoveTarget(flat);
                  setNewParentId(flat.parentId ?? "none");
                }
              }}
              className="h-7 w-7 p-0 rounded-lg text-sky-500 hover:text-sky-600"
            >
              <ArrowRightLeft className="h-3 w-3" />
            </Button>

            {node.status === "ARCHIVED" ? (
              <Button
                variant="ghost"
                size="sm"
                title="Restore category"
                onClick={() => setRestoreTarget({ id: node.id, name: node.name })}
                className="h-7 w-7 p-0 rounded-lg text-emerald-500 hover:text-emerald-600"
              >
                <RotateCcw className="h-3 w-3" />
              </Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  title={node.status === "ACTIVE" ? "Deactivate category" : "Activate category"}
                  className={`h-7 w-7 p-0 rounded-lg ${
                    node.status === "ACTIVE"
                      ? "text-amber-500 hover:text-amber-600"
                      : "text-emerald-500 hover:text-emerald-600"
                  }`}
                  onClick={() =>
                    setStatusToggleTarget({
                      id: node.id,
                      name: node.name,
                      activate: node.status !== "ACTIVE",
                    })
                  }
                >
                  {node.status === "ACTIVE" ? (
                    <XCircle className="h-3 w-3" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3" />
                  )}
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  title="Archive category"
                  onClick={() => {
                    const flat = flatCategories.find((c) => c.id === node.id);
                    if (flat) setArchiveTarget(flat);
                  }}
                  className="h-7 w-7 p-0 rounded-lg text-amber-500 hover:text-amber-600"
                >
                  <Archive className="h-3 w-3" />
                </Button>
              </>
            )}

            <Button
              variant="ghost"
              size="sm"
              title="Permanently delete category"
              onClick={() => {
                const flat = flatCategories.find((c) => c.id === node.id);
                if (flat) setDeleteTarget(flat);
              }}
              className="h-7 w-7 p-0 rounded-lg text-rose-500 hover:bg-rose-500/10"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {hasChildren && isExpanded && (
          <div className="space-y-0.5">
            {children.map((child) => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          title="Marketplace Catalog Taxonomy"
          description="Manage hierarchical category trees, paths, status lifecycles, and cache invalidation."
        />

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={purgeCacheMutation.isPending}
            onClick={() => setShowPurgeConfirm(true)}
            className="gap-2 rounded-xl text-xs font-semibold h-10 border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-900"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 text-neutral-400 ${
                purgeCacheMutation.isPending ? "animate-spin text-indigo-500" : ""
              }`}
            />
            <span>Purge Redis Cache</span>
          </Button>

          <Button
            onClick={() => openCreate()}
            className="gap-2 rounded-xl bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200 px-4 h-10 shadow-sm text-xs font-bold"
          >
            <Plus className="h-4 w-4" />
            Create Category
          </Button>
        </div>
      </div>

      {/* Toolbar: Search, Status Filter, Tree Expansion, View Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex flex-1 items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              id="admin-category-search-input"
              name="categorySearch"
              aria-label="Search categories"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search category, slug, or full hierarchy path..."
              className="flex h-10 w-full rounded-xl border border-input bg-background pl-9 pr-4 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-2xs"
            />
          </div>

          <select
            id="admin-category-status-filter"
            name="statusFilter"
            aria-label="Filter by category status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-10 rounded-xl border border-input bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-2xs cursor-pointer"
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">Active Only</option>
            <option value="INACTIVE">Inactive Only</option>
            <option value="ARCHIVED">Archived Only</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          {viewMode === "tree" && (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={expandAll}
                className="h-8 text-xs font-medium text-neutral-500 hover:text-foreground"
              >
                Expand All
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={collapseAll}
                className="h-8 text-xs font-medium text-neutral-500 hover:text-foreground"
              >
                Collapse All
              </Button>
            </div>
          )}

          <div className="flex items-center gap-1 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/60 dark:bg-neutral-900/60 p-1 shadow-xs">
            <button
              type="button"
              onClick={() => setViewMode("tree")}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
                viewMode === "tree"
                  ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-950"
                  : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white"
              }`}
            >
              <ListTree className="h-3.5 w-3.5" />
              Tree View
            </button>
            <button
              type="button"
              onClick={() => setViewMode("table")}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
                viewMode === "table"
                  ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-950"
                  : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white"
              }`}
            >
              <TableIcon className="h-3.5 w-3.5" />
              Table View
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {viewMode === "table" ? (
        <DataTable
          columns={columns}
          data={filteredFlatCategories}
          isLoading={isLoading}
          isFetching={isFetching}
          emptyMessage="No category taxonomy nodes found matching your filters."
        />
      ) : (
        <div className="rounded-3xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#121214] p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between border-b border-border/40 pb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-2">
              <FolderTree className="h-4 w-4 text-primary" />
              Canonical Category Tree
            </h3>
            <span className="text-xs text-neutral-400">
              {flatCategories.length} categories registered
            </span>
          </div>

          <div className="space-y-1">
            {isLoading ? (
              <div className="py-12 text-center text-xs text-neutral-400 animate-pulse">
                Loading category hierarchy...
              </div>
            ) : !filteredTree || filteredTree.length === 0 ? (
              <div className="py-12 text-center text-xs text-neutral-400">
                {rawTree && rawTree.length > 0
                  ? "No categories matched your search or status filter."
                  : "No categories found. Create a root category to begin organizing your marketplace."}
              </div>
            ) : (
              filteredTree.map((root) => renderTreeNode(root, 0))
            )}
          </div>
        </div>
      )}

      {/* CREATE / EDIT CATEGORY MODAL */}
      <Dialog
        open={openForm}
        onOpenChange={(next) => {
          setOpenForm(next);
          if (!next) setEditingCategory(null);
        }}
      >
        <DialogContent className="max-w-lg rounded-3xl p-6 sm:p-8">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">
              {editingCategory
                ? `Edit Category: ${editingCategory.name}`
                : "Create Category Node"}
            </DialogTitle>
          </DialogHeader>

          <FormProvider {...methods}>
            <form
              onSubmit={methods.handleSubmit((data) =>
                editingCategory
                  ? updateMutation.mutate({
                      id: editingCategory.id,
                      values: data,
                    })
                  : createMutation.mutate(data)
              )}
              className="space-y-4 pt-2"
            >
              <div className="space-y-1">
                <FormSelect
                  name="parentId"
                  label="Parent Category Node"
                  options={parentOptions}
                />
                <p className="text-xs text-muted-foreground">
                  Select &quot;None&quot; for root departments, or select an existing parent category.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormInput
                  name="name"
                  label="Category Name"
                  placeholder="e.g. Android Phones"
                  required
                />
                <FormInput
                  name="slug"
                  label="URL Slug (Optional)"
                  placeholder="e.g. android-phones"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormSelect
                  name="status"
                  label="Lifecycle Status"
                  options={[
                    { value: "ACTIVE", label: "ACTIVE (Visible & Selectable)" },
                    { value: "INACTIVE", label: "INACTIVE (Hidden)" },
                    { value: "ARCHIVED", label: "ARCHIVED (Historical Only)" },
                  ]}
                  required
                />
                <FormInput
                  name="sortOrder"
                  label="Display Sort Order"
                  type="number"
                  placeholder="0"
                />
              </div>

              {(!selectedParentId || selectedParentId === "none") ? (
                <FormInput
                  name="imageUrl"
                  label="Root Department SVG Icon URL"
                  placeholder="https://.../icon.svg"
                />
              ) : (
                <div className="rounded-2xl border border-dashed border-border bg-secondary/30 p-3.5 text-xs text-muted-foreground flex items-start gap-2.5">
                  <FolderTree className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-foreground">Iconography is scoped to Root Categories</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed">
                      Subcategories render as clean, stress-free navigation pills across the storefront and do not use icons or images.
                    </p>
                  </div>
                </div>
              )}

              <FormTextarea
                name="description"
                label="Description"
                placeholder="Category description for customer discovery and SEO..."
              />

              <DialogFooter className="mt-6 flex flex-row items-center justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpenForm(false)}
                  className="rounded-xl text-xs h-9 px-4 font-medium"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="rounded-xl text-xs h-9 px-4 font-semibold bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200 shadow-xs"
                >
                  {createMutation.isPending || updateMutation.isPending
                    ? "Saving..."
                    : editingCategory
                    ? "Update Category"
                    : "Create Category"}
                </Button>
              </DialogFooter>
            </form>
          </FormProvider>
        </DialogContent>
      </Dialog>

      {/* MOVE CATEGORY MODAL */}
      <Dialog
        open={Boolean(moveTarget)}
        onOpenChange={(v) => !v && setMoveTarget(null)}
      >
        <DialogContent className="max-w-md rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4 text-sky-500" />
              Move Category: {moveTarget?.name}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            <div className="rounded-xl bg-secondary/50 p-3 space-y-1">
              <span className="font-semibold text-muted-foreground">Current Hierarchy Path:</span>
              <p className="font-bold text-foreground">{moveTarget?.fullPath}</p>
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-foreground">Select New Parent Node:</label>
              <select
                id="category-new-parent-select"
                name="newParentId"
                aria-label="Select new parent node"
                value={newParentId}
                onChange={(e) => setNewParentId(e.target.value)}
                className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-2xs"
              >
                {moveParentOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">
                Descendants and the category itself cannot be chosen to prevent circular dependencies.
              </p>
            </div>
          </div>

          <DialogFooter className="mt-4 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setMoveTarget(null)}
              className="rounded-xl text-xs h-9 px-4"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={moveMutation.isPending}
              onClick={() => {
                if (moveTarget) {
                  moveMutation.mutate({
                    id: moveTarget.id,
                    targetParentId: newParentId === "none" ? null : newParentId,
                  });
                }
              }}
              className="rounded-xl text-xs h-9 px-4 font-semibold bg-sky-600 hover:bg-sky-700 text-white shadow-xs"
            >
              {moveMutation.isPending ? "Moving..." : "Confirm Move"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ARCHIVE CATEGORY CONFIRMATION MODAL */}
      <ConfirmDialog
        open={Boolean(archiveTarget)}
        onOpenChange={(v) => !v && setArchiveTarget(null)}
        title="Archive Category"
        description={
          <div className="space-y-2 text-xs text-foreground">
            <p>
              Are you sure you want to archive <strong>&quot;{archiveTarget?.name}&quot;</strong>?
            </p>
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 space-y-1.5 text-amber-800 dark:text-amber-300">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>Consequence Summary</span>
              </div>
              <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                <li>
                  Contains <strong>{archiveTarget?.productCount}</strong> assigned products
                </li>
                <li>
                  Contains <strong>{archiveTarget?.childrenCount}</strong> child subcategories
                </li>
                <li>Existing product relationships and historical orders remain intact</li>
                <li>New product creations cannot be assigned to this category</li>
              </ul>
            </div>
          </div>
        }
        confirmText="Archive Category"
        variant="destructive"
        isLoading={archiveMutation.isPending}
        onConfirm={() => archiveTarget && archiveMutation.mutate(archiveTarget.id)}
      />

      {/* HARD DELETE CONFIRMATION MODAL */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title="Permanently Delete Category"
        description={
          <div className="space-y-2 text-xs">
            <p>
              Are you sure you want to irreversibly delete{" "}
              <strong>&quot;{deleteTarget?.name}&quot;</strong>?
            </p>
            <p className="text-muted-foreground text-[11px]">
              Categories containing child categories or assigned products cannot be hard-deleted.
              If this category contains products, please archive it instead.
            </p>
          </div>
        }
        confirmText="Delete Permanently"
        variant="destructive"
        isLoading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
      />

      {/* CATEGORY DETAIL DRAWER / DIALOG */}
      <Dialog
        open={Boolean(selectedDetail)}
        onOpenChange={(v) => !v && setSelectedDetail(null)}
      >
        <DialogContent className="max-w-md rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center justify-between">
              <span>Category Details</span>
            </DialogTitle>
          </DialogHeader>

          {selectedDetail && (
            <div className="space-y-4 py-2 text-xs">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300">
                  {!selectedDetail.parentId ? (
                    selectedDetail.imageUrl ? (
                      <RemoteImage src={selectedDetail.imageUrl} alt={selectedDetail.name} className="h-6 w-6 object-contain" />
                    ) : (
                      <span className="text-base font-bold text-foreground">{selectedDetail.name.charAt(0)}</span>
                    )
                  ) : (
                    <FolderTree className="h-6 w-6 text-muted-foreground" />
                  )}
                </div>
                <div>
                  <h4 className="text-sm font-bold text-foreground">
                    {selectedDetail.name}
                  </h4>
                  <p className="font-mono text-xs text-muted-foreground">
                    /{selectedDetail.path || selectedDetail.slug}
                  </p>
                </div>
              </div>

              {selectedDetail.breadcrumbs && selectedDetail.breadcrumbs.length > 0 && (
                <div className="space-y-1">
                  <span className="font-semibold text-muted-foreground">Hierarchy Trail:</span>
                  <div className="flex items-center gap-1 flex-wrap">
                    {selectedDetail.breadcrumbs.map((crumb, idx) => (
                      <span key={crumb.id} className="flex items-center gap-1">
                        <span className="bg-secondary px-2 py-0.5 rounded-md font-semibold text-foreground">
                          {crumb.name}
                        </span>
                        {idx < selectedDetail.breadcrumbs!.length - 1 && (
                          <ChevronRight className="h-3 w-3 text-muted-foreground" />
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 rounded-xl bg-secondary/40 p-3">
                <div>
                  <span className="text-[11px] text-muted-foreground">Status</span>
                  <p className="font-bold text-foreground">
                    {selectedDetail.status || (selectedDetail.isActive ? "ACTIVE" : "INACTIVE")}
                  </p>
                </div>
                <div>
                  <span className="text-[11px] text-muted-foreground">Direct Products</span>
                  <p className="font-bold text-foreground">
                    {selectedDetail.productCount ?? 0}
                  </p>
                </div>
                <div>
                  <span className="text-[11px] text-muted-foreground">Sort Order</span>
                  <p className="font-bold text-foreground">
                    {selectedDetail.sortOrder ?? 0}
                  </p>
                </div>
                <div>
                  <span className="text-[11px] text-muted-foreground">Direct Children</span>
                  <p className="font-bold text-foreground">
                    {(selectedDetail.children || selectedDetail.subCategories || []).length}
                  </p>
                </div>
              </div>

              {selectedDetail.description && (
                <div className="space-y-1">
                  <span className="font-semibold text-muted-foreground">Description:</span>
                  <p className="text-muted-foreground">{selectedDetail.description}</p>
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-border/40">
                <Link
                  href={`/admin/product?categoryId=${selectedDetail.id}`}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                >
                  <Package className="h-4 w-4" />
                  View Assigned Products
                </Link>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    openEdit(selectedDetail);
                    setSelectedDetail(null);
                  }}
                  className="rounded-xl text-xs h-8"
                >
                  <Pencil className="h-3 w-3 mr-1" /> Edit Node
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* CONFIRM PURGE REDIS CACHE DIALOG */}
      <ConfirmDialog
        open={showPurgeConfirm}
        onOpenChange={setShowPurgeConfirm}
        title="Purge Category Cache"
        description="Are you sure you want to invalidate all cached category hierarchies in Redis? The system will reload fresh canonical trees from the primary database on the next query."
        confirmText="Purge Cache"
        variant="warning"
        isLoading={purgeCacheMutation.isPending}
        onConfirm={() => purgeCacheMutation.mutate()}
      />

      {/* CONFIRM RESTORE CATEGORY DIALOG */}
      <ConfirmDialog
        open={Boolean(restoreTarget)}
        onOpenChange={(v) => !v && setRestoreTarget(null)}
        title="Restore Category"
        description={
          <>
            Are you sure you want to restore archived category <strong>&quot;{restoreTarget?.name}&quot;</strong>? It will return to active taxonomy and become available for product assignments.
          </>
        }
        confirmText="Restore Category"
        variant="default"
        isLoading={restoreMutation.isPending}
        onConfirm={() => restoreTarget && restoreMutation.mutate(restoreTarget.id)}
      />

      {/* CONFIRM TOGGLE CATEGORY STATUS DIALOG */}
      <ConfirmDialog
        open={Boolean(statusToggleTarget)}
        onOpenChange={(v) => !v && setStatusToggleTarget(null)}
        title={statusToggleTarget?.activate ? "Activate Category" : "Deactivate Category"}
        description={
          statusToggleTarget?.activate ? (
            <>
              Are you sure you want to activate category <strong>&quot;{statusToggleTarget?.name}&quot;</strong>? It will become visible in marketplace navigation menus.
            </>
          ) : (
            <>
              Are you sure you want to deactivate category <strong>&quot;{statusToggleTarget?.name}&quot;</strong>? It will be hidden from customer navigation and storefront browsing.
            </>
          )
        }
        confirmText={statusToggleTarget?.activate ? "Activate Category" : "Deactivate Category"}
        variant={statusToggleTarget?.activate ? "default" : "warning"}
        isLoading={toggleStatusMutation.isPending}
        onConfirm={() =>
          statusToggleTarget &&
          toggleStatusMutation.mutate({
            id: statusToggleTarget.id,
            activate: statusToggleTarget.activate,
          })
        }
      />
    </div>
  );
}
