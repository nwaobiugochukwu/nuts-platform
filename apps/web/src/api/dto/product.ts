import type { ImageRefDto,VariantCombinations } from "../core/types";
import type { CategoryRefDto } from "./category";
import type {
AdminVariantResponseDto,
PublicVariantSummaryDto,
VendorVariantResponseDto,
} from "./variant";

export type {
AdminVariantResponseDto,PublicVariantSummaryDto,
VendorVariantResponseDto
} from "./variant";

// ── Products ─────────────────────────────────────────────────────────────────

export interface PublicProductResponseDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sku: string;
  hasVariants: boolean;
  price?: number;
  stock: number;
  inStock: boolean;
  stockStatus: string;
  discountPrice?: number;
  salePercentage: number;
  variants?: PublicVariantSummaryDto[];
  variantCombinations?: VariantCombinations;
  vendor: AdminVendorRefDto;
  category: CategoryRefDto | null;
  parentSubcategory?: CategoryRefDto | null;
  subcategory?: CategoryRefDto | null;
  imageUrl: string | null;
  images: ImageRefDto[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  averageRating?: number;
  reviewCount?: number;
}

export interface ProductCardDto {
  id: string;
  name: string;
  slug: string;
  price: number;
  discountPrice: number | null;
  thumbnail: string | null;
  stockStatus: string;
  hasVariants?: boolean;
  recommendationReason?: string;
  vendor: AdminVendorRefDto;
  category?: CategoryRefDto | null;
  categoryId?: string | null;
  parentSubcategory?: CategoryRefDto | null;
  subcategory?: CategoryRefDto | null;
}

export interface ProductSummaryDto {
  id: string;
  name: string;
  slug: string;
  price: number;
  stock: number;
  inStock: boolean;
  stockStatus: string;
  subcategory: CategoryRefDto;
  imageUrl: string | null;
  isActive: boolean;
}

export interface ProductImageDto {
  id: string;
  url: string;
  publicId: string;
  position: number;
  isCover: boolean;
}

export interface ProductResponseDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sku: string;
  hasVariants: boolean;
  price?: number;
  stock: number;
  inStock: boolean;
  stockStatus: string;
  discountPrice?: number;
  salePercentage: number;
  variants?: PublicVariantSummaryDto[];
  variantCombinations?: VariantCombinations;
  vendor: AdminVendorRefDto;
  category: CategoryRefDto | null;
  parentSubcategory?: CategoryRefDto | null;
  subcategory?: CategoryRefDto | null;
  imageUrl: string | null;
  images: ImageRefDto[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface VendorProductResponseDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sku: string;
  hasVariants: boolean;
  price?: number;
  stock: number;
  inStock: boolean;
  stockStatus: string;
  variants?: VendorVariantResponseDto[];
  variantCombinations?: VariantCombinations;
  category: CategoryRefDto | null;
  parentSubcategory?: CategoryRefDto | null;
  subcategory?: CategoryRefDto | null;
  images?: ProductImageDto[];
  isActive: boolean;
  isDeleted: boolean;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminVendorRefDto {
  id: string;
  storeName: string;
  storeSlug: string;
  storeLogoUrl?: string | null;
  storeDescription?: string | null;
  isVerified?: boolean;
}

export interface AdminProductResponseDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sku: string;
  hasVariants: boolean;
  price?: number;
  stock: number;
  inStock: boolean;
  stockStatus: string;
  variants?: AdminVariantResponseDto[];
  variantCombinations?: VariantCombinations;
  vendor: AdminVendorRefDto;
  category: CategoryRefDto | null;
  parentSubcategory?: CategoryRefDto | null;
  subcategory?: CategoryRefDto | null;
  images?: ProductImageDto[];
  isActive: boolean;
  isDeleted: boolean;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
