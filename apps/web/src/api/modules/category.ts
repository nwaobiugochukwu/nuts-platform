import { adminApi, publicApi } from "@/api/core/client";
import type {
CategoryBreadcrumbDto,
CategoryLevel,
CategoryResponseDto,
CategoryStatus,
} from "@/api/dto/category";

export interface CreateCategoryPayload {
  name: string;
  slug?: string;
  description?: string | null;
  imageUrl?: string | null;
  parentId?: string | null;
  sortOrder?: number;
  status?: CategoryStatus;
  isActive?: boolean;
  level?: CategoryLevel; // Optional backward compatibility
}

export type UpdateCategoryPayload = Partial<CreateCategoryPayload>;

export interface MoveCategoryPayload {
  newParentId: string | null;
}

export interface ReorderCategoriesPayload {
  categoryIds: string[];
}

export const categoryService = {
  getAll() {
    return publicApi.get<CategoryResponseDto[]>("/categories");
  },
  getTree() {
    return this.getAll();
  },
  getRoots() {
    return publicApi.get<CategoryResponseDto[]>("/categories/roots");
  },
  search(q: string) {
    return publicApi.get<CategoryResponseDto[]>("/categories/search", {
      params: { q },
    });
  },
  findBySlug(slug: string) {
    return publicApi.get<CategoryResponseDto>(`/categories/${slug}`);
  },
  findByPath(path: string) {
    return publicApi.get<CategoryResponseDto>(`/categories/path/${path}`);
  },
  getBreadcrumbs(idOrSlug: string) {
    return publicApi.get<CategoryBreadcrumbDto[]>(`/categories/${idOrSlug}/breadcrumbs`);
  },
  getChildren(idOrSlug: string) {
    return publicApi.get<CategoryResponseDto[]>(`/categories/${idOrSlug}/children`);
  },
};

export const adminCategoryService = {
  get(params?: { includeArchived?: boolean }) {
    return adminApi.get<CategoryResponseDto[]>("/admin/categories", {
      params,
    });
  },
  getOne(idOrSlug: string) {
    return adminApi.get<CategoryResponseDto>(`/admin/categories/${idOrSlug}`);
  },
  create(payload: CreateCategoryPayload) {
    return adminApi.post<CategoryResponseDto>("/admin/categories", payload);
  },
  update(idOrSlug: string, payload: UpdateCategoryPayload) {
    return adminApi.patch<CategoryResponseDto>(`/admin/categories/${idOrSlug}`, payload);
  },
  move(id: string, newParentId: string | null) {
    return adminApi.post<CategoryResponseDto>(`/admin/categories/${id}/move`, {
      newParentId,
    });
  },
  reorder(parentId: string | null, categoryIds: string[]) {
    return adminApi.post<CategoryResponseDto[]>(
      `/admin/categories/reorder${parentId ? `?parentId=${parentId}` : ""}`,
      { categoryIds },
    );
  },
  setActive(idOrSlug: string, active: boolean) {
    return adminApi.patch<null>(
      `/admin/categories/${idOrSlug}/${active ? "activate" : "deactivate"}`
    );
  },
  archive(idOrSlug: string) {
    return adminApi.patch<CategoryResponseDto>(`/admin/categories/${idOrSlug}/archive`);
  },
  restore(idOrSlug: string) {
    return adminApi.patch<CategoryResponseDto>(`/admin/categories/${idOrSlug}/restore`);
  },
  delete(idOrSlug: string) {
    return adminApi.delete<{ message: string }>(`/admin/categories/${idOrSlug}`);
  },
};
