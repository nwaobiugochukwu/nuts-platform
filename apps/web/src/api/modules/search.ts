import { adminApi, publicApi, vendorApi } from "@/api/core/client";
import type {
QuerySearchBodyDto,
SearchCategoryHitDto,
SearchIndex,
SearchProductHitDto,
SearchProductsResponseDto,
SearchVendorHitDto,
} from "@/api/dto/search";

export type SearchVendorResult = SearchVendorHitDto;

export type SearchCategoryResult = SearchCategoryHitDto;

export interface AdminSearchResult {
  products: SearchProductHitDto[];
  vendors: SearchVendorResult[];
  categories: SearchCategoryResult[];
  users: unknown[];
  orders: unknown[];
  discountCodes: unknown[];
}

export const searchService = {
  query(body: QuerySearchBodyDto) {
    return publicApi.post<SearchProductsResponseDto>("/search/query", body);
  },
  get(params: QuerySearchBodyDto) {
    return publicApi.get<SearchProductsResponseDto>("/search", { params });
  },
  autocomplete(params: { query?: string; types?: SearchIndex[]; limit?: number }) {
    return publicApi.get<SearchProductsResponseDto>("/search/autocomplete", { params });
  },
};

export const adminSearchService = {
  get(params: QuerySearchBodyDto) {
    return adminApi.get<AdminSearchResult>("/admin/search", { params });
  },
};

export const vendorSearchService = {
  get(params: QuerySearchBodyDto) {
    return vendorApi.get<AdminSearchResult>("/vendors/search", { params });
  },
};
