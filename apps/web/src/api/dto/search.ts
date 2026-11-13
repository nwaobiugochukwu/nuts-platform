export type SearchIndex = "products" | "vendors" | "categories" | "users" | "orders" | "discountCodes";

export interface QuerySearchBodyDto {
  query?: string;
  types?: SearchIndex[];
  limit?: number;
  offset?: number;
}

export interface SearchProductHitDto {
  id: string;
  name: string;
  slug: string;
  imageUrl?: string;
  price: number;
  discountPrice?: number;
}

export interface SearchVendorHitDto {
  id: string;
  storeName: string;
  storeSlug: string;
  storeLogoUrl?: string;
}

export interface SearchCategoryHitDto {
  id: string;
  name: string;
  slug: string;
  imageUrl?: string;
}

export interface SearchProductsResponseDto {
  hits: SearchProductHitDto[];
  total: number;
}