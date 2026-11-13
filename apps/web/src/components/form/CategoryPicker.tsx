"use client";

import type { CategoryResponseDto } from "@/api/dto/category";
import { Label } from "@/component/ui/label";
import { cn } from "@/lib/util";
import {
Check,
CheckCircle2,
ChevronRight,
FolderTree,
Info,
Search,
X,
} from "lucide-react";
import { useEffect,useMemo,useRef,useState } from "react";
import { useFormContext } from "react-hook-form";

export type CategoryNode = CategoryResponseDto;

const childrenOf = (node?: CategoryNode): CategoryNode[] => {
  if (!node) return [];
  if (Array.isArray(node.children) && node.children.length > 0) {
    return node.children as CategoryNode[];
  }
  if (Array.isArray(node.subCategories) && node.subCategories.length > 0) {
    return node.subCategories as CategoryNode[];
  }
  return [];
};

function findCategoryPathIds(
  nodes: CategoryNode[],
  targetId: string,
  current: string[] = [],
): string[] | null {
  for (const node of nodes) {
    const next = [...current, node.id];
    if (node.id === targetId) return next;
    const found = findCategoryPathIds(childrenOf(node), targetId, next);
    if (found) return found;
  }
  return null;
}

interface FlatCategoryItem {
  id: string;
  name: string;
  slug: string;
  path: string[];
  isLeaf: boolean;
  node: CategoryNode;
}

export function CategoryPicker({
  name = "categoryId",
  categories,
  required = true,
}: {
  name?: string;
  categories: CategoryNode[];
  required?: boolean;
}) {
  const { setValue, watch, register, formState: { errors } } = useFormContext();
  const selectedId = watch(name) as string | undefined;

  const [pathState, setPathState] = useState<{ selectedId: string; path: string[] }>({ selectedId: "", path: [] });
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Filter only active categories (status === 'ACTIVE' or isActive !== false)
  const activeCategories = useMemo(
    () =>
      Array.isArray(categories)
        ? categories.filter(
            (item) => item.status !== "ARCHIVED" && item.isActive !== false
          )
        : [],
    [categories]
  );
  const selectedPath = useMemo(
    () => selectedId
      ? findCategoryPathIds(activeCategories, selectedId) ?? []
      : pathState.selectedId === "" ? pathState.path : [],
    [selectedId, activeCategories, pathState.selectedId, pathState.path],
  );

  // Flatten active categories for search & fast lookups
  const flatCategories = useMemo(() => {
    const list: FlatCategoryItem[] = [];
    const traverse = (nodes: CategoryNode[], currentPath: string[] = []) => {
      for (const node of nodes) {
        if (node.status === "ARCHIVED" || node.isActive === false) continue;
        const newPath = [...currentPath, node.name];
        const children = childrenOf(node);
        const isLeaf = children.length === 0;
        list.push({
          id: node.id,
          name: node.name,
          slug: node.slug,
          path: newPath,
          isLeaf,
          node,
        });
        if (children.length > 0) {
          traverse(children, newPath);
        }
      }
    };
    traverse(activeCategories);
    return list;
  }, [activeCategories]);

  // Search filtered results
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return flatCategories
      .filter((item) => {
        const fullPath = item.path.join(" ").toLowerCase();
        return fullPath.includes(q) || item.slug.toLowerCase().includes(q);
      })
      .slice(0, 15);
  }, [flatCategories, searchQuery]);

  // Close search dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        setIsSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // When user selects a category from search
  const handleSelectFromSearch = (item: FlatCategoryItem) => {
    const ids = findCategoryPathIds(activeCategories, item.id);
    if (ids) setPathState({ selectedId: item.isLeaf ? item.id : "", path: ids });

    if (item.isLeaf) {
      setValue(name, item.id, { shouldDirty: true, shouldValidate: true });
    } else {
      // If user selected a non-leaf parent from search, open the hierarchy and let them complete it
      setValue(name, "", { shouldDirty: true, shouldValidate: true });
    }

    setSearchQuery("");
    setIsSearchOpen(false);
  };

  // Handle cascading dropdown change at specific depth
  const handleSelectCascade = (depth: number, value: string) => {
    if (!value) {
      const nextPath = selectedPath.slice(0, depth);
      setPathState({ selectedId: "", path: nextPath });
      setValue(name, "", { shouldDirty: true, shouldValidate: true });
      return;
    }

    let nextPath = [...selectedPath.slice(0, depth), value];

    // Find node and see if it has children
    let currentList = activeCategories;
    let node: CategoryNode | undefined;
    for (const id of nextPath) {
      node = currentList.find((c) => c.id === id);
      if (node) currentList = childrenOf(node);
    }

    // Auto-detect single children
    while (node) {
      const children = childrenOf(node);
      if (children.length !== 1) break;
      const singleChild = children[0];
      if (!singleChild) break;
      nextPath = [...nextPath, singleChild.id];
      node = singleChild;
    }

    // If terminal node (no children), confirm selection
    if (node && childrenOf(node).length === 0) {
      setPathState({ selectedId: node.id, path: nextPath });
      setValue(name, node.id, { shouldDirty: true, shouldValidate: true });
    } else {
      setPathState({ selectedId: "", path: nextPath });
      setValue(name, "", { shouldDirty: true, shouldValidate: true });
    }
  };

  // Build breadcrumb items for the currently selected path
  const selectedBreadcrumbs = useMemo(() => {
    const crumbs: string[] = [];
    let currentList = categories || [];
    for (const id of selectedPath) {
      const found = currentList.find((c) => c.id === id);
      if (found) {
        crumbs.push(found.name);
        currentList = childrenOf(found);
      }
    }
    return crumbs;
  }, [selectedPath, categories]);

  // Calculate dropdown levels to render
  const dropdownsToRender: {
    levelIndex: number;
    label: string;
    nodes: CategoryNode[];
    selectedValue: string;
  }[] = [];

  let currentOptions = activeCategories;
  let levelIndex = 0;

  const levelLabels = [
    "Primary Category",
    "Subcategory",
    "Section / Segment",
    "Classification",
    "Specific Type",
  ];

  while (currentOptions.length > 0) {
    const selectedValue = selectedPath[levelIndex] || "";
    dropdownsToRender.push({
      levelIndex,
      label:
        levelLabels[levelIndex] || `Category Level ${levelIndex + 1}`,
      nodes: currentOptions.filter(
        (c) => c.status !== "ARCHIVED" && c.isActive !== false
      ),
      selectedValue,
    });

    if (selectedValue) {
      const selectedNode = currentOptions.find((c) => c.id === selectedValue);
      if (selectedNode) {
        currentOptions = childrenOf(selectedNode);
        levelIndex++;
      } else {
        break;
      }
    } else {
      break;
    }
  }

  const isSelectionComplete = Boolean(selectedId);
  const errorMessage = errors[name]?.message as string | undefined;

  return (
    <fieldset className="space-y-3.5 rounded-2xl border border-border/80 bg-card/60 p-4 sm:p-5 shadow-2xs">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-2">
          <FolderTree className="h-4 w-4 text-primary shrink-0" />
          <Label className="font-bold text-foreground text-sm">
            Product Category{required ? " *" : ""}
          </Label>
        </div>
        <p className="text-xs text-muted-foreground">
          Select the exact canonical category for your product.
        </p>
      </div>

      {activeCategories.length === 0 ? (
        <p className="flex items-center gap-2 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
          <Info className="h-4 w-4 shrink-0" /> No active categories available.
        </p>
      ) : (
        <div className="space-y-3">
          {/* Quick Search & Auto-Detect Bar */}
          <div ref={searchContainerRef} className="relative">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                id="category-picker-search"
                name="categoryPickerSearch"
                type="text"
                value={searchQuery}
                onFocus={() => setIsSearchOpen(true)}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setIsSearchOpen(true);
                }}
                placeholder="Search across entire category hierarchy (e.g. Phones, Dresses, Shoes)..."
                className="flex h-10 w-full rounded-xl border border-input bg-background pl-9 pr-9 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-2xs transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Search Suggestions Dropdown */}
            {isSearchOpen && searchResults.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1.5 max-h-60 overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-xl z-50 text-xs">
                <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Matching Categories
                </div>
                {searchResults.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectFromSearch(item)}
                    className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-secondary flex items-center justify-between gap-2 group transition-colors"
                  >
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {item.path.map((segment, segIdx) => (
                        <span key={segIdx} className="flex items-center gap-1">
                          <span
                            className={cn(
                              segIdx === item.path.length - 1
                                ? "font-bold text-foreground"
                                : "text-muted-foreground"
                            )}
                          >
                            {segment}
                          </span>
                          {segIdx < item.path.length - 1 && (
                            <ChevronRight className="h-3 w-3 text-muted-foreground/60" />
                          )}
                        </span>
                      ))}
                    </div>
                    {item.isLeaf && (
                      <span className="shrink-0 text-[10px] font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded-md flex items-center gap-1">
                        <Check className="h-3 w-3" /> Selectable
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Cascading Navigation Selectors */}
          <div className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-3">
            {dropdownsToRender.map((dropdown) => (
              <div key={dropdown.levelIndex} className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                  <span>{dropdown.label}</span>
                </label>
                <select
                  id={`category-cascade-${dropdown.levelIndex}`}
                  name={`categoryLevel_${dropdown.levelIndex}`}
                  aria-label={dropdown.label}
                  value={dropdown.selectedValue}
                  onChange={(e) =>
                    handleSelectCascade(dropdown.levelIndex, e.target.value)
                  }
                  className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-2xs hover:bg-secondary/40 transition-colors cursor-pointer"
                >
                  <option value="">Choose {dropdown.label.toLowerCase()}...</option>
                  {dropdown.nodes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {/* Current Category Trail Banner */}
          {selectedBreadcrumbs.length > 0 && (
            <div
              className={cn(
                "rounded-xl border p-2.5 flex items-center justify-between gap-2 text-xs transition-colors",
                isSelectionComplete
                  ? "bg-primary/5 border-primary/20 text-foreground"
                  : "bg-amber-500/10 border-amber-500/20 text-amber-800 dark:text-amber-300"
              )}
            >
              <div className="flex items-center gap-2 flex-wrap">
                {isSelectionComplete ? (
                  <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                ) : (
                  <Info className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                )}
                <span className="font-semibold">
                  {isSelectionComplete
                    ? "Assigned Category:"
                    : "Please select a specific subcategory node:"}
                </span>
                <div className="flex items-center gap-1 flex-wrap">
                  {selectedBreadcrumbs.map((crumb, idx) => (
                    <span key={idx} className="flex items-center gap-1">
                      <span className="font-bold text-foreground bg-secondary/80 px-2 py-0.5 rounded-md border border-border/60">
                        {crumb}
                      </span>
                      {idx < selectedBreadcrumbs.length - 1 && (
                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      )}
                    </span>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setPathState({ selectedId: "", path: [] });
                  setValue(name, "", { shouldDirty: true, shouldValidate: true });
                }}
                className="text-xs text-muted-foreground hover:text-foreground font-medium underline underline-offset-2 shrink-0 ml-2"
              >
                Clear
              </button>
            </div>
          )}

          {errorMessage && (
            <p className="text-xs font-medium text-rose-500">{errorMessage}</p>
          )}
        </div>
      )}

      {/* Hidden input for React Hook Form validation */}
      <input
        type="hidden"
        {...register(name, {
          required: required ? "Please select a valid category for your product" : false,
        })}
      />
    </fieldset>
  );
}
