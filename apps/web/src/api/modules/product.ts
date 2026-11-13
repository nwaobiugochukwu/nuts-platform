import { adminApi, publicApi, vendorApi } from "@/api/core/client";
import type { CategoryResponseDto } from "@/api/dto/category";
import type {
AdminProductResponseDto,
ProductCardDto,
ProductSummaryDto,
PublicProductResponseDto,
VendorProductResponseDto,
} from "@/api/dto/product";
import type { VendorVariantResponseDto } from "@/api/dto/variant";
import type { CursorPaginationMeta } from "@/api/core/types";

export interface CategoryProductPreview {
  items: ProductCardDto[];
  totalItems: number;
  totalPages: number;
}

export interface ProductQueryParams {
  page?: number;
  limit?: number;
  cursor?: string;
  search?: string;
  category?: string;
  categoryId?: string;
  categoryPath?: string;
  vendorId?: string;
  slug?: string;
  minPrice?: number;
  maxPrice?: number;
  sort?: string;
  [key: string]: unknown;
}

export interface CursorQueryBody {
  cursor?: string;
  take?: number;
  filter?: Record<string, unknown>;
  sort?: string;
}

export interface CreateProductPayload {
  name: string;
  description?: string;
  sku?: string;
  categoryId?: string;
  price?: number;
  stock?: number;
  images?: { url: string; publicId: string; isCover?: boolean }[];
  hasVariants?: boolean;
  variants?: {
    options: { name: string; value: string }[];
    stock?: number;
    price?: number;
    images?: string[];
  }[];
  variantCombinations?: Record<string, string[]>;
  isActive?: boolean;
}

export type UpdateProductPayload = Partial<CreateProductPayload>;

export interface UpdateStockPayload {
  quantity: number;
  description?: string;
}

export const productService = {
  getBySlug(slug: string, signal?: AbortSignal) {
    return publicApi.get<PublicProductResponseDto>(`/products/${slug}`, { signal });
  },
  getCards(params: ProductQueryParams, signal?: AbortSignal) {
    return publicApi.get<ProductCardDto[]>("/products", { params, signal });
  },
  getTrending(params: {
    limit?: number;
    days?: number;
    categoryId?: string;
    search?: string;
    minPrice?: number;
    maxPrice?: number;
  }) {
    return publicApi.get<ProductCardDto[]>("/products/trending", { params });
  },
  getDiscovery(params: ProductQueryParams, signal?: AbortSignal) {
    return publicApi.get<ProductCardDto[], CursorPaginationMeta>(
      "/discover",
      { params, signal },
    );
  },
  query(body: CursorQueryBody) {
    return publicApi.post<{ items: ProductCardDto[]; nextCursor?: string | null }>(
      "/products/query",
      body
    );
  },
};

export const dashboardProductService = {
  list(params: ProductQueryParams) {
    return vendorApi.get<VendorProductResponseDto[]>("/vendors/products", { params });
  },
  getBySlug(slug: string) {
    return vendorApi.get<VendorProductResponseDto>(`/vendors/products/${slug}`);
  },
  create(payload: CreateProductPayload) {
    return vendorApi.post<VendorProductResponseDto>("/vendors/products", payload);
  },
  update(id: string, payload: UpdateProductPayload) {
    return vendorApi.patch<VendorProductResponseDto>(`/vendors/products/${id}`, payload);
  },
  setActive(id: string, active: boolean) {
    return vendorApi.patch<VendorProductResponseDto>(
      `/vendors/products/${id}/${active ? "reactivate" : "deactivate"}`
    );
  },
  updateStock(id: string, payload: UpdateStockPayload) {
    return vendorApi.patch<VendorProductResponseDto>(
      `/vendors/products/${id}/stock`,
      payload
    );
  },
  permanentDelete(id: string) {
    return vendorApi.delete<void>(`/vendors/products/${id}/permanent`);
  },
  listVariants(productId: string) {
    return vendorApi.get<VendorVariantResponseDto[]>(`/vendors/products/${productId}/variants`);
  },
};

export const adminProductService = {
  list(params: ProductQueryParams) {
    return adminApi.get<AdminProductResponseDto[]>("/admin/products", { params });
  },
  create(payload: CreateProductPayload) {
    return adminApi.post<AdminProductResponseDto>("/admin/products", payload);
  },
  update(id: string, payload: UpdateProductPayload) {
    return adminApi.patch<AdminProductResponseDto>(`/admin/products/${id}`, payload);
  },
  setActive(id: string, active: boolean) {
    return adminApi.patch<AdminProductResponseDto>(
      `/admin/products/${id}/${active ? "reactivate" : "deactivate"}`
    );
  },
  updateStock(id: string, payload: UpdateStockPayload) {
    return adminApi.patch<AdminProductResponseDto>(`/admin/products/${id}/stock`, payload);
  },
  delete(id: string) {
    return adminApi.delete<void>(`/admin/products/${id}`);
  },
};

export const productSummaryService = {
  list(params: { subcategory?: string; sort?: string; limit?: number }) {
    return publicApi.get<ProductSummaryDto[]>("/products", { params });
  },
};

export type { CategoryResponseDto };
